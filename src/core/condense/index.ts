import Anthropic from "@anthropic-ai/sdk"
import crypto from "crypto"

import { TelemetryService } from "@roo-code/telemetry"

import { t } from "../../i18n"
import { ApiHandler, ApiHandlerCreateMessageMetadata } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning"
import { findLast } from "../../shared/array"
import { supportPrompt } from "../../shared/support-prompt"
import { RooIgnoreController } from "../ignore/RooIgnoreController"
import { generateFoldedFileContext } from "./foldedFileContext"
import type { HookSystem } from "../hooks"

export type { FoldedFileContextResult, FoldedFileContextOptions } from "./foldedFileContext"
export * from "./microCompact"
export * from "./sessionMemory"
export * from "./sessionMemoryCompact"

// Export helper functions for testing
export { groupMessagesByApiRound, estimateMessageTokens }

/**
 * Converts a tool_use block to a text representation.
 * This allows the conversation to be summarized without requiring the tools parameter.
 */
export function toolUseToText(block: Anthropic.Messages.ToolUseBlockParam): string {
	let input: string
	if (typeof block.input === "object" && block.input !== null) {
		input = Object.entries(block.input)
			.map(([key, value]) => {
				const formattedValue =
					typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : String(value)
				return `${key}: ${formattedValue}`
			})
			.join("\n")
	} else {
		input = String(block.input)
	}
	return `[Tool Use: ${block.name}]\n${input}`
}

/**
 * Converts a tool_result block to a text representation.
 * This allows the conversation to be summarized without requiring the tools parameter.
 */
export function toolResultToText(block: Anthropic.Messages.ToolResultBlockParam): string {
	const errorSuffix = block.is_error ? " (Error)" : ""
	if (typeof block.content === "string") {
		return `[Tool Result${errorSuffix}]\n${block.content}`
	} else if (Array.isArray(block.content)) {
		const contentText = block.content
			.map((contentBlock) => {
				if (contentBlock.type === "text") {
					return contentBlock.text
				}
				if (contentBlock.type === "image") {
					return "[Image]"
				}
				// Handle any other content block types
				return `[${(contentBlock as { type: string }).type}]`
			})
			.join("\n")
		return `[Tool Result${errorSuffix}]\n${contentText}`
	}
	return `[Tool Result${errorSuffix}]`
}

/**
 * Converts all tool_use and tool_result blocks in a message's content to text representations.
 * This is necessary for providers like Bedrock that require the tools parameter when tool blocks are present.
 * By converting to text, we can send the conversation for summarization without the tools parameter.
 *
 * @param content - The message content (string or array of content blocks)
 * @returns The transformed content with tool blocks converted to text blocks
 */
export function convertToolBlocksToText(
	content: string | Anthropic.Messages.ContentBlockParam[],
): string | Anthropic.Messages.ContentBlockParam[] {
	if (typeof content === "string") {
		return content
	}

	return content.map((block) => {
		if (block.type === "tool_use") {
			return {
				type: "text" as const,
				text: toolUseToText(block),
			}
		}
		if (block.type === "tool_result") {
			return {
				type: "text" as const,
				text: toolResultToText(block),
			}
		}
		return block
	})
}

/**
 * Transforms all messages by converting tool_use and tool_result blocks to text representations.
 * This ensures the conversation can be sent for summarization without requiring the tools parameter.
 *
 * @param messages - The messages to transform
 * @returns The transformed messages with tool blocks converted to text
 */
export function transformMessagesForCondensing<
	T extends { role: string; content: string | Anthropic.Messages.ContentBlockParam[] },
>(messages: T[]): T[] {
	return messages.map((msg) => ({
		...msg,
		content: convertToolBlocksToText(msg.content),
	}))
}

export const MIN_CONDENSE_THRESHOLD = 5 // Minimum percentage of context window to trigger condensing
export const MAX_CONDENSE_THRESHOLD = 100 // Maximum percentage of context window to trigger condensing

// Prompt-too-long retry configuration
const MAX_PTL_RETRIES = 2 // Maximum number of retry attempts when condensation hits prompt-too-long error
const PTL_RETRY_MARKER = "[earlier conversation truncated for condensation retry]"

/**
 * Checks if an error message indicates a "prompt too long" error from the API.
 * This handles multiple providers that may return different error messages.
 *
 * @param errorMessage - The error message to check
 * @returns True if this is a prompt-too-long error, false otherwise
 */
export function isPromptTooLongError(errorMessage: string): boolean {
	const lowerMessage = errorMessage.toLowerCase()
	// Common patterns across providers:
	// - Anthropic: "prompt is too long"
	// - OpenAI: "maximum context length exceeded"
	// - Generic: "context length exceeded", "too many tokens"
	return (
		lowerMessage.includes("prompt is too long") ||
		lowerMessage.includes("maximum context length exceeded") ||
		lowerMessage.includes("context length exceeded") ||
		lowerMessage.includes("too many tokens") ||
		lowerMessage.includes("tokens exceed")
	)
}

/**
 * Parses the token gap from a prompt-too-long error message.
 * Returns the number of tokens over the limit, or undefined if unparseable.
 *
 * @param errorMessage - The error message from the API
 * @returns The number of tokens over the limit, or undefined
 */
export function parsePromptTooLongTokenGap(errorMessage: string): number | undefined {
	// Try to match patterns like "137500 tokens > 135000 maximum" or "exceeded by 2500 tokens"
	const match =
		errorMessage.match(/(\d+)\s*tokens?\s*>\s*(\d+)/i) || errorMessage.match(/exceeded\s+by\s+(\d+)\s*tokens?/i)
	if (match) {
		const actual = parseInt(match[1], 10)
		const limit = match[2] ? parseInt(match[2], 10) : actual
		return Math.max(0, actual - limit)
	}
	return undefined
}

/**
 * Groups messages by API round (user message + assistant response).
 * This is used for intelligent truncation that removes complete conversation turns.
 *
 * @param messages - The messages to group
 * @returns Array of message groups, where each group represents one API round
 */
function groupMessagesByApiRound(messages: ApiMessage[]): ApiMessage[][] {
	const groups: ApiMessage[][] = []
	let currentGroup: ApiMessage[] = []

	for (const msg of messages) {
		if (msg.role === "user") {
			// Start a new group when we see a user message
			if (currentGroup.length > 0) {
				groups.push(currentGroup)
			}
			currentGroup = [msg]
		} else {
			// Add assistant messages to the current group
			currentGroup.push(msg)
		}
	}

	// Don't forget the last group
	if (currentGroup.length > 0) {
		groups.push(currentGroup)
	}

	return groups
}

/**
 * Estimates the token count for a message.
 * This is a rough estimation used for determining how many groups to drop.
 *
 * @param msg - The message to estimate tokens for
 * @returns Estimated token count
 */
function estimateMessageTokens(msg: ApiMessage): number {
	const content = msg.content
	if (typeof content === "string") {
		// Rough estimate: ~4 characters per token
		return Math.ceil(content.length / 4)
	} else if (Array.isArray(content)) {
		let total = 0
		for (const block of content) {
			if (block.type === "text") {
				total += Math.ceil(block.text.length / 4)
			} else if (block.type === "image") {
				// Images are expensive, estimate conservatively
				total += 1000
			} else {
				// Other blocks (tool_use, tool_result, etc.)
				total += 100
			}
		}
		return total
	}
	return 0
}

/**
 * Truncates messages from the head (beginning) to reduce token count when
 * condensation hits a prompt-too-long error. This is a fallback mechanism
 * when the condensed context itself is still too large.
 *
 * @param messages - The messages to truncate
 * @param errorMessage - The error message that triggered the retry
 * @returns Truncated messages, or null if nothing can be dropped
 */
export function truncateHeadForPromptTooLongRetry(messages: ApiMessage[], errorMessage: string): ApiMessage[] | null {
	// Strip our own synthetic marker from a previous retry before grouping
	const input =
		messages[0]?.role === "user" &&
		messages[0]?.isMeta &&
		typeof messages[0].content === "string" &&
		messages[0].content === PTL_RETRY_MARKER
			? messages.slice(1)
			: messages

	const groups = groupMessagesByApiRound(input)
	if (groups.length < 2) {
		return null // Not enough groups to drop
	}

	const tokenGap = parsePromptTooLongTokenGap(errorMessage)
	let dropCount: number

	if (tokenGap !== undefined && tokenGap > 0) {
		// Calculate how many groups to drop to cover the token gap
		let acc = 0
		dropCount = 0
		for (const group of groups) {
			const groupTokens = group.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
			acc += groupTokens
			dropCount++
			if (acc >= tokenGap) {
				break
			}
		}
	} else {
		// Fallback: drop 20% of groups when we can't parse the gap
		dropCount = Math.max(1, Math.floor(groups.length * 0.2))
	}

	// Keep at least one group so there's something to summarize
	dropCount = Math.min(dropCount, groups.length - 1)
	if (dropCount < 1) {
		return null
	}

	const sliced = groups.slice(dropCount).flat()

	// If the first message is an assistant message, prepend a synthetic user marker
	// to ensure the conversation starts with a user message (API requirement)
	if (sliced[0]?.role === "assistant") {
		return [
			{
				role: "user",
				content: PTL_RETRY_MARKER,
				ts: Date.now(),
				isMeta: true,
			},
			...sliced,
		]
	}

	return sliced
}

const SUMMARY_PROMPT = `You are a helpful AI assistant tasked with summarizing conversations.

CRITICAL: This is a summarization-only request. DO NOT call any tools or functions.
Your ONLY task is to analyze the conversation and produce a text summary.
Respond with text only - no tool calls will be processed.

CRITICAL: This summarization request is a SYSTEM OPERATION, not a user message.
When analyzing "user requests" and "user intent", completely EXCLUDE this summarization message.
The "most recent user request" and "next step" must be based on what the user was doing BEFORE this system message appeared.
The goal is for work to continue seamlessly after condensation - as if it never happened.`

/**
 * Injects synthetic tool_results for orphan tool_calls that don't have matching results.
 * This is necessary because OpenAI's Responses API rejects conversations with orphan tool_calls.
 * This can happen when the user triggers condense after receiving a tool_call (like attempt_completion)
 * but before responding to it.
 *
 * @param messages - The conversation messages to process
 * @returns The messages with synthetic tool_results appended if needed
 */
export function injectSyntheticToolResults(messages: ApiMessage[]): ApiMessage[] {
	// Find all tool_call IDs in assistant messages
	const toolCallIds = new Set<string>()
	// Find all tool_result IDs in user messages
	const toolResultIds = new Set<string>()

	for (const msg of messages) {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use") {
					toolCallIds.add(block.id)
				}
			}
		}
		if (msg.role === "user" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_result") {
					toolResultIds.add(block.tool_use_id)
				}
			}
		}
	}

	// Find orphans (tool_calls without matching tool_results)
	const orphanIds = [...toolCallIds].filter((id) => !toolResultIds.has(id))

	if (orphanIds.length === 0) {
		return messages
	}

	// Inject synthetic tool_results as a new user message
	const syntheticResults: Anthropic.Messages.ToolResultBlockParam[] = orphanIds.map((id) => ({
		type: "tool_result" as const,
		tool_use_id: id,
		content: "Context condensation triggered. Tool execution deferred.",
	}))

	const syntheticMessage: ApiMessage = {
		role: "user",
		content: syntheticResults,
		ts: Date.now(),
	}

	return [...messages, syntheticMessage]
}

/**
 * Extracts <command> blocks from a message's content.
 * These blocks represent active workflows that must be preserved across condensings.
 *
 * @param message - The message to extract command blocks from
 * @returns A string containing all command blocks found, or empty string if none
 */
export function extractCommandBlocks(message: ApiMessage): string {
	const content = message.content
	let text: string

	if (typeof content === "string") {
		text = content
	} else if (Array.isArray(content)) {
		// Concatenate all text blocks
		text = content
			.filter((block): block is Anthropic.Messages.TextBlockParam => block.type === "text")
			.map((block) => block.text)
			.join("\n")
	} else {
		return ""
	}

	// Match all <command> blocks including their content
	const commandRegex = /<command[^>]*>[\s\S]*?<\/command>/g
	const matches = text.match(commandRegex)

	if (!matches || matches.length === 0) {
		return ""
	}

	return matches.join("\n")
}

export type SummarizeResponse = {
	messages: ApiMessage[] // The messages after summarization
	summary: string // The summary text; empty string for no summary
	cost: number // The cost of the summarization operation
	newContextTokens?: number // The number of tokens in the context for the next API request
	error?: string // Populated iff the operation fails: error message shown to the user on failure (see Task.ts)
	errorDetails?: string // Detailed error information including stack trace and API error info
	condenseId?: string // The unique ID of the created Summary message, for linking to condense_context clineMessage
}

export type SummarizeConversationOptions = {
	messages: ApiMessage[]
	apiHandler: ApiHandler
	systemPrompt: string
	taskId: string
	isAutomaticTrigger?: boolean
	customCondensingPrompt?: string
	metadata?: ApiHandlerCreateMessageMetadata
	environmentDetails?: string
	filesReadByRoo?: string[]
	cwd?: string
	rooIgnoreController?: RooIgnoreController
	/** Optional hook system for executing pre/post compact hooks */
	hookSystem?: HookSystem
	/** Whether prompt-too-long retry is enabled */
	promptTooLongRetryEnabled?: boolean
	/** Maximum number of retry attempts when condensation hits prompt-too-long error */
	promptTooLongMaxRetries?: number
}

/**
 * Summarizes the conversation messages using an LLM call.
 *
 * This implements the "fresh start" model where:
 * - The summary becomes a user message (not assistant)
 * - Post-condense, the model sees only the summary (true fresh start)
 * - All messages are still stored but tagged with condenseParent
 * - <command> blocks from the original task are preserved across condensings
 * - File context (folded code definitions) can be preserved for continuity
 *
 * Environment details handling:
 * - For AUTOMATIC condensing (isAutomaticTrigger=true): Environment details are included
 *   in the summary because the API request is already in progress and the next user
 *   message won't have fresh environment details injected.
 * - For MANUAL condensing (isAutomaticTrigger=false): Environment details are NOT included
 *   because fresh environment details will be injected on the very next turn via
 *   getEnvironmentDetails() in recursivelyMakeClineRequests().
 */
export async function summarizeConversation(options: SummarizeConversationOptions): Promise<SummarizeResponse> {
	const {
		messages,
		apiHandler,
		systemPrompt,
		taskId,
		isAutomaticTrigger,
		customCondensingPrompt,
		metadata,
		environmentDetails,
		filesReadByRoo,
		cwd,
		rooIgnoreController,
		hookSystem,
		promptTooLongRetryEnabled = true,
		promptTooLongMaxRetries = MAX_PTL_RETRIES,
	} = options
	TelemetryService.instance.captureContextCondensed(
		taskId,
		isAutomaticTrigger ?? false,
		!!customCondensingPrompt?.trim(),
	)

	const response: SummarizeResponse = { messages, cost: 0, summary: "" }

	// Get messages to summarize (all messages since the last summary, if any)
	let messagesToSummarize = getMessagesSinceLastSummary(messages)

	if (messagesToSummarize.length <= 1) {
		const error =
			messages.length <= 1
				? t("common:errors.condense_not_enough_messages")
				: t("common:errors.condensed_recently")
		return { ...response, error }
	}

	// Check if there's a recent summary in the messages (edge case)
	const recentSummaryExists = messagesToSummarize.some((message: ApiMessage) => message.isSummary)

	if (recentSummaryExists && messagesToSummarize.length <= 2) {
		const error = t("common:errors.condensed_recently")
		return { ...response, error }
	}

	// Execute pre-compact hooks if hook system is provided
	let effectiveCustomCondensingPrompt = customCondensingPrompt
	if (hookSystem) {
		const trigger: "manual" | "auto" = isAutomaticTrigger ? "auto" : "manual"
		const preCompactResult = await hookSystem.executePreCompactHooks(trigger, customCondensingPrompt || null, {
			cwd,
			taskId,
		})

		// Use custom instructions from hooks if provided
		if (preCompactResult.newCustomInstructions) {
			effectiveCustomCondensingPrompt = preCompactResult.newCustomInstructions
		}

		// Log hook results
		if (preCompactResult.userMessage) {
			console.log(`[PreCompact Hooks] ${preCompactResult.userMessage}`)
		}
	}

	// Use custom prompt if provided and non-empty, otherwise use the default CONDENSE prompt
	// This respects user's custom condensing prompt setting
	const condenseInstructions = effectiveCustomCondensingPrompt?.trim() || supportPrompt.default.CONDENSE

	const finalRequestMessage: Anthropic.MessageParam = {
		role: "user",
		content: condenseInstructions,
	}

	// Validate that the API handler supports message creation
	if (!apiHandler || typeof apiHandler.createMessage !== "function") {
		console.error("API handler is invalid for condensing. Cannot proceed.")
		const error = t("common:errors.condense_handler_invalid")
		return { ...response, error }
	}

	// Note: this doesn't need to be a stream, consider using something like apiHandler.completePrompt
	const promptToUse = SUMMARY_PROMPT

	let summary = ""
	let cost = 0
	let outputTokens = 0
	let ptlAttempts = 0 // Prompt-too-long retry attempts

	// Retry loop for prompt-too-long errors
	while (true) {
		// Inject synthetic tool_results for orphan tool_calls to prevent API rejections
		// (e.g., when user triggers condense after receiving attempt_completion but before responding)
		const messagesWithToolResults = injectSyntheticToolResults(messagesToSummarize)

		// Transform tool_use and tool_result blocks to text representations.
		// This is necessary because some providers (like Bedrock via LiteLLM) require the `tools` parameter
		// when tool blocks are present. By converting them to text, we can send the conversation for
		// summarization without needing to pass the tools parameter.
		const messagesWithTextToolBlocks = transformMessagesForCondensing(
			maybeRemoveImageBlocks([...messagesWithToolResults, finalRequestMessage], apiHandler),
		)

		const requestMessages = messagesWithTextToolBlocks.map(({ role, content }) => ({ role, content }))

		try {
			const stream = apiHandler.createMessage(promptToUse, requestMessages, metadata)

			for await (const chunk of stream) {
				if (chunk.type === "text") {
					summary += chunk.text
				} else if (chunk.type === "usage") {
					// Record final usage chunk only
					cost = chunk.totalCost ?? 0
					outputTokens = chunk.outputTokens ?? 0
				}
			}
			// Success! Break out of the retry loop
			break
		} catch (error) {
			console.error("Error during condensing API call:", error)
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Check if this is a prompt-too-long error and retry is enabled
			if (promptTooLongRetryEnabled && isPromptTooLongError(errorMessage)) {
				ptlAttempts++
				console.log(
					`[Condense] Prompt too long error detected. Retry attempt ${ptlAttempts}/${promptTooLongMaxRetries}`,
				)

				if (ptlAttempts <= promptTooLongMaxRetries) {
					// Try to truncate messages and retry
					const truncated = truncateHeadForPromptTooLongRetry(messagesToSummarize, errorMessage)
					if (truncated) {
						const droppedMessages = messagesToSummarize.length - truncated.length
						console.log(
							`[Condense] Truncated ${droppedMessages} messages for retry. ${truncated.length} messages remaining.`,
						)
						messagesToSummarize = truncated
						continue // Retry with truncated messages
					} else {
						console.log(
							`[Condense] Cannot truncate further. Not enough messages to drop after ${ptlAttempts} attempts.`,
						)
					}
				} else {
					console.log(`[Condense] Max retry attempts (${promptTooLongMaxRetries}) exceeded. Giving up.`)
				}
			}

			// If we get here, either:
			// 1. This is not a prompt-too-long error
			// 2. Retry is disabled
			// 3. We've exhausted all retry attempts
			// 4. We cannot truncate further

			// Capture detailed error information for debugging
			let errorDetails = ""
			if (error instanceof Error) {
				errorDetails = `Error: ${error.message}`
				// Capture any additional API error properties
				const anyError = error as unknown as Record<string, unknown>
				if (anyError.status) {
					errorDetails += `\n\nHTTP Status: ${anyError.status}`
				}
				if (anyError.code) {
					errorDetails += `\nError Code: ${anyError.code}`
				}
				if (anyError.response) {
					try {
						errorDetails += `\n\nAPI Response:\n${JSON.stringify(anyError.response, null, 2)}`
					} catch {
						errorDetails += `\n\nAPI Response: [Unable to serialize]`
					}
				}
				if (anyError.body) {
					try {
						errorDetails += `\n\nResponse Body:\n${JSON.stringify(anyError.body, null, 2)}`
					} catch {
						errorDetails += `\n\nResponse Body: [Unable to serialize]`
					}
				}
			} else {
				errorDetails = String(error)
			}

			return {
				...response,
				cost,
				error: t("common:errors.condense_api_failed", { message: errorMessage }),
				errorDetails,
			}
		}
	}

	summary = summary.trim()

	if (summary.length === 0) {
		const error = t("common:errors.condense_failed")
		return { ...response, cost, error }
	}

	// Extract command blocks from the first message (original task)
	// These represent active workflows that must persist across condensings
	const firstMessage = messages[0]
	const commandBlocks = firstMessage ? extractCommandBlocks(firstMessage) : ""

	// Build the summary content as separate text blocks
	const summaryContent: Anthropic.Messages.ContentBlockParam[] = [
		{ type: "text", text: `## Conversation Summary\n${summary}` },
	]

	// Add command blocks (active workflows) in their own system-reminder block if present
	if (commandBlocks) {
		summaryContent.push({
			type: "text",
			text: `<system-reminder>
## Active Workflows
The following directives must be maintained across all future condensings:
${commandBlocks}
</system-reminder>`,
		})
	}

	// Generate and add folded file context (smart code folding) if file paths are provided
	// Each file gets its own <system-reminder> block as a separate content block
	if (filesReadByRoo && filesReadByRoo.length > 0 && cwd) {
		try {
			const foldedResult = await generateFoldedFileContext(filesReadByRoo, {
				cwd,
				rooIgnoreController,
			})
			if (foldedResult.sections.length > 0) {
				for (const section of foldedResult.sections) {
					if (section.trim()) {
						summaryContent.push({
							type: "text",
							text: section,
						})
					}
				}
			}
		} catch (error) {
			console.error("[summarizeConversation] Failed to generate folded file context:", error)
			// Continue without folded context - non-critical failure
		}
	}

	// Add environment details as a separate text block if provided AND this is an automatic trigger.
	// For manual condensing, fresh environment details will be injected on the next turn.
	// For automatic condensing, the API request is already in progress so we need them in the summary.
	if (isAutomaticTrigger && environmentDetails?.trim()) {
		summaryContent.push({
			type: "text",
			text: environmentDetails,
		})
	}

	// Generate a unique condenseId for this summary
	const condenseId = crypto.randomUUID()

	// Use the last message's timestamp + 1 to ensure unique timestamp for summary.
	// The summary goes at the end of all messages.
	const lastMsgTs = messages[messages.length - 1]?.ts ?? Date.now()

	const summaryMessage: ApiMessage = {
		role: "user", // Fresh start model: summary is a user message
		content: summaryContent,
		ts: lastMsgTs + 1, // Unique timestamp after last message
		isSummary: true,
		condenseId, // Unique ID for this summary, used to track which messages it replaces
	}

	// NON-DESTRUCTIVE CONDENSE:
	// Tag ALL existing messages with condenseParent so they are filtered out when
	// the effective history is computed. The summary message is the only message
	// that will be visible to the API after condensing (fresh start model).
	//
	// Storage structure after condense:
	// [msg1(parent=X), msg2(parent=X), ..., msgN(parent=X), summary(id=X)]
	//
	// Effective for API (filtered by getEffectiveApiHistory):
	// [summary]  ← Fresh start!

	// Tag ALL messages with condenseParent
	const newMessages = messages.map((msg) => {
		// If message already has a condenseParent, we leave it - nested condense is handled by filtering
		if (!msg.condenseParent) {
			return { ...msg, condenseParent: condenseId }
		}
		return msg
	})

	// Append the summary message at the end
	newMessages.push(summaryMessage)

	// Count the tokens in the context for the next API request
	// After condense, the context will contain: system prompt + summary + tool definitions
	const systemPromptMessage: ApiMessage = { role: "user", content: systemPrompt }

	// Count actual summaryMessage content directly instead of using outputTokens as a proxy
	// This ensures we account for wrapper text (## Conversation Summary, <system-reminder>, <environment_details>)
	const contextBlocks = [systemPromptMessage, summaryMessage].flatMap((message) =>
		typeof message.content === "string" ? [{ text: message.content, type: "text" as const }] : message.content,
	)

	const messageTokens = await apiHandler.countTokens(contextBlocks)

	// Count tool definition tokens if tools are provided
	let toolTokens = 0
	if (metadata?.tools && metadata.tools.length > 0) {
		const toolsText = JSON.stringify(metadata.tools)
		toolTokens = await apiHandler.countTokens([{ text: toolsText, type: "text" }])
	}

	const newContextTokens = messageTokens + toolTokens

	// Execute post-compact hooks if hook system is provided
	if (hookSystem) {
		const trigger: "manual" | "auto" = isAutomaticTrigger ? "auto" : "manual"
		// Estimate previous token count (before condensation)
		const prevContextBlocks = messages.flatMap((message) =>
			typeof message.content === "string" ? [{ text: message.content, type: "text" as const }] : message.content,
		)
		const prevContextTokens = await apiHandler.countTokens(prevContextBlocks)

		const postCompactResult = await hookSystem.executePostCompactHooks(
			trigger,
			summary,
			prevContextTokens,
			newContextTokens,
			{ cwd, taskId },
		)

		// Log hook results
		if (postCompactResult.userMessage) {
			console.log(`[PostCompact Hooks] ${postCompactResult.userMessage}`)
		}
	}

	return { messages: newMessages, summary, cost, newContextTokens, condenseId }
}

/**
 * Returns the list of all messages since the last summary message, including the summary.
 * Returns all messages if there is no summary.
 *
 * Note: Summary messages are always created with role: "user" (fresh-start model),
 * so the first message since the last summary is guaranteed to be a user message.
 */
export function getMessagesSinceLastSummary(messages: ApiMessage[]): ApiMessage[] {
	const lastSummaryIndexReverse = [...messages].reverse().findIndex((message) => message.isSummary)

	if (lastSummaryIndexReverse === -1) {
		return messages
	}

	const lastSummaryIndex = messages.length - lastSummaryIndexReverse - 1
	return messages.slice(lastSummaryIndex)
}

/**
 * Filters the API conversation history to get the "effective" messages to send to the API.
 *
 * Fresh Start Model:
 * - When a summary exists, return only messages from the summary onwards (fresh start)
 * - Messages with a condenseParent pointing to an existing summary are filtered out
 *
 * Messages with a truncationParent that points to an existing truncation marker are also filtered out,
 * as they have been hidden by sliding window truncation.
 *
 * This allows non-destructive condensing and truncation where messages are tagged but not deleted,
 * enabling accurate rewind operations while still sending condensed/truncated history to the API.
 *
 * @param messages - The full API conversation history including tagged messages
 * @returns The filtered history that should be sent to the API
 */
export function getEffectiveApiHistory(messages: ApiMessage[]): ApiMessage[] {
	// Find the most recent summary message
	const lastSummary = findLast(messages, (msg) => msg.isSummary === true)

	if (lastSummary) {
		// Fresh start model: return only messages from the summary onwards
		const summaryIndex = messages.indexOf(lastSummary)
		let messagesFromSummary = messages.slice(summaryIndex)

		// Collect all tool_use IDs from assistant messages in the result
		// This is needed to filter out orphan tool_result blocks that reference
		// tool_use IDs from messages that were condensed away
		const toolUseIds = new Set<string>()
		for (const msg of messagesFromSummary) {
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use" && (block as Anthropic.Messages.ToolUseBlockParam).id) {
						toolUseIds.add((block as Anthropic.Messages.ToolUseBlockParam).id)
					}
				}
			}
		}

		// Filter out orphan tool_result blocks from user messages
		messagesFromSummary = messagesFromSummary
			.map((msg) => {
				if (msg.role === "user" && Array.isArray(msg.content)) {
					const filteredContent = msg.content.filter((block) => {
						if (block.type === "tool_result") {
							return toolUseIds.has((block as Anthropic.Messages.ToolResultBlockParam).tool_use_id)
						}
						return true
					})
					// If all content was filtered out, mark for removal
					if (filteredContent.length === 0) {
						return null
					}
					// If some content was filtered, return updated message
					if (filteredContent.length !== msg.content.length) {
						return { ...msg, content: filteredContent }
					}
				}
				return msg
			})
			.filter((msg): msg is ApiMessage => msg !== null)

		// Still need to filter out any truncated messages within this range
		const existingTruncationIds = new Set<string>()
		for (const msg of messagesFromSummary) {
			if (msg.isTruncationMarker && msg.truncationId) {
				existingTruncationIds.add(msg.truncationId)
			}
		}

		return messagesFromSummary.filter((msg) => {
			// Filter out truncated messages if their truncation marker exists
			if (msg.truncationParent && existingTruncationIds.has(msg.truncationParent)) {
				return false
			}
			return true
		})
	}

	// No summary - filter based on condenseParent and truncationParent as before
	// This handles the case of orphaned condenseParent tags (summary was deleted via rewind)

	// Collect all condenseIds of summaries that exist in the current history
	const existingSummaryIds = new Set<string>()
	// Collect all truncationIds of truncation markers that exist in the current history
	const existingTruncationIds = new Set<string>()

	for (const msg of messages) {
		if (msg.isSummary && msg.condenseId) {
			existingSummaryIds.add(msg.condenseId)
		}
		if (msg.isTruncationMarker && msg.truncationId) {
			existingTruncationIds.add(msg.truncationId)
		}
	}

	// Filter out messages whose condenseParent points to an existing summary
	// or whose truncationParent points to an existing truncation marker.
	// Messages with orphaned parents (summary/marker was deleted) are included.
	return messages.filter((msg) => {
		// Filter out condensed messages if their summary exists
		if (msg.condenseParent && existingSummaryIds.has(msg.condenseParent)) {
			return false
		}
		// Filter out truncated messages if their truncation marker exists
		if (msg.truncationParent && existingTruncationIds.has(msg.truncationParent)) {
			return false
		}
		return true
	})
}

/**
 * Cleans up orphaned condenseParent and truncationParent references after a truncation operation (rewind/delete).
 * When a summary message or truncation marker is deleted, messages that were tagged with its ID
 * should have their parent reference cleared so they become active again.
 *
 * This function should be called after any operation that truncates the API history
 * to ensure messages are properly restored when their summary or truncation marker is deleted.
 *
 * @param messages - The API conversation history after truncation
 * @returns The cleaned history with orphaned condenseParent and truncationParent fields cleared
 */
export function cleanupAfterTruncation(messages: ApiMessage[]): ApiMessage[] {
	// Collect all condenseIds of summaries that still exist
	const existingSummaryIds = new Set<string>()
	// Collect all truncationIds of truncation markers that still exist
	const existingTruncationIds = new Set<string>()

	for (const msg of messages) {
		if (msg.isSummary && msg.condenseId) {
			existingSummaryIds.add(msg.condenseId)
		}
		if (msg.isTruncationMarker && msg.truncationId) {
			existingTruncationIds.add(msg.truncationId)
		}
	}

	// Clear orphaned parent references for messages whose summary or truncation marker was deleted
	return messages.map((msg) => {
		let needsUpdate = false

		// Check for orphaned condenseParent
		if (msg.condenseParent && !existingSummaryIds.has(msg.condenseParent)) {
			needsUpdate = true
		}

		// Check for orphaned truncationParent
		if (msg.truncationParent && !existingTruncationIds.has(msg.truncationParent)) {
			needsUpdate = true
		}

		if (needsUpdate) {
			// Create a new object without orphaned parent references
			const { condenseParent, truncationParent, ...rest } = msg
			const result: ApiMessage = rest as ApiMessage

			// Keep condenseParent if its summary still exists
			if (condenseParent && existingSummaryIds.has(condenseParent)) {
				result.condenseParent = condenseParent
			}

			// Keep truncationParent if its truncation marker still exists
			if (truncationParent && existingTruncationIds.has(truncationParent)) {
				result.truncationParent = truncationParent
			}

			return result
		}
		return msg
	})
}
