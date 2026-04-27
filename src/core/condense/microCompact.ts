import { Anthropic } from "@anthropic-ai/sdk"
import { ApiMessage } from "../task-persistence/apiMessages"

/**
 * Configuration for microcompact feature.
 */
export type MicrocompactConfig = {
	/** Master switch. When false, microcompact is a no-op. */
	enabled: boolean
	/** Number of messages back to start clearing tool results. */
	threshold: number
	/** Keep this many most-recent compactable tool results. */
	keepRecent: number
}

/**
 * Default configuration for microcompact.
 */
export const DEFAULT_MICROCOMPACT_CONFIG: MicrocompactConfig = {
	enabled: true,
	threshold: 5,
	keepRecent: 3,
}

/**
 * Message cleared placeholder text.
 */
export const MICROCOMPACT_CLEARED_MESSAGE = "[Content condensed - tool: {toolName}]"

/**
 * Tools that are eligible for microcompaction.
 * These tools produce large output that can be safely cleared after some time.
 */
const COMPACTABLE_TOOLS = new Set<string>([
	"read_file",
	"execute_command",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"codebase_search",
	"browser_action",
])

/**
 * Result of a microcompact operation.
 */
export type MicrocompactResult = {
	messages: ApiMessage[]
	tokensSaved: number
	toolsCleared: number
	toolsKept: number
}

/**
 * Helper to estimate token count for text content.
 * This is a rough approximation - actual token counting should use the API handler.
 */
function estimateTextTokens(text: string): number {
	// Rough approximation: ~4 characters per token for English text
	return Math.ceil(text.length / 4)
}

/**
 * Helper to calculate tool result tokens.
 */
function calculateToolResultTokens(block: Anthropic.Messages.ToolResultBlockParam): number {
	if (!block.content) {
		return 0
	}

	if (typeof block.content === "string") {
		return estimateTextTokens(block.content)
	}

	// Array of TextBlockParam | ImageBlockParam | DocumentBlockParam
	const contentArray = block.content as Array<
		Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam | Anthropic.Messages.DocumentBlockParam
	>
	return contentArray.reduce((sum, item) => {
		if (item.type === "text") {
			return sum + estimateTextTokens(item.text)
		}
		// Images/documents are approximately 2000 tokens regardless of format
		if (item.type === "image" || item.type === "document") {
			return sum + 2000
		}
		return sum
	}, 0)
}

/**
 * Walk messages and collect tool_use IDs whose tool name is in COMPACTABLE_TOOLS,
 * in encounter order.
 */
function collectCompactableToolIds(messages: ApiMessage[]): Array<{ id: string; toolName: string }> {
	const ids: Array<{ id: string; toolName: string }> = []
	for (const message of messages) {
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === "tool_use" && COMPACTABLE_TOOLS.has(block.name)) {
					ids.push({ id: block.id, toolName: block.name })
				}
			}
		}
	}
	return ids
}

/**
 * Build a map from tool_use_id to tool name for all compactable tools.
 */
function buildToolNameMap(messages: ApiMessage[]): Map<string, string> {
	const toolNameMap = new Map<string, string>()
	for (const message of messages) {
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === "tool_use" && COMPACTABLE_TOOLS.has(block.name)) {
					toolNameMap.set(block.id, block.name)
				}
			}
		}
	}
	return toolNameMap
}

/**
 * Get the cleared message placeholder for a specific tool.
 */
function getClearedMessage(toolName: string): string {
	return MICROCOMPACT_CLEARED_MESSAGE.replace("{toolName}", toolName)
}

/**
 * Microcompact conversation messages by clearing old tool result content.
 *
 * This function identifies compactable tool results (file reads, shell output, grep results, etc.)
 * and replaces their content with a placeholder message. Only tool results older than the
 * configured threshold are cleared, preserving the most recent N results for context.
 *
 * @param messages - The conversation messages to microcompact
 * @param config - The microcompact configuration
 * @returns The microcompact result with modified messages and statistics
 */
export function microcompactMessages(
	messages: ApiMessage[],
	config: Partial<MicrocompactConfig> = {},
): MicrocompactResult {
	const finalConfig: MicrocompactConfig = {
		...DEFAULT_MICROCOMPACT_CONFIG,
		...config,
	}

	// If disabled, return messages unchanged
	if (!finalConfig.enabled) {
		return { messages, tokensSaved: 0, toolsCleared: 0, toolsKept: 0 }
	}

	// Collect all compactable tool IDs in encounter order
	const compactableTools = collectCompactableToolIds(messages)

	// If there are fewer than threshold + keepRecent tools, no need to clear
	if (compactableTools.length < finalConfig.threshold + finalConfig.keepRecent) {
		return { messages, tokensSaved: 0, toolsCleared: 0, toolsKept: compactableTools.length }
	}

	// Determine which tools to clear and which to keep
	// Keep the most recent N tools, clear the rest
	const keepRecent = Math.max(0, finalConfig.keepRecent)
	const toolsToKeep =
		keepRecent > 0 ? new Set(compactableTools.slice(-keepRecent).map((t) => t.id)) : new Set<string>()
	const toolsToClear = new Set(compactableTools.filter((t) => !toolsToKeep.has(t.id)).map((t) => t.id))

	if (toolsToClear.size === 0) {
		return { messages, tokensSaved: 0, toolsCleared: 0, toolsKept: compactableTools.length }
	}

	// Build a map from tool_use_id to tool name for placeholder messages
	const toolNameMap = buildToolNameMap(messages)

	let tokensSaved = 0
	let toolsCleared = 0

	// Clear tool result content
	const result: ApiMessage[] = messages.map((message) => {
		if (message.role !== "user" || !Array.isArray(message.content)) {
			return message
		}

		let touched = false
		const newContent = message.content.map((block) => {
			if (block.type === "tool_result" && toolsToClear.has(block.tool_use_id)) {
				const toolName = toolNameMap.get(block.tool_use_id) || "unknown"
				const clearedMessage = getClearedMessage(toolName)

				// Check if already cleared to avoid double-counting
				if (typeof block.content === "string" && block.content === clearedMessage) {
					return block
				}

				tokensSaved += calculateToolResultTokens(block)
				toolsCleared++
				touched = true
				return { ...block, content: clearedMessage }
			}
			return block
		})

		if (!touched) {
			return message
		}

		return {
			...message,
			content: newContent,
		}
	})

	console.log(
		`[Microcompact] Cleared ${toolsCleared} tool results (~${tokensSaved} tokens), kept last ${toolsToKeep.size}`,
	)

	return {
		messages: result,
		tokensSaved,
		toolsCleared,
		toolsKept: toolsToKeep.size,
	}
}

/**
 * Estimate the number of tokens that could be saved by microcompacting.
 * This does not modify the messages, just returns an estimate.
 *
 * @param messages - The conversation messages to analyze
 * @param config - The microcompact configuration
 * @returns Estimated number of tokens that would be saved
 */
export function estimateMicrocompactSavings(messages: ApiMessage[], config: Partial<MicrocompactConfig> = {}): number {
	const finalConfig: MicrocompactConfig = {
		...DEFAULT_MICROCOMPACT_CONFIG,
		...config,
	}

	if (!finalConfig.enabled) {
		return 0
	}

	const compactableTools = collectCompactableToolIds(messages)

	if (compactableTools.length < finalConfig.threshold + finalConfig.keepRecent) {
		return 0
	}

	const keepRecent = Math.max(0, finalConfig.keepRecent)
	const toolsToKeep =
		keepRecent > 0 ? new Set(compactableTools.slice(-keepRecent).map((t) => t.id)) : new Set<string>()
	const toolsToClear = new Set(compactableTools.filter((t) => !toolsToKeep.has(t.id)).map((t) => t.id))

	if (toolsToClear.size === 0) {
		return 0
	}

	let tokensSaved = 0
	const toolNameMap = buildToolNameMap(messages)

	for (const message of messages) {
		if (message.role !== "user" || !Array.isArray(message.content)) {
			continue
		}

		for (const block of message.content) {
			if (block.type === "tool_result" && toolsToClear.has(block.tool_use_id)) {
				const toolName = toolNameMap.get(block.tool_use_id) || "unknown"
				const clearedMessage = getClearedMessage(toolName)

				// Skip if already cleared
				if (typeof block.content === "string" && block.content === clearedMessage) {
					continue
				}

				tokensSaved += calculateToolResultTokens(block)
			}
		}
	}

	return tokensSaved
}
