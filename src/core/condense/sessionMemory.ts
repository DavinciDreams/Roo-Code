/**
 * Session Memory Extraction for Roo Code
 *
 * This module extracts key information from conversations and stores it
 * as structured session memory that can be used for condensation.
 *
 * Adapted from Claude Code CLI's session memory system.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"

const MAX_SECTION_LENGTH = 2000
const MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000

/**
 * Default session memory template
 */
export const DEFAULT_SESSION_MEMORY_TEMPLATE = `
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

# Files and Functions
_What are the important files? In short, what do they contain and why are they relevant?_

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

# Codebase and System Documentation
_What are the important system components? How do they work/fit together?_

# Learnings
_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_

# Worklog
_Step by step, what was attempted, done? Very terse summary for each step_
`

/**
 * Default prompt for updating session memory
 */
function getDefaultUpdatePrompt(): string {
	return `IMPORTANT: This message and these instructions are NOT part of the actual user conversation. Do NOT include any references to "note-taking", "session notes extraction", or these update instructions in the notes content.

Based on the user conversation above (EXCLUDING this note-taking instruction message), update the session notes file.

The file {{notesPath}} has already been read for you. Here are its current contents:
<current_notes_content>
{{currentNotes}}
</current_notes_content>

Your ONLY task is to update the notes file with the new information from the conversation.

CRITICAL RULES FOR EDITING:
- The file must maintain its exact structure with all sections, headers, and italic descriptions intact
-- NEVER modify, delete, or add section headers (the lines starting with '#' like # Task specification)
-- NEVER modify or delete the italic _section description_ lines (these are the lines in italics immediately following each header - they start and end with underscores)
-- The italic _section descriptions_ are TEMPLATE INSTRUCTIONS that must be preserved exactly as-is - they guide what content belongs in each section
-- ONLY update the actual content that appears BELOW the italic _section descriptions_ within each existing section
-- Do NOT add any new sections, summaries, or information outside the existing structure
- Do NOT reference this note-taking process or instructions anywhere in the notes
- It's OK to skip updating a section if there are no substantial new insights to add. Do not add filler content like "No info yet", just leave sections blank/unedited if appropriate.
- Write DETAILED, INFO-DENSE content for each section - include specifics like file paths, function names, error messages, exact commands, technical details, etc.
- For "Key results", include the complete, exact output the user requested (e.g., full table, full answer, etc.)
- Keep each section under ~${MAX_SECTION_LENGTH} tokens/words - if a section is approaching this limit, condense it by cycling out less important details while preserving the most critical information
- Focus on actionable, specific information that would help someone understand or recreate the work discussed in the conversation
- IMPORTANT: Always update "Current State" to reflect the most recent work - this is critical for continuity after compaction

STRUCTURE PRESERVATION REMINDER:
Each section has TWO parts that must be preserved exactly as they appear in the current file:
1. The section header (line starting with #)
2. The italic description line (the _italicized text_ immediately after the header - this is a template instruction)

You ONLY update the actual content that comes AFTER these two preserved lines. The italic description lines starting and ending with underscores are part of the template structure, NOT content to be edited or removed.

REMEMBER: Update the notes with insights from the actual user conversation only. Do not delete or change section headers or italic _section descriptions_.`
}

/**
 * Configuration for session memory extraction
 */
export type SessionMemoryConfig = {
	/** Minimum context window tokens before initializing session memory */
	minimumMessageTokensToInit: number
	/** Minimum context window growth (in tokens) between session memory updates */
	minimumTokensBetweenUpdate: number
	/** Number of tool calls between session memory updates */
	toolCallsBetweenUpdates: number
}

/**
 * Default configuration values
 */
export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
	minimumMessageTokensToInit: 10000,
	minimumTokensBetweenUpdate: 5000,
	toolCallsBetweenUpdates: 3,
}

/**
 * Current session memory configuration
 */
let sessionMemoryConfig: SessionMemoryConfig = {
	...DEFAULT_SESSION_MEMORY_CONFIG,
}

/**
 * Track the last summarized message ID
 */
let lastSummarizedMessageId: string | undefined

/**
 * Track context size at last memory extraction
 */
let tokensAtLastExtraction = 0

/**
 * Track whether session memory has been initialized
 */
let sessionMemoryInitialized = false

/**
 * Track extraction state
 */
let extractionStartedAt: number | undefined

/**
 * Track tool call count since last update
 */
let toolCallsSinceLastUpdate = 0

/**
 * Get the message ID up to which the session memory is current
 */
export function getLastSummarizedMessageId(): string | undefined {
	return lastSummarizedMessageId
}

/**
 * Set the last summarized message ID
 */
export function setLastSummarizedMessageId(messageId: string | undefined): void {
	lastSummarizedMessageId = messageId
}

/**
 * Mark extraction as started
 */
export function markExtractionStarted(): void {
	extractionStartedAt = Date.now()
}

/**
 * Mark extraction as completed
 */
export function markExtractionCompleted(): void {
	extractionStartedAt = undefined
}

/**
 * Wait for any in-progress session memory extraction to complete (with 15s timeout)
 */
export async function waitForSessionMemoryExtraction(): Promise<void> {
	const EXTRACTION_WAIT_TIMEOUT_MS = 15000
	const EXTRACTION_STALE_THRESHOLD_MS = 60000 // 1 minute

	const startTime = Date.now()
	while (extractionStartedAt) {
		const extractionAge = Date.now() - extractionStartedAt
		if (extractionAge > EXTRACTION_STALE_THRESHOLD_MS) {
			// Extraction is stale, don't wait
			return
		}

		if (Date.now() - startTime > EXTRACTION_WAIT_TIMEOUT_MS) {
			// Timeout - continue anyway
			return
		}

		await new Promise((resolve) => setTimeout(resolve, 1000))
	}
}

/**
 * Get the current session memory configuration
 */
export function getSessionMemoryConfig(): SessionMemoryConfig {
	return { ...sessionMemoryConfig }
}

/**
 * Set the session memory configuration
 */
export function setSessionMemoryConfig(config: Partial<SessionMemoryConfig>): void {
	sessionMemoryConfig = {
		...sessionMemoryConfig,
		...config,
	}
}

/**
 * Record the context size at the time of extraction
 */
export function recordExtractionTokenCount(currentTokenCount: number): void {
	tokensAtLastExtraction = currentTokenCount
}

/**
 * Check if session memory has been initialized
 */
export function isSessionMemoryInitialized(): boolean {
	return sessionMemoryInitialized
}

/**
 * Mark session memory as initialized
 */
export function markSessionMemoryInitialized(): void {
	sessionMemoryInitialized = true
}

/**
 * Check if we've met the threshold to initialize session memory
 */
export function hasMetInitializationThreshold(currentTokenCount: number): boolean {
	return currentTokenCount >= sessionMemoryConfig.minimumMessageTokensToInit
}

/**
 * Check if we've met the threshold for the next update
 */
export function hasMetUpdateThreshold(currentTokenCount: number): boolean {
	const tokensSinceLastExtraction = currentTokenCount - tokensAtLastExtraction
	return tokensSinceLastExtraction >= sessionMemoryConfig.minimumTokensBetweenUpdate
}

/**
 * Get the configured number of tool calls between updates
 */
export function getToolCallsBetweenUpdates(): number {
	return sessionMemoryConfig.toolCallsBetweenUpdates
}

/**
 * Increment tool call count
 */
export function incrementToolCallCount(): void {
	toolCallsSinceLastUpdate++
}

/**
 * Get current tool call count
 */
export function getToolCallCount(): number {
	return toolCallsSinceLastUpdate
}

/**
 * Reset tool call count
 */
export function resetToolCallCount(): void {
	toolCallsSinceLastUpdate = 0
}

/**
 * Reset session memory state (useful for testing)
 */
export function resetSessionMemoryState(): void {
	sessionMemoryConfig = { ...DEFAULT_SESSION_MEMORY_CONFIG }
	tokensAtLastExtraction = 0
	sessionMemoryInitialized = false
	lastSummarizedMessageId = undefined
	extractionStartedAt = undefined
	toolCallsSinceLastUpdate = 0
}

/**
 * Estimate token count for text content
 */
function estimateTextTokens(text: string): number {
	// Rough approximation: ~4 characters per token for English text
	return Math.ceil(text.length / 4)
}

/**
 * Parse the session memory file and analyze section sizes
 */
function analyzeSectionSizes(content: string): Record<string, number> {
	const sections: Record<string, number> = {}
	const lines = content.split("\n")
	let currentSection = ""
	let currentContent: string[] = []

	for (const line of lines) {
		if (line.startsWith("# ")) {
			if (currentSection && currentContent.length > 0) {
				const sectionContent = currentContent.join("\n").trim()
				sections[currentSection] = estimateTextTokens(sectionContent)
			}
			currentSection = line
			currentContent = []
		} else {
			currentContent.push(line)
		}
	}

	if (currentSection && currentContent.length > 0) {
		const sectionContent = currentContent.join("\n").trim()
		sections[currentSection] = estimateTextTokens(sectionContent)
	}

	return sections
}

/**
 * Generate reminders for sections that are too long
 */
function generateSectionReminders(sectionSizes: Record<string, number>, totalTokens: number): string {
	const overBudget = totalTokens > MAX_TOTAL_SESSION_MEMORY_TOKENS
	const oversizedSections = Object.entries(sectionSizes)
		.filter(([_, tokens]) => tokens > MAX_SECTION_LENGTH)
		.sort(([, a], [, b]) => b - a)
		.map(([section, tokens]) => `- "${section}" is ~${tokens} tokens (limit: ${MAX_SECTION_LENGTH})`)

	if (oversizedSections.length === 0 && !overBudget) {
		return ""
	}

	const parts: string[] = []

	if (overBudget) {
		parts.push(
			`\n\nCRITICAL: The session memory file is currently ~${totalTokens} tokens, which exceeds the maximum of ${MAX_TOTAL_SESSION_MEMORY_TOKENS} tokens. You MUST condense the file to fit within this budget. Aggressively shorten oversized sections by removing less important details, merging related items, and summarizing older entries. Prioritize keeping "Current State" and "Errors & Corrections" accurate and detailed.`,
		)
	}

	if (oversizedSections.length > 0) {
		parts.push(
			`\n\n${overBudget ? "Oversized sections to condense" : "IMPORTANT: The following sections exceed the per-section limit and MUST be condensed"}:\n${oversizedSections.join("\n")}`,
		)
	}

	return parts.join("")
}

/**
 * Substitute variables in the prompt template using {{variable}} syntax
 */
function substituteVariables(template: string, variables: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
		Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
	)
}

/**
 * Check if the session memory content is essentially empty (matches the template)
 */
export function isSessionMemoryEmpty(content: string): boolean {
	// Compare trimmed content to detect if it's just the template
	return content.trim() === DEFAULT_SESSION_MEMORY_TEMPLATE.trim()
}

/**
 * Build the session memory update prompt
 */
export function buildSessionMemoryUpdatePrompt(currentNotes: string, notesPath: string): string {
	const promptTemplate = getDefaultUpdatePrompt()

	// Analyze section sizes and generate reminders if needed
	const sectionSizes = analyzeSectionSizes(currentNotes)
	const totalTokens = estimateTextTokens(currentNotes)
	const sectionReminders = generateSectionReminders(sectionSizes, totalTokens)

	// Substitute variables in the prompt
	const variables = {
		currentNotes,
		notesPath,
	}

	const basePrompt = substituteVariables(promptTemplate, variables)

	// Add section size reminders and/or total budget warnings
	return basePrompt + sectionReminders
}

/**
 * Truncate session memory sections that exceed the per-section token limit
 */
export function truncateSessionMemoryForCompact(content: string): {
	truncatedContent: string
	wasTruncated: boolean
} {
	const lines = content.split("\n")
	const maxCharsPerSection = MAX_SECTION_LENGTH * 4 // estimateTextTokens uses length/4
	const outputLines: string[] = []
	let currentSectionLines: string[] = []
	let currentSectionHeader = ""
	let wasTruncated = false

	for (const line of lines) {
		if (line.startsWith("# ")) {
			const result = flushSessionSection(currentSectionHeader, currentSectionLines, maxCharsPerSection)
			outputLines.push(...result.lines)
			wasTruncated = wasTruncated || result.wasTruncated
			currentSectionHeader = line
			currentSectionLines = []
		} else {
			currentSectionLines.push(line)
		}
	}

	// Flush the last section
	const result = flushSessionSection(currentSectionHeader, currentSectionLines, maxCharsPerSection)
	outputLines.push(...result.lines)
	wasTruncated = wasTruncated || result.wasTruncated

	return {
		truncatedContent: outputLines.join("\n"),
		wasTruncated,
	}
}

function flushSessionSection(
	sectionHeader: string,
	sectionLines: string[],
	maxCharsPerSection: number,
): { lines: string[]; wasTruncated: boolean } {
	if (!sectionHeader) {
		return { lines: sectionLines, wasTruncated: false }
	}

	const sectionContent = sectionLines.join("\n")
	if (sectionContent.length <= maxCharsPerSection) {
		return { lines: [sectionHeader, ...sectionLines], wasTruncated: false }
	}

	// Truncate at a line boundary near the limit
	let charCount = 0
	const keptLines: string[] = [sectionHeader]
	for (const line of sectionLines) {
		if (charCount + line.length + 1 > maxCharsPerSection) {
			break
		}
		keptLines.push(line)
		charCount += line.length + 1
	}
	keptLines.push("\n[... section truncated for length ...]")
	return { lines: keptLines, wasTruncated: true }
}

/**
 * Extract session memory from conversation messages
 *
 * This function uses the AI to extract and update session memory based on
 * the conversation history.
 *
 * @param messages - The conversation messages to extract memory from
 * @param currentSessionMemory - The current session memory content (if any)
 * @param apiHandler - The API handler to use for the extraction
 * @returns The updated session memory content
 */
export async function extractSessionMemory(
	messages: ApiMessage[],
	currentSessionMemory: string | null,
	apiHandler: ApiHandler,
): Promise<string> {
	// If no current memory, start with the template
	const currentNotes = currentSessionMemory || DEFAULT_SESSION_MEMORY_TEMPLATE

	// Build the update prompt
	const prompt = buildSessionMemoryUpdatePrompt(currentNotes, "session-memory.md")

	// Transform messages for the API (convert tool blocks to text)
	const messagesForApi = messages.map((msg) => ({
		role: msg.role,
		content:
			typeof msg.content === "string"
				? msg.content
				: msg.content.map((block) => {
						if (block.type === "tool_use") {
							return {
								type: "text" as const,
								text: `[Tool Use: ${(block as Anthropic.Messages.ToolUseBlockParam).name}]\n${JSON.stringify((block as Anthropic.Messages.ToolUseBlockParam).input, null, 2)}`,
							}
						}
						if (block.type === "tool_result") {
							const errorSuffix = (block as Anthropic.Messages.ToolResultBlockParam).is_error
								? " (Error)"
								: ""
							if (typeof (block as Anthropic.Messages.ToolResultBlockParam).content === "string") {
								return {
									type: "text" as const,
									text: `[Tool Result${errorSuffix}]\n${(block as Anthropic.Messages.ToolResultBlockParam).content}`,
								}
							}
							return {
								type: "text" as const,
								text: `[Tool Result${errorSuffix}]\n[Complex content]`,
							}
						}
						return block
					}),
	}))

	// Call the API to update the session memory
	let updatedMemory = ""
	try {
		const stream = apiHandler.createMessage(prompt, messagesForApi, undefined)

		for await (const chunk of stream) {
			if (chunk.type === "text") {
				updatedMemory += chunk.text
			}
		}
	} catch (error) {
		console.error("[Session Memory] Error extracting session memory:", error)
		// Return current memory if extraction fails
		return currentNotes
	}

	// If the API returned empty content, return current memory
	if (!updatedMemory.trim()) {
		return currentNotes
	}

	// Extract the updated session memory from the response
	// The response should contain the updated session memory content
	// We need to parse it out if it's wrapped in markdown code blocks or similar
	const memoryMatch = updatedMemory.match(/```(?:markdown)?\n([\s\S]*?)\n```/) || updatedMemory.match(/^([\s\S]*?)$/)
	if (memoryMatch) {
		return memoryMatch[1]?.trim() || currentNotes
	}

	return updatedMemory.trim() || currentNotes
}

/**
 * Check if a message contains text blocks
 */
export function hasTextBlocks(message: ApiMessage): boolean {
	if (message.role === "assistant") {
		const content = message.content
		return Array.isArray(content) && content.some((block) => block.type === "text")
	}
	if (message.role === "user") {
		const content = message.content
		if (typeof content === "string") {
			return content.length > 0
		}
		if (Array.isArray(content)) {
			return content.some((block) => block.type === "text")
		}
	}
	return false
}

/**
 * Estimate the number of tokens in a message
 */
export function estimateMessageTokens(messages: ApiMessage[]): number {
	let totalTokens = 0
	for (const msg of messages) {
		if (typeof msg.content === "string") {
			totalTokens += estimateTextTokens(msg.content)
		} else if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "text") {
					totalTokens += estimateTextTokens(block.text)
				} else if (block.type === "image") {
					totalTokens += 2000 // Approximate token count for images
				} else if (block.type === "tool_use") {
					totalTokens += estimateTextTokens(
						JSON.stringify((block as Anthropic.Messages.ToolUseBlockParam).input),
					)
				} else if (block.type === "tool_result") {
					const content = (block as Anthropic.Messages.ToolResultBlockParam).content
					if (typeof content === "string") {
						totalTokens += estimateTextTokens(content)
					} else if (Array.isArray(content)) {
						for (const item of content) {
							if (item.type === "text") {
								totalTokens += estimateTextTokens(item.text)
							} else if (item.type === "image") {
								totalTokens += 2000
							}
						}
					}
				}
			}
		}
	}
	return totalTokens
}
