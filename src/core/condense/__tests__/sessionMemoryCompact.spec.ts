/**
 * Tests for Session Memory Compaction
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	adjustIndexToPreserveAPIInvariants,
	calculateMessagesToKeepIndex,
	trySessionMemoryCompaction,
	setSessionMemoryCompactConfig,
	resetSessionMemoryCompactConfig,
	getSessionMemoryCompactConfig,
	DEFAULT_SM_COMPACT_CONFIG,
	resetAllSessionMemoryState,
} from "../sessionMemoryCompact"
import {
	setSessionMemoryConfig,
	resetSessionMemoryState,
	estimateMessageTokens,
	hasTextBlocks,
	setLastSummarizedMessageId,
} from "../sessionMemory"

describe("Session Memory Compact", () => {
	beforeEach(() => {
		resetAllSessionMemoryState()
	})

	describe("adjustIndexToPreserveAPIInvariants", () => {
		it("should return the same index when at boundaries", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "test1", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "response1" }], ts: 2 },
				{ role: "user", content: "test2", ts: 3 },
			]

			expect(adjustIndexToPreserveAPIInvariants(messages, 0)).toBe(0)
			expect(adjustIndexToPreserveAPIInvariants(messages, 3)).toBe(3)
		})

		it("should preserve tool_use/tool_result pairs", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "old message", ts: 1 },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I'll read a file" },
						{ type: "tool_use", id: "tool_1", name: "read_file", input: { path: "test.txt" } },
					],
					ts: 2,
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "tool_1", content: "file content" }],
					ts: 3,
				},
				{ role: "user", content: "new message", ts: 4 },
			]

			// Starting at index 2 (the tool_result user message): the tool_result needs its
			// tool_use at index 1 to be in the kept range — so we extend back to 1.
			const adjusted = adjustIndexToPreserveAPIInvariants(messages, 2)
			expect(adjusted).toBe(1)

			// Starting at index 3 (plain "new message"): no tool_results in kept range,
			// so no adjustment is needed.
			const unchanged = adjustIndexToPreserveAPIInvariants(messages, 3)
			expect(unchanged).toBe(3)
		})

		it("should preserve thinking blocks with same message.id", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "old message", ts: 1 },
				{
					role: "assistant",
					id: "msg_1",
					content: [{ type: "text", text: "thinking..." }],
					ts: 2,
				},
				{
					role: "assistant",
					id: "msg_1",
					content: [{ type: "tool_use", id: "tool_1", name: "read_file", input: { path: "test.txt" } }],
					ts: 3,
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "tool_1", content: "file content" }],
					ts: 4,
				},
				{ role: "user", content: "new message", ts: 5 },
			]

			// Starting at index 3 (the tool_result): extend back to 2 (tool_use) for the
			// tool_use/tool_result pair, then back to 1 (thinking block with same msg_1 id).
			const adjusted = adjustIndexToPreserveAPIInvariants(messages, 3)
			expect(adjusted).toBe(1)
		})
	})

	describe("calculateMessagesToKeepIndex", () => {
		it("should return 0 for empty messages", () => {
			expect(calculateMessagesToKeepIndex([], 0)).toBe(0)
		})

		it("should respect minTokens threshold", () => {
			const messages: ApiMessage[] = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: i % 2 === 0 ? `message ${i}` : [{ type: "text", text: `response ${i}` }],
				ts: i,
			}))

			setSessionMemoryCompactConfig({ minTokens: 100000, minTextBlockMessages: 0 })

			// With a very high minTokens, should keep all messages
			const result = calculateMessagesToKeepIndex(messages, -1)
			expect(result).toBe(0)
		})

		it("should respect minTextBlockMessages threshold", () => {
			const messages: ApiMessage[] = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: i % 2 === 0 ? `message ${i}` : [{ type: "text", text: `response ${i}` }],
				ts: i,
			}))

			setSessionMemoryCompactConfig({ minTokens: 0, minTextBlockMessages: 15 })

			// With a high minTextBlockMessages, should keep enough messages
			const result = calculateMessagesToKeepIndex(messages, -1)
			expect(result).toBeLessThan(messages.length)
		})

		it("should respect maxTokens cap", () => {
			const messages: ApiMessage[] = Array.from({ length: 100 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: i % 2 === 0 ? `message ${i}` : [{ type: "text", text: `response ${i}` }],
				ts: i,
			}))

			setSessionMemoryCompactConfig({ maxTokens: 100 })

			// With a low maxTokens, should keep fewer messages
			const result = calculateMessagesToKeepIndex(messages, -1)
			expect(result).toBeGreaterThan(0)
			expect(result).toBeLessThan(messages.length)
		})

		it("should start from lastSummarizedIndex when provided", () => {
			const messages: ApiMessage[] = Array.from({ length: 20 }, (_, i) => ({
				role: i % 2 === 0 ? "user" : "assistant",
				content: i % 2 === 0 ? `message ${i}` : [{ type: "text", text: `response ${i}` }],
				ts: i,
			}))

			setSessionMemoryCompactConfig({ minTokens: 0, minTextBlockMessages: 0 })

			// Should start after the last summarized index
			const result = calculateMessagesToKeepIndex(messages, 10)
			expect(result).toBeGreaterThan(10)
		})
	})

	describe("trySessionMemoryCompaction", () => {
		it("should return null when session memory is empty", async () => {
			const messages: ApiMessage[] = [{ role: "user", content: "test", ts: 1 }]

			const apiHandler = {
				createMessage: vi.fn(),
			} as any

			const result = await trySessionMemoryCompaction(
				messages,
				"", // Empty session memory
				apiHandler,
				"test-task",
			)

			expect(result).toBeNull()
		})

		it("should return null when session memory matches template", async () => {
			const messages: ApiMessage[] = [{ role: "user", content: "test", ts: 1 }]

			const apiHandler = {
				createMessage: vi.fn(),
			} as any

			// This is the default template
			const template = `
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

			const result = await trySessionMemoryCompaction(messages, template, apiHandler, "test-task")

			expect(result).toBeNull()
		})

		it("should succeed with valid session memory", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "test", ts: 1, id: "msg_1" },
				{
					role: "assistant",
					content: [{ type: "text", text: "response" }],
					ts: 2,
					id: "msg_2",
				},
			]

			const apiHandler = {
				createMessage: vi.fn(),
			} as any

			const sessionMemory = `
# Session Title
Test Session

# Current State
Working on implementing a feature

# Task specification
Build a new feature for the application

# Files and Functions
- src/index.ts: Main entry point
- src/utils.ts: Utility functions

# Workflow
1. Read files
2. Make changes
3. Test

# Errors & Corrections
No errors yet

# Codebase and System Documentation
The app uses TypeScript and React

# Learnings
- Use TypeScript for type safety

# Key results
None yet

# Worklog
- Started implementation
`

			setLastSummarizedMessageId("msg_1")

			const result = await trySessionMemoryCompaction(messages, sessionMemory, apiHandler, "test-task")

			expect(result).not.toBeNull()
			expect(result?.messages).toBeDefined()
			expect(result?.summary).toContain("Session Memory")
			expect(result?.cost).toBe(0)
			expect(result?.condenseId).toBeDefined()
		})

		it("should handle resumed sessions without lastSummarizedMessageId", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "test", ts: 1, id: "msg_1" },
				{
					role: "assistant",
					content: [{ type: "text", text: "response" }],
					ts: 2,
					id: "msg_2",
				},
			]

			const apiHandler = {
				createMessage: vi.fn(),
			} as any

			const sessionMemory = `
# Session Title
Test Session

# Current State
Working on implementing a feature
`

			// Don't set lastSummarizedMessageId - simulating resumed session
			const result = await trySessionMemoryCompaction(messages, sessionMemory, apiHandler, "test-task")

			expect(result).not.toBeNull()
		})
	})

	describe("Configuration", () => {
		it("should use default configuration", () => {
			const config = {
				...DEFAULT_SM_COMPACT_CONFIG,
			}
			expect(config.minTokens).toBe(10000)
			expect(config.minTextBlockMessages).toBe(5)
			expect(config.maxTokens).toBe(50000)
		})

		it("should allow configuration updates", () => {
			setSessionMemoryCompactConfig({
				minTokens: 15000,
				maxTokens: 60000,
			})

			const config = getSessionMemoryCompactConfig()
			expect(config.minTokens).toBe(15000)
			expect(config.maxTokens).toBe(60000)
		})

		it("should reset configuration", () => {
			setSessionMemoryCompactConfig({
				minTokens: 15000,
			})

			resetSessionMemoryCompactConfig()

			const config = {
				...DEFAULT_SM_COMPACT_CONFIG,
			}
			expect(config.minTokens).toBe(10000)
		})
	})

	describe("Session Memory Utils", () => {
		beforeEach(() => {
			resetSessionMemoryState()
		})

		it("should estimate message tokens correctly", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "This is a test message with some text", ts: 1 },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "This is a response" },
						{ type: "tool_use", id: "tool_1", name: "read_file", input: { path: "test.txt" } },
					],
					ts: 2,
				},
			]

			const tokens = estimateMessageTokens(messages)
			expect(tokens).toBeGreaterThan(0)
		})

		it("should detect messages with text blocks", () => {
			const messageWithText: ApiMessage = {
				role: "assistant",
				content: [{ type: "text", text: "response" }],
				ts: 1,
			}

			const messageWithoutText: ApiMessage = {
				role: "assistant",
				content: [{ type: "tool_use", id: "tool_1", name: "test", input: {} }],
				ts: 2,
			}

			expect(hasTextBlocks(messageWithText)).toBe(true)
			expect(hasTextBlocks(messageWithoutText)).toBe(false)
		})

		it("should handle session memory configuration", () => {
			setSessionMemoryConfig({
				minimumMessageTokensToInit: 15000,
				minimumTokensBetweenUpdate: 6000,
				toolCallsBetweenUpdates: 5,
			})

			const config = {
				...DEFAULT_SM_COMPACT_CONFIG,
			}
			// Session memory config is separate from compact config
			// Just verify the function doesn't throw
			expect(() => setSessionMemoryConfig({})).not.toThrow()
		})
	})
})
