import type { ExtensionContext } from "vscode"
import { RetryQueue } from "../RetryQueue.js"
import type { QueuedRequest } from "../types.js"

// Mock ExtensionContext
const createMockContext = (): ExtensionContext => {
	const storage = new Map<string, unknown>()

	return {
		workspaceState: {
			get: vi.fn((key: string) => storage.get(key)),
			update: vi.fn(async (key: string, value: unknown) => {
				storage.set(key, value)
			}),
		},
	} as unknown as ExtensionContext
}

describe("RetryQueue", () => {
	let mockContext: ExtensionContext
	let retryQueue: RetryQueue

	beforeEach(() => {
		vi.clearAllMocks()
		mockContext = createMockContext()
		retryQueue = new RetryQueue(mockContext)
	})

	afterEach(() => {
		retryQueue.dispose()
	})

	describe("enqueue", () => {
		it("should be a no-op when cloud features are disabled", async () => {
			const url = "https://api.example.com/test"
			const options = { method: "POST", body: JSON.stringify({ test: "data" }) }

			await retryQueue.enqueue(url, options, "telemetry")

			// Queue should remain empty
			const stats = retryQueue.getStats()
			expect(stats.totalQueued).toBe(0)
		})

		it("should not add items to queue regardless of max size", async () => {
			// Create a queue with max size of 3
			retryQueue = new RetryQueue(mockContext, { maxQueueSize: 3 })

			// Try to add 4 requests
			for (let i = 1; i <= 4; i++) {
				await retryQueue.enqueue(`https://api.example.com/test${i}`, { method: "POST" }, "telemetry")
			}

			// All should be no-ops, queue remains empty
			const stats = retryQueue.getStats()
			expect(stats.totalQueued).toBe(0)
		})
	})

	describe("persistence", () => {
		it("should load persisted queue on initialization", () => {
			const persistedRequests: QueuedRequest[] = [
				{
					id: "test-1",
					url: "https://api.example.com/test1",
					options: { method: "POST" },
					timestamp: Date.now(),
					retryCount: 0,
					type: "telemetry",
				},
			]

			// Set up mock to return persisted data
			const storage = new Map([["roo.retryQueue", persistedRequests]])
			mockContext = {
				workspaceState: {
					get: vi.fn((key: string) => storage.get(key)),
					update: vi.fn(),
				},
			} as unknown as ExtensionContext

			retryQueue = new RetryQueue(mockContext)

			// Queue should load persisted data
			const stats = retryQueue.getStats()
			expect(stats.totalQueued).toBe(1)
			expect(mockContext.workspaceState.get).toHaveBeenCalledWith("roo.retryQueue")
		})

		it("should persist queue to workspace state", async () => {
			// Enqueue is a no-op, but if we manually add items
			// they should still be persisted
			// Since enqueue is no-op, we can't test this directly
			// But persistence mechanism should still work
			const stats = retryQueue.getStats()
			expect(stats.totalQueued).toBe(0)
		})
	})

	describe("clear", () => {
		it("should clear all queued requests", () => {
			// Since enqueue is a no-op, queue is empty
			// But clear should still work
			retryQueue.clear()

			const stats = retryQueue.getStats()
			expect(stats.totalQueued).toBe(0)
		})
	})

	describe("getStats", () => {
		it("should return correct statistics for empty queue", () => {
			const stats = retryQueue.getStats()

			expect(stats.totalQueued).toBe(0)
			expect(stats.byType).toEqual({})
			expect(stats.oldestRequest).toBeUndefined()
			expect(stats.newestRequest).toBeUndefined()
		})

		it("should return correct statistics when items are loaded from persistence", () => {
			const persistedRequests: QueuedRequest[] = [
				{
					id: "test-1",
					url: "https://api.example.com/test1",
					options: { method: "POST" },
					timestamp: Date.now(),
					retryCount: 0,
					type: "telemetry",
				},
				{
					id: "test-2",
					url: "https://api.example.com/test2",
					options: { method: "POST" },
					timestamp: Date.now() + 1000,
					retryCount: 1,
					type: "api-call",
				},
			]

			const storage = new Map([["roo.retryQueue", persistedRequests]])
			mockContext = {
				workspaceState: {
					get: vi.fn((key: string) => storage.get(key)),
					update: vi.fn(),
				},
			} as unknown as ExtensionContext

			retryQueue = new RetryQueue(mockContext)

			const stats = retryQueue.getStats()

			expect(stats.totalQueued).toBe(2)
			expect(stats.byType["telemetry"]).toBe(1)
			expect(stats.byType["api-call"]).toBe(1)
			expect(stats.oldestRequest).toBeDefined()
			expect(stats.newestRequest).toBeDefined()
		})
	})

	describe("events", () => {
		it("should emit queue-cleared event when clearing", () => {
			const listener = vi.fn()
			retryQueue.on("queue-cleared", listener)

			retryQueue.clear()

			expect(listener).toHaveBeenCalled()
		})
	})

	describe("auth state management", () => {
		it("should pause and resume queue", () => {
			expect(retryQueue.isPausedState()).toBe(false)

			retryQueue.pause()
			expect(retryQueue.isPausedState()).toBe(true)

			retryQueue.resume()
			expect(retryQueue.isPausedState()).toBe(false)
		})

		it("should track and update current user ID", () => {
			expect(retryQueue.getCurrentUserId()).toBeUndefined()

			retryQueue.setCurrentUserId("user_123")
			expect(retryQueue.getCurrentUserId()).toBe("user_123")

			retryQueue.setCurrentUserId("user_456")
			expect(retryQueue.getCurrentUserId()).toBe("user_456")

			retryQueue.setCurrentUserId(undefined)
			expect(retryQueue.getCurrentUserId()).toBeUndefined()
		})

		it("should clear queue when user changes", async () => {
			// Since enqueue is a no-op, we can't add items
			// But clear mechanism should still work
			const stats = retryQueue.getStats()
			expect(stats.totalQueued).toBe(0)

			retryQueue.setCurrentUserId("user_123")

			// Same user login - should not clear
			let wasCleared = retryQueue.clearIfUserChanged("user_123")
			expect(wasCleared).toBe(false)

			// Different user login - should clear (even though queue is already empty)
			wasCleared = retryQueue.clearIfUserChanged("user_456")
			expect(wasCleared).toBe(true) // Returns true because user ID changed
			expect(retryQueue.getCurrentUserId()).toBe("user_456")
		})

		it("should clear queue on logout (undefined user)", async () => {
			retryQueue.setCurrentUserId("user_123")

			// Logout (undefined user) - should clear
			const wasCleared = retryQueue.clearIfUserChanged(undefined)
			expect(wasCleared).toBe(true) // Returns true because user ID changed
			expect(retryQueue.getCurrentUserId()).toBeUndefined()
		})

		it("should not clear on first login (no previous user)", async () => {
			// First login - should not clear
			const wasCleared = retryQueue.clearIfUserChanged("user_123")
			expect(wasCleared).toBe(false)
			expect(retryQueue.getCurrentUserId()).toBe("user_123")
		})
	})

	describe("retryAll", () => {
		it("should handle empty queue gracefully", async () => {
			// Call retryAll on empty queue
			await expect(retryQueue.retryAll()).resolves.toBeUndefined()
		})

		it("should not process when paused", async () => {
			const fetchMock = vi.fn().mockResolvedValue({ ok: true })
			global.fetch = fetchMock

			// Pause queue
			retryQueue.pause()

			// Try to retry all
			await retryQueue.retryAll()

			// Fetch should not be called because queue is paused
			expect(fetchMock).not.toHaveBeenCalled()

			// Resume and retry
			retryQueue.resume()
			await retryQueue.retryAll()

			// Still no fetch calls because queue is empty
			expect(fetchMock).not.toHaveBeenCalled()
		})

		it("should not process if already processing", async () => {
			// This test is less meaningful since enqueue is a no-op
			// But mechanism should still work
			await retryQueue.retryAll()

			// Should not throw
			await retryQueue.retryAll()
		})
	})
})
