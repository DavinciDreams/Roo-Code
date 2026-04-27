// npx vitest src/core/condense/__tests__/microCompact.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	microcompactMessages,
	estimateMicrocompactSavings,
	DEFAULT_MICROCOMPACT_CONFIG,
	MICROCOMPACT_CLEARED_MESSAGE,
	type MicrocompactConfig,
} from "../microCompact"

describe("Microcompact", () => {
	describe("microcompactMessages", () => {
		it("should return messages unchanged when disabled", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "This is a long file content that should be cleared",
						},
					],
				},
			]

			const result = microcompactMessages(messages, { enabled: false })

			expect(result.messages).toEqual(messages)
			expect(result.tokensSaved).toBe(0)
			expect(result.toolsCleared).toBe(0)
			expect(result.toolsKept).toBe(0)
		})

		it("should return messages unchanged when there are not enough tools", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "This is a long file content that should be cleared",
						},
					],
				},
			]

			const result = microcompactMessages(messages, { threshold: 5, keepRecent: 3 })

			expect(result.messages).toEqual(messages)
			expect(result.tokensSaved).toBe(0)
			expect(result.toolsCleared).toBe(0)
			expect(result.toolsKept).toBe(1)
		})

		it("should clear old tool results when threshold is exceeded", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "file1.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "Content of file 1",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-2",
							name: "read_file",
							input: { path: "file2.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-2",
							content: "Content of file 2",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-3",
							name: "read_file",
							input: { path: "file3.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-3",
							content: "Content of file 3",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-4",
							name: "read_file",
							input: { path: "file4.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-4",
							content: "Content of file 4",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-5",
							name: "read_file",
							input: { path: "file5.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-5",
							content: "Content of file 5",
						},
					],
				},
			]

			const result = microcompactMessages(messages, { threshold: 3, keepRecent: 2 })

			expect(result.toolsCleared).toBe(3)
			expect(result.toolsKept).toBe(2)
			expect(result.tokensSaved).toBeGreaterThan(0)

			// Check that the last 2 tool results are preserved
			const lastUserMessage = result.messages[result.messages.length - 1]
			if (Array.isArray(lastUserMessage.content)) {
				const toolResult = lastUserMessage.content[0] as Anthropic.Messages.ToolResultBlockParam
				expect(toolResult.content).toBe("Content of file 5")
			}
		})

		it("should only compact compactable tools", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
						{
							type: "tool_use",
							id: "tool-2",
							name: "non_compactable_tool",
							input: { data: "test" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "Content of file 1",
						},
						{
							type: "tool_result",
							tool_use_id: "tool-2",
							content: "Content of non-compactable tool",
						},
					],
				},
			]

			const result = microcompactMessages(messages, { threshold: 1, keepRecent: 0 })

			// Only the compactable tool should be cleared
			expect(result.toolsCleared).toBe(1)
			expect(result.toolsKept).toBe(0)

			// Check that the non-compactable tool is not cleared
			const userMessage = result.messages[1]
			if (Array.isArray(userMessage.content)) {
				const toolResult2 = userMessage.content[1] as Anthropic.Messages.ToolResultBlockParam
				expect(toolResult2.content).toBe("Content of non-compactable tool")
			}
		})

		it("should handle array content in tool results", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: [
								{ type: "text", text: "Text content" },
								{
									type: "image",
									source: {
										type: "base64",
										media_type: "image/png",
										data: "base64data",
									},
								},
							],
						},
					],
				},
			]

			const result = microcompactMessages(messages, { threshold: 1, keepRecent: 0 })

			expect(result.toolsCleared).toBe(1)
			expect(result.tokensSaved).toBeGreaterThan(0)

			// Check that the content was cleared
			const userMessage = result.messages[1]
			if (Array.isArray(userMessage.content)) {
				const toolResult = userMessage.content[0] as Anthropic.Messages.ToolResultBlockParam
				expect(toolResult.content).toBe(MICROCOMPACT_CLEARED_MESSAGE.replace("{toolName}", "read_file"))
			}
		})

		it("should not double-clear already cleared content", () => {
			const clearedMessage = MICROCOMPACT_CLEARED_MESSAGE.replace("{toolName}", "read_file")
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: clearedMessage,
						},
					],
				},
			]

			const result = microcompactMessages(messages, { threshold: 1, keepRecent: 0 })

			// Should not count as clearing since it's already cleared
			expect(result.toolsCleared).toBe(0)
			expect(result.tokensSaved).toBe(0)
		})

		it("should use default config when no config is provided", () => {
			const messages: ApiMessage[] = []

			const result = microcompactMessages(messages)

			expect(result.messages).toEqual(messages)
			expect(result.tokensSaved).toBe(0)
		})

		it("should preserve message structure and metadata", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
					ts: 1234567890,
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "Content to be cleared",
						},
					],
					ts: 1234567891,
					id: "user-msg-1",
				},
			]

			const result = microcompactMessages(messages, { threshold: 1, keepRecent: 0 })

			// Check that message structure is preserved
			expect(result.messages[0].ts).toBe(1234567890)
			expect(result.messages[1].ts).toBe(1234567891)
			expect(result.messages[1].id).toBe("user-msg-1")
		})
	})

	describe("estimateMicrocompactSavings", () => {
		it("should return 0 when disabled", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "This is a long file content",
						},
					],
				},
			]

			const savings = estimateMicrocompactSavings(messages, { enabled: false })

			expect(savings).toBe(0)
		})

		it("should return 0 when there are not enough tools", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "This is a long file content",
						},
					],
				},
			]

			const savings = estimateMicrocompactSavings(messages, { threshold: 5, keepRecent: 3 })

			expect(savings).toBe(0)
		})

		it("should estimate token savings correctly", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "file1.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "Content of file 1",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-2",
							name: "read_file",
							input: { path: "file2.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-2",
							content: "Content of file 2",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-3",
							name: "read_file",
							input: { path: "file3.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-3",
							content: "Content of file 3",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-4",
							name: "read_file",
							input: { path: "file4.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-4",
							content: "Content of file 4",
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-5",
							name: "read_file",
							input: { path: "file5.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-5",
							content: "Content of file 5",
						},
					],
				},
			]

			const savings = estimateMicrocompactSavings(messages, { threshold: 3, keepRecent: 2 })

			// Should estimate savings for the first 3 tools (tools 1-3)
			expect(savings).toBeGreaterThan(0)
		})

		it("should not modify messages when estimating savings", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "read_file",
							input: { path: "test.txt" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-1",
							content: "Original content",
						},
					],
				},
			]

			const originalContent = JSON.stringify(messages)
			estimateMicrocompactSavings(messages, { threshold: 1, keepRecent: 0 })
			const afterEstimateContent = JSON.stringify(messages)

			expect(originalContent).toBe(afterEstimateContent)
		})
	})

	describe("DEFAULT_MICROCOMPACT_CONFIG", () => {
		it("should have correct default values", () => {
			expect(DEFAULT_MICROCOMPACT_CONFIG.enabled).toBe(true)
			expect(DEFAULT_MICROCOMPACT_CONFIG.threshold).toBe(5)
			expect(DEFAULT_MICROCOMPACT_CONFIG.keepRecent).toBe(3)
		})
	})

	describe("MICROCOMPACT_CLEARED_MESSAGE", () => {
		it("should contain placeholder for tool name", () => {
			expect(MICROCOMPACT_CLEARED_MESSAGE).toContain("{toolName}")
		})

		it("should produce correct message when placeholder is replaced", () => {
			const message = MICROCOMPACT_CLEARED_MESSAGE.replace("{toolName}", "read_file")
			expect(message).toBe("[Content condensed - tool: read_file]")
		})
	})
})
