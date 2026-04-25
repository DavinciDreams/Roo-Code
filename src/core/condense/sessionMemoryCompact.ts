/**
 * Session Memory Compaction for Roo Code
 *
 * This module implements session memory compaction, which uses pre-extracted
 * session memory as a condensation summary instead of calling the LLM again.
 *
 * Adapted from Claude Code CLI's session memory compaction system.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import crypto from "crypto"

import { ApiHandler } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"
import {
	DEFAULT_SESSION_MEMORY_CONFIG,
	estimateMessageTokens,
	getLastSummarizedMessageId,
	hasTextBlocks,
	isSessionMemoryEmpty,
	markExtractionCompleted,
	markExtractionStarted,
	resetSessionMemoryState,
	setLastSummarizedMessageId,
	setSessionMemoryConfig,
	truncateSessionMemoryForCompact,
	waitForSessionMemoryExtraction,
	type SessionMemoryConfig,
} from "./sessionMemory"

/**
 * Configuration for session memory compaction thresholds
 */
export type SessionMemoryCompactConfig = {
	/** Minimum tokens to preserve after compaction */
	minTokens: number
	/** Minimum number of messages with text blocks to keep */
	minTextBlockMessages: number
	/** Maximum tokens to preserve after compaction (hard cap) */
	maxTokens: number
}

/**
 * Default configuration values
 */
export const DEFAULT_SM_COMPACT_CONFIG: SessionMemoryCompactConfig = {
	minTokens: 10000,
	minTextBlockMessages: 5,
	maxTokens: 50000,
}

/**
 * Current configuration
 */
let smCompactConfig: SessionMemoryCompactConfig = {
	...DEFAULT_SM_COMPACT_CONFIG,
}

/**
 * Set the session memory compact configuration
 */
export function setSessionMemoryCompactConfig(config: Partial<SessionMemoryCompactConfig>): void {
	smCompactConfig = {
		...smCompactConfig,
		...config,
	}
}

/**
 * Get the current session memory compact configuration
 */
export function getSessionMemoryCompactConfig(): SessionMemoryCompactConfig {
	return { ...smCompactConfig }
}

/**
 * Reset config state (useful for testing)
 */
export function resetSessionMemoryCompactConfig(): void {
	smCompactConfig = { ...DEFAULT_SM_COMPACT_CONFIG }
}

/**
 * Check if a message contains tool_result blocks and return their tool_use_ids
 */
function getToolResultIds(message: ApiMessage): string[] {
	if (message.role !== "user") {
		return []
	}
	const content = message.content
	if (!Array.isArray(content)) {
		return []
	}
	const ids: string[] = []
	for (const block of content) {
		if (block.type === "tool_result") {
			ids.push((block as Anthropic.Messages.ToolResultBlockParam).tool_use_id)
		}
	}
	return ids
}

/**
 * Check if a message contains tool_use blocks with any of the given ids
 */
function hasToolUseWithIds(message: ApiMessage, toolUseIds: Set<string>): boolean {
	if (message.role !== "assistant") {
		return false
	}
	const content = message.content
	if (!Array.isArray(content)) {
		return false
	}
	return content.some(
		(block) => block.type === "tool_use" && toolUseIds.has((block as Anthropic.Messages.ToolUseBlockParam).id),
	)
}

/**
 * Adjust the start index to ensure we don't split tool_use/tool_result pairs
 * or thinking blocks that share the same message.id with kept assistant messages.
 *
 * If ANY message we're keeping contains tool_result blocks, we need to
 * include the preceding assistant message(s) that contain the matching tool_use blocks.
 */
export function adjustIndexToPreserveAPIInvariants(messages: ApiMessage[], startIndex: number): number {
	if (startIndex <= 0 || startIndex >= messages.length) {
		return startIndex
	}

	let adjustedIndex = startIndex

	// Step 1: Handle tool_use/tool_result pairs
	// Collect tool_result IDs from ALL messages in the kept range
	const allToolResultIds: string[] = []
	for (let i = startIndex; i < messages.length; i++) {
		allToolResultIds.push(...getToolResultIds(messages[i]!))
	}

	if (allToolResultIds.length > 0) {
		// Collect tool_use IDs already in the kept range
		const toolUseIdsInKeptRange = new Set<string>()
		for (let i = adjustedIndex; i < messages.length; i++) {
			const msg = messages[i]!
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use") {
						toolUseIdsInKeptRange.add((block as Anthropic.Messages.ToolUseBlockParam).id)
					}
				}
			}
		}

		// Only look for tool_uses that are NOT already in the kept range
		const neededToolUseIds = new Set(allToolResultIds.filter((id) => !toolUseIdsInKeptRange.has(id)))

		// Find the assistant message(s) with matching tool_use blocks
		for (let i = adjustedIndex - 1; i >= 0 && neededToolUseIds.size > 0; i--) {
			const message = messages[i]!
			if (hasToolUseWithIds(message, neededToolUseIds)) {
				adjustedIndex = i
				// Remove found tool_use_ids from the set
				if (message.role === "assistant" && Array.isArray(message.content)) {
					for (const block of message.content) {
						if (
							block.type === "tool_use" &&
							neededToolUseIds.has((block as Anthropic.Messages.ToolUseBlockParam).id)
						) {
							neededToolUseIds.delete((block as Anthropic.Messages.ToolUseBlockParam).id)
						}
					}
				}
			}
		}
	}

	// Step 2: Handle thinking blocks that share message.id with kept assistant messages
	// Collect all message.ids from assistant messages in the kept range
	const messageIdsInKeptRange = new Set<string>()
	for (let i = adjustedIndex; i < messages.length; i++) {
		const msg = messages[i]!
		if (msg.role === "assistant" && msg.id) {
			messageIdsInKeptRange.add(msg.id)
		}
	}

	// Look backwards for assistant messages with the same message.id that are not in the kept range
	for (let i = adjustedIndex - 1; i >= 0; i--) {
		const message = messages[i]!
		if (message.role === "assistant" && message.id && messageIdsInKeptRange.has(message.id)) {
			// This message has the same message.id as one in the kept range
			// Include it so thinking blocks can be properly merged
			adjustedIndex = i
		}
	}

	return adjustedIndex
}

/**
 * Calculate the starting index for messages to keep after compaction.
 * Starts from lastSummarizedMessageId, then expands backwards to meet minimums.
 */
export function calculateMessagesToKeepIndex(messages: ApiMessage[], lastSummarizedIndex: number): number {
	if (messages.length === 0) {
		return 0
	}

	const config = getSessionMemoryCompactConfig()

	// Start from the message after lastSummarizedIndex
	let startIndex = lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : messages.length

	// Calculate current tokens and text-block message count from startIndex to end
	let totalTokens = 0
	let textBlockMessageCount = 0
	for (let i = startIndex; i < messages.length; i++) {
		const msg = messages[i]!
		totalTokens += estimateMessageTokens([msg])
		if (hasTextBlocks(msg)) {
			textBlockMessageCount++
		}
	}

	// Check if we already hit the max cap
	if (totalTokens >= config.maxTokens) {
		return adjustIndexToPreserveAPIInvariants(messages, startIndex)
	}

	// Check if we already meet both minimums
	if (totalTokens >= config.minTokens && textBlockMessageCount >= config.minTextBlockMessages) {
		return adjustIndexToPreserveAPIInvariants(messages, startIndex)
	}

	// Expand backwards until we meet both minimums or hit max cap
	for (let i = startIndex - 1; i >= 0; i--) {
		const msg = messages[i]!
		const msgTokens = estimateMessageTokens([msg])
		totalTokens += msgTokens
		if (hasTextBlocks(msg)) {
			textBlockMessageCount++
		}
		startIndex = i

		// Stop if we hit the max cap
		if (totalTokens >= config.maxTokens) {
			break
		}

		// Stop if we meet both minimums
		if (totalTokens >= config.minTokens && textBlockMessageCount >= config.minTextBlockMessages) {
			break
		}
	}

	// Adjust for tool pairs
	return adjustIndexToPreserveAPIInvariants(messages, startIndex)
}

/**
 * Try to use session memory for compaction instead of traditional compaction.
 * Returns null if session memory compaction cannot be used.
 *
 * @param messages - The conversation messages
 * @param sessionMemory - The session memory content
 * @param apiHandler - The API handler
 * @param taskId - The task ID for telemetry
 * @param autoCompactThreshold - Optional threshold for autocompact
 * @returns The compaction result or null if session memory compaction cannot be used
 */
export async function trySessionMemoryCompaction(
	messages: ApiMessage[],
	sessionMemory: string,
	apiHandler: ApiHandler,
	taskId: string,
	autoCompactThreshold?: number,
	lastSummarizedMessageId?: string,
): Promise<SessionMemoryCompactionResult | null> {
	// No session memory file exists
	if (!sessionMemory) {
		console.log("[Session Memory Compaction] No session memory available")
		return null
	}

	// Session memory exists but matches the template (no actual content extracted)
	if (isSessionMemoryEmpty(sessionMemory)) {
		console.log("[Session Memory Compaction] Session memory is empty (matches template)")
		return null
	}

	try {
		let lastSummarizedIndex: number

		// Prefer the caller-supplied id; fall back to module-level state for backwards compat
		const resolvedLastSummarizedMessageId = lastSummarizedMessageId ?? getLastSummarizedMessageId()

		if (resolvedLastSummarizedMessageId) {
			// Normal case: we know exactly which messages have been summarized
			lastSummarizedIndex = messages.findIndex((msg) => msg.id === resolvedLastSummarizedMessageId)

			if (lastSummarizedIndex === -1) {
				// The summarized message ID doesn't exist in current messages
				console.log("[Session Memory Compaction] Summarized message ID not found")
				return null
			}
		} else {
			// Resumed session case: session memory has content but we don't know the boundary
			// Set lastSummarizedIndex to last message so startIndex becomes messages.length (no messages kept initially)
			lastSummarizedIndex = messages.length - 1
			console.log("[Session Memory Compaction] Resumed session detected")
		}

		// Calculate the starting index for messages to keep
		const startIndex = calculateMessagesToKeepIndex(messages, lastSummarizedIndex)

		// Filter out old compact boundary messages from messagesToKeep
		const messagesToKeep = messages.slice(startIndex).filter((m) => !m.isTruncationMarker)

		// Truncate oversized sections to prevent session memory from consuming
		// the entire post-compact token budget
		const { truncatedContent, wasTruncated } = truncateSessionMemoryForCompact(sessionMemory)

		// Build the summary content
		let summaryContent = `## Session Memory\n${truncatedContent}`

		if (wasTruncated) {
			summaryContent += `\n\nSome session memory sections were truncated for length. The full session memory can be viewed in the session memory file.`
		}

		// Generate a unique condenseId for this summary
		const condenseId = crypto.randomUUID()

		// Use the last message's timestamp + 1 to ensure unique timestamp for summary
		const lastMsgTs = messages[messages.length - 1]?.ts ?? Date.now()

		const summaryMessage: ApiMessage = {
			role: "user",
			content: summaryContent,
			ts: lastMsgTs + 1,
			isSummary: true,
			condenseId,
		}

		// Tag ALL messages with condenseParent
		const newMessages = messages.map((msg) => {
			if (!msg.condenseParent) {
				return { ...msg, condenseParent: condenseId }
			}
			return msg
		})

		// Append the summary message at the end
		newMessages.push(summaryMessage)

		// Calculate post-compact token count
		const postCompactTokenCount = estimateMessageTokens([summaryMessage])

		// Only check threshold if one was provided (for autocompact)
		if (autoCompactThreshold !== undefined && postCompactTokenCount >= autoCompactThreshold) {
			console.log(
				`[Session Memory Compaction] Threshold exceeded: ${postCompactTokenCount} >= ${autoCompactThreshold}`,
			)
			return null
		}

		console.log("[Session Memory Compaction] Success")

		return {
			messages: newMessages,
			summary: summaryContent,
			cost: 0, // No API call made
			newContextTokens: postCompactTokenCount,
			condenseId,
			messagesToKeep,
			postCompactTokenCount,
		}
	} catch (error) {
		console.error("[Session Memory Compaction] Error:", error)
		return null
	}
}

/**
 * Result type for session memory compaction
 */
export type SessionMemoryCompactionResult = {
	messages: ApiMessage[]
	summary: string
	cost: number
	newContextTokens: number
	condenseId: string
	messagesToKeep: ApiMessage[]
	postCompactTokenCount: number
}

/**
 * Check if session memory compaction is enabled
 */
export function isSessionMemoryCompactEnabled(): boolean {
	// This will be controlled by the configuration setting
	// For now, return true by default
	return true
}

/**
 * Initialize session memory configuration from settings
 */
export function initializeSessionMemoryConfig(
	sessionMemoryConfig?: Partial<SessionMemoryConfig>,
	smCompactConfig?: Partial<SessionMemoryCompactConfig>,
): void {
	if (sessionMemoryConfig) {
		setSessionMemoryConfig(sessionMemoryConfig)
	}
	if (smCompactConfig) {
		setSessionMemoryCompactConfig(smCompactConfig)
	}
}

/**
 * Reset all session memory state (useful for testing)
 */
export function resetAllSessionMemoryState(): void {
	resetSessionMemoryState()
	resetSessionMemoryCompactConfig()
}
