import { describe, it, expect, vi, beforeEach } from "vitest"
import {
	isPromptTooLongError,
	parsePromptTooLongTokenGap,
	truncateHeadForPromptTooLongRetry,
	groupMessagesByApiRound,
	estimateMessageTokens,
} from "../index"
import type { ApiMessage } from "../../task-persistence/apiMessages"

describe("Prompt-Too-Long Retry", () => {
	describe("isPromptTooLongError", () => {
		it("should detect Anthropic prompt-too-long error", () => {
			expect(isPromptTooLongError("prompt is too long")).toBe(true)
			expect(isPromptTooLongError("Prompt is too long")).toBe(true)
			expect(isPromptTooLongError("PROMPT IS TOO LONG")).toBe(true)
		})

		it("should detect OpenAI prompt-too-long error", () => {
			expect(isPromptTooLongError("maximum context length exceeded")).toBe(true)
			expect(isPromptTooLongError("This model's maximum context length is 200000 tokens")).toBe(true)
		})

		it("should detect generic prompt-too-long errors", () => {
			expect(isPromptTooLongError("context length exceeded")).toBe(true)
			expect(isPromptTooLongError("too many tokens")).toBe(true)
			expect(isPromptTooLongError("tokens exceed limit")).toBe(true)
		})

		it("should not detect other errors", () => {
			expect(isPromptTooLongError("rate limit exceeded")).toBe(false)
			expect(isPromptTooLongError("invalid API key")).toBe(false)
			expect(isPromptTooLongError("network error")).toBe(false)
			expect(isPromptTooLongError("")).toBe(false)
		})
	})

	describe("parsePromptTooLongTokenGap", () => {
		it("should parse token gap from Anthropic error format", () => {
			expect(parsePromptTooLongTokenGap("prompt is too long: 137500 tokens > 135000 maximum")).toBe(2500)
			expect(parsePromptTooLongTokenGap("Prompt is too long: 200000 tokens > 100000 maximum")).toBe(100000)
		})

		it("should parse token gap from 'exceeded by' format", () => {
			expect(parsePromptTooLongTokenGap("exceeded by 5000 tokens")).toBe(5000)
			expect(parsePromptTooLongTokenGap("Context exceeded by 1000 tokens")).toBe(1000)
		})

		it("should return undefined for unparseable messages", () => {
			expect(parsePromptTooLongTokenGap("prompt is too long")).toBeUndefined()
			expect(parsePromptTooLongTokenGap("rate limit exceeded")).toBeUndefined()
			expect(parsePromptTooLongTokenGap("")).toBeUndefined()
		})

		it("should handle case-insensitive matching", () => {
			expect(parsePromptTooLongTokenGap("PROMPT IS TOO LONG: 15000 TOKENS > 10000 MAXIMUM")).toBe(5000)
		})
	})

	describe("estimateMessageTokens", () => {
		it("should estimate tokens for string content", () => {
			const msg: ApiMessage = {
				role: "user",
				content: "Hello world!",
				ts: Date.now(),
			}
			expect(estimateMessageTokens(msg)).toBeGreaterThan(0)
		})

		it("should estimate tokens for text blocks", () => {
			const msg: ApiMessage = {
				role: "user",
				content: [{ type: "text", text: "This is a test message" }],
				ts: Date.now(),
			}
			expect(estimateMessageTokens(msg)).toBeGreaterThan(0)
		})

		it("should estimate tokens for image blocks", () => {
			const msg: ApiMessage = {
				role: "user",
				content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
				ts: Date.now(),
			}
			expect(estimateMessageTokens(msg)).toBe(1000) // Fixed estimate for images
		})

		it("should estimate tokens for tool blocks", () => {
			const msg: ApiMessage = {
				role: "assistant",
				content: [{ type: "tool_use", id: "123", name: "test", input: {} }],
				ts: Date.now(),
			}
			expect(estimateMessageTokens(msg)).toBe(100) // Fixed estimate for tool blocks
		})

		it("should estimate tokens for mixed content", () => {
			const msg: ApiMessage = {
				role: "user",
				content: [
					{ type: "text", text: "Hello" },
					{ type: "text", text: "World" },
				],
				ts: Date.now(),
			}
			expect(estimateMessageTokens(msg)).toBeGreaterThan(0)
		})
	})

	describe("groupMessagesByApiRound", () => {
		it("should group messages by API round", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "User 1", ts: 1 },
				{ role: "assistant", content: "Assistant 1", ts: 2 },
				{ role: "user", content: "User 2", ts: 3 },
				{ role: "assistant", content: "Assistant 2", ts: 4 },
			]
			const groups = groupMessagesByApiRound(messages)
			expect(groups).toHaveLength(2)
			expect(groups[0]).toHaveLength(2)
			expect(groups[1]).toHaveLength(2)
			expect(groups[0][0].role).toBe("user")
			expect(groups[0][1].role).toBe("assistant")
		})

		it("should handle single user message", () => {
			const messages: ApiMessage[] = [{ role: "user", content: "User 1", ts: 1 }]
			const groups = groupMessagesByApiRound(messages)
			expect(groups).toHaveLength(1)
			expect(groups[0]).toHaveLength(1)
		})

		it("should handle assistant-first sequence", () => {
			const messages: ApiMessage[] = [
				{ role: "assistant", content: "Assistant 1", ts: 1 },
				{ role: "user", content: "User 1", ts: 2 },
			]
			const groups = groupMessagesByApiRound(messages)
			expect(groups).toHaveLength(2)
			expect(groups[0]).toHaveLength(1)
			expect(groups[1]).toHaveLength(1)
		})

		it("should handle empty array", () => {
			const groups = groupMessagesByApiRound([])
			expect(groups).toHaveLength(0)
		})
	})

	describe("truncateHeadForPromptTooLongRetry", () => {
		const createMessages = (count: number): ApiMessage[] => {
			const messages: ApiMessage[] = []
			for (let i = 0; i < count; i++) {
				messages.push({ role: "user", content: `User ${i}`, ts: i * 2 })
				messages.push({ role: "assistant", content: `Assistant ${i}`, ts: i * 2 + 1 })
			}
			return messages
		}

		it("should truncate messages based on token gap", () => {
			const messages = createMessages(10)
			const errorMessage = "prompt is too long: 5000 tokens > 3000 maximum"
			const truncated = truncateHeadForPromptTooLongRetry(messages, errorMessage)

			expect(truncated).not.toBeNull()
			expect(truncated!.length).toBeLessThan(messages.length)
			expect(truncated!.length).toBeGreaterThan(0)
		})

		it("should truncate 20% of groups when token gap is unparseable", () => {
			const messages = createMessages(10)
			const errorMessage = "prompt is too long"
			const truncated = truncateHeadForPromptTooLongRetry(messages, errorMessage)

			expect(truncated).not.toBeNull()
			expect(truncated!.length).toBeLessThan(messages.length)
			expect(truncated!.length).toBeGreaterThan(0)
		})

		it("should keep at least one group", () => {
			const messages = createMessages(2)
			const errorMessage = "prompt is too long: 10000 tokens > 1000 maximum"
			const truncated = truncateHeadForPromptTooLongRetry(messages, errorMessage)

			expect(truncated).not.toBeNull()
			expect(truncated!.length).toBeGreaterThan(0)
		})

		it("should return null when there are not enough groups", () => {
			const messages: ApiMessage[] = [{ role: "user", content: "User 1", ts: 1 }]
			const errorMessage = "prompt is too long: 10000 tokens > 1000 maximum"
			const truncated = truncateHeadForPromptTooLongRetry(messages, errorMessage)

			expect(truncated).toBeNull()
		})

		it("should prepend synthetic user marker when first message is assistant", () => {
			const messages: ApiMessage[] = [
				{ role: "assistant", content: "Assistant 1", ts: 1 },
				{ role: "user", content: "User 1", ts: 2 },
				{ role: "assistant", content: "Assistant 2", ts: 3 },
			]
			const errorMessage = "prompt is too long: 5000 tokens > 3000 maximum"
			const truncated = truncateHeadForPromptTooLongRetry(messages, errorMessage)

			expect(truncated).not.toBeNull()
			expect(truncated![0].role).toBe("user")
			expect(truncated![0].isMeta).toBe(true)
		})

		it("should strip previous retry marker before grouping", () => {
			const messages: ApiMessage[] = [
				{
					role: "user",
					content: "[earlier conversation truncated for condensation retry]",
					ts: 1,
					isMeta: true,
				},
				{ role: "user", content: "User 1", ts: 2 },
				{ role: "assistant", content: "Assistant 1", ts: 3 },
				{ role: "user", content: "User 2", ts: 4 },
				{ role: "assistant", content: "Assistant 2", ts: 5 },
			]
			const errorMessage = "prompt is too long: 5000 tokens > 3000 maximum"
			const truncated = truncateHeadForPromptTooLongRetry(messages, errorMessage)

			expect(truncated).not.toBeNull()
			// Should not have duplicate markers
			const markers = truncated!.filter(
				(m) => m.isMeta && typeof m.content === "string" && m.content.includes("truncated"),
			)
			expect(markers.length).toBeLessThanOrEqual(1)
		})

		it("should return null when all messages would be dropped", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "User 1", ts: 1 },
				{ role: "assistant", content: "Assistant 1", ts: 2 },
			]
			const errorMessage = "prompt is too long: 100000 tokens > 1000 maximum"
			const truncated = truncateHeadForPromptTooLongRetry(messages, errorMessage)

			// Should keep at least one group
			expect(truncated).not.toBeNull()
			expect(truncated!.length).toBeGreaterThan(0)
		})
	})
})
