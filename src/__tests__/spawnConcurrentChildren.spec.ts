// npx vitest run __tests__/spawnConcurrentChildren.spec.ts

import { describe, it, expect, vi } from "vitest"
import { ClineProvider } from "../core/webview/ClineProvider"
import { RooCodeEventName } from "@roo-code/types"

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureParallelTaskSpawned: vi.fn(),
			captureParallelTaskCompleted: vi.fn(),
			captureParallelTaskChildFailed: vi.fn(),
			captureWorktreeCreated: vi.fn(),
			captureWorktreeDeleted: vi.fn(),
		},
	},
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CompletionHandler = {
	resolve: (result: { summary: string; payload?: Record<string, unknown> }) => void
	reject: (reason: Error) => void
}

function buildProvider(opts: { parentTaskId: string }) {
	const { parentTaskId } = opts

	const parentTask = { taskId: parentTaskId, workspacePath: "/workspace", parentTask: undefined }

	const childTaskCounter = { n: 0 }
	const createdChildren: Array<{ taskId: string; start: ReturnType<typeof vi.fn> }> = []

	const provider = {
		tasks: new Map<string, any>([[parentTaskId, parentTask]]),
		focusedTaskId: parentTaskId as string | undefined,
		leaderTaskId: parentTaskId as string | undefined,
		childCompletionHandlers: new Map<string, CompletionHandler>(),
		taskEventListeners: new WeakMap(),
		log: vi.fn(),

		// Mock handleModeSwitch — synchronous to avoid ordering issues in tests
		handleModeSwitch: vi.fn().mockResolvedValue(undefined),

		// Mock _createWorktreeForTask
		_createWorktreeForTask: vi.fn().mockResolvedValue("/worktree/path"),

		// Mock createTask — each call returns a new unique child Task stub
		createTask: vi.fn().mockImplementation(async () => {
			const id = `child-${++childTaskCounter.n}`
			const child = {
				taskId: id,
				workspacePath: "/workspace",
				parentTask: parentTask,
				start: vi.fn(),
			}
			createdChildren.push(child)
			// Register in the tasks map as addClineToStack would
			provider.tasks.set(id, child)
			provider.focusedTaskId = id
			return child
		}),

		getTaskWithId: vi.fn().mockImplementation(async (id: string) => ({
			historyItem: { id, worktreePath: undefined, workspace: "/workspace" },
		})),
		updateTaskHistory: vi.fn().mockResolvedValue(undefined),

		// Mock removeClineFromStack so abort-siblings tests can track calls
		removeClineFromStack: vi.fn().mockImplementation(async (opts?: { taskId?: string }) => {
			const id = opts?.taskId ?? provider.focusedTaskId
			if (id) provider.tasks.delete(id)
		}),

		emit: vi.fn(),
	}

	return { provider, parentTask, createdChildren, childTaskCounter }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClineProvider.spawnConcurrentChildren()", () => {
	it("creates and starts all children, returns aggregated results", async () => {
		const { provider, createdChildren } = buildProvider({ parentTaskId: "parent-1" })

		// Schedule resolutions after children are registered
		const resolveAll = () => {
			for (const [taskId, handler] of provider.childCompletionHandlers) {
				handler.resolve({ summary: `result-of-${taskId}` })
			}
		}

		// Intercept start() calls to trigger resolutions
		let startCount = 0
		const originalCreateTask = provider.createTask
		provider.createTask = vi.fn().mockImplementation(async (...args) => {
			const child = await originalCreateTask(...args)
			const originalStart = child.start
			child.start = vi.fn().mockImplementation(() => {
				originalStart()
				startCount++
				if (startCount === 2) resolveAll()
			})
			return child
		})

		const results = await (ClineProvider.prototype as any).spawnConcurrentChildren.call(provider, {
			parentTaskId: "parent-1",
			tasks: [
				{ mode: "code", message: "Task A" },
				{ mode: "debug", message: "Task B" },
			],
		})

		expect(results).toHaveLength(2)
		expect(results[0].summary).toBe("result-of-child-1")
		expect(results[1].summary).toBe("result-of-child-2")
		expect(results.every((r: { error?: string }) => !r.error)).toBe(true)
	})

	it("serialises handleModeSwitch calls (no concurrent mode-switch race)", async () => {
		const { provider } = buildProvider({ parentTaskId: "parent-1" })
		const modeOrder: string[] = []

		provider.handleModeSwitch = vi.fn().mockImplementation(async (mode: string) => {
			modeOrder.push(`start-${mode}`)
			await Promise.resolve() // yield
			modeOrder.push(`end-${mode}`)
		})

		let startCount = 0
		const originalCreateTask = provider.createTask
		provider.createTask = vi.fn().mockImplementation(async (...args) => {
			const child = await originalCreateTask(...args)
			child.start = vi.fn().mockImplementation(() => {
				startCount++
				if (startCount === 2) {
					for (const [, handler] of provider.childCompletionHandlers) {
						handler.resolve({ summary: "done" })
					}
				}
			})
			return child
		})

		await (ClineProvider.prototype as any).spawnConcurrentChildren.call(provider, {
			parentTaskId: "parent-1",
			tasks: [
				{ mode: "code", message: "A" },
				{ mode: "debug", message: "B" },
			],
		})

		// The calls must be fully interleaved in order — start-code, end-code, start-debug, end-debug
		// (not start-code, start-debug, end-code, end-debug which would be the concurrent-map race)
		expect(modeOrder).toEqual(["start-code", "end-code", "start-debug", "end-debug"])
	})

	it("all children start() are called before any await on completions", async () => {
		const { provider } = buildProvider({ parentTaskId: "parent-1" })
		const startLog: string[] = []

		const originalCreateTask = provider.createTask
		provider.createTask = vi.fn().mockImplementation(async (...args) => {
			const child = await originalCreateTask(...args)
			child.start = vi.fn().mockImplementation(() => {
				startLog.push(child.taskId)
				// Do NOT resolve yet — verifying start was called for all before awaiting
			})
			return child
		})

		// Let resolutions happen after the start loop
		setImmediate(() => {
			for (const [, handler] of provider.childCompletionHandlers) {
				handler.resolve({ summary: "done" })
			}
		})

		await (ClineProvider.prototype as any).spawnConcurrentChildren.call(provider, {
			parentTaskId: "parent-1",
			tasks: [
				{ mode: "code", message: "A" },
				{ mode: "code", message: "B" },
				{ mode: "code", message: "C" },
			],
		})

		// All three starts fired before we awaited any completion
		expect(startLog).toEqual(["child-1", "child-2", "child-3"])
	})

	it("collects results with errors when children fail (no abortOnChildFailure)", async () => {
		const { provider } = buildProvider({ parentTaskId: "parent-1" })

		let startCount = 0
		const originalCreateTask = provider.createTask
		provider.createTask = vi.fn().mockImplementation(async (...args) => {
			const child = await originalCreateTask(...args)
			child.start = vi.fn().mockImplementation(() => {
				startCount++
				const handler = provider.childCompletionHandlers.get(child.taskId)
				if (startCount === 1) {
					handler?.reject(new Error("child-1 failed"))
				} else {
					handler?.resolve({ summary: "child-2 succeeded" })
				}
			})
			return child
		})

		const results = await (ClineProvider.prototype as any).spawnConcurrentChildren.call(provider, {
			parentTaskId: "parent-1",
			tasks: [
				{ mode: "code", message: "A" },
				{ mode: "code", message: "B" },
			],
			abortOnChildFailure: false,
		})

		expect(results).toHaveLength(2)
		const failed = results.find((r: { error?: string }) => r.error)
		const succeeded = results.find((r: { error?: string }) => !r.error)
		expect(failed?.error).toBe("child-1 failed")
		expect(succeeded?.summary).toBe("child-2 succeeded")
	})

	it("aborts sibling tasks when abortOnChildFailure is true and a child fails", async () => {
		const { provider } = buildProvider({ parentTaskId: "parent-1" })

		let startCount = 0
		const originalCreateTask = provider.createTask
		provider.createTask = vi.fn().mockImplementation(async (...args) => {
			const child = await originalCreateTask(...args)
			child.start = vi.fn().mockImplementation(() => {
				startCount++
				const handler = provider.childCompletionHandlers.get(child.taskId)
				if (startCount === 1) {
					// child-1 fails immediately
					handler?.reject(new Error("child-1 bombed"))
				}
				// child-2 never resolves on its own — it should be aborted
			})
			return child
		})

		const results = await (ClineProvider.prototype as any).spawnConcurrentChildren.call(provider, {
			parentTaskId: "parent-1",
			tasks: [
				{ mode: "code", message: "A" },
				{ mode: "code", message: "B" },
			],
			abortOnChildFailure: true,
		})

		expect(results).toHaveLength(2)
		// Both results should carry errors
		expect(results.every((r: { error?: string }) => Boolean(r.error))).toBe(true)
		// removeClineFromStack should have been called for child-2 (the sibling)
		expect(provider.removeClineFromStack).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "child-2", skipDelegationRepair: true }),
		)
	})

	it("emits TaskSpawned and TaskDelegated events for each child", async () => {
		const { provider } = buildProvider({ parentTaskId: "parent-1" })

		let startCount = 0
		const originalCreateTask = provider.createTask
		provider.createTask = vi.fn().mockImplementation(async (...args) => {
			const child = await originalCreateTask(...args)
			child.start = vi.fn().mockImplementation(() => {
				startCount++
				if (startCount === 2) {
					for (const [, h] of provider.childCompletionHandlers) h.resolve({ summary: "done" })
				}
			})
			return child
		})

		await (ClineProvider.prototype as any).spawnConcurrentChildren.call(provider, {
			parentTaskId: "parent-1",
			tasks: [
				{ mode: "code", message: "A" },
				{ mode: "code", message: "B" },
			],
		})

		expect(provider.emit).toHaveBeenCalledWith(RooCodeEventName.TaskSpawned, "child-1")
		expect(provider.emit).toHaveBeenCalledWith(RooCodeEventName.TaskSpawned, "child-2")
		expect(provider.emit).toHaveBeenCalledWith(RooCodeEventName.TaskDelegated, "parent-1", "child-1")
		expect(provider.emit).toHaveBeenCalledWith(RooCodeEventName.TaskDelegated, "parent-1", "child-2")
	})

	it("creates worktrees when spec.worktree is specified", async () => {
		const { provider } = buildProvider({ parentTaskId: "parent-1" })

		let startCount = 0
		const originalCreateTask = provider.createTask
		provider.createTask = vi.fn().mockImplementation(async (...args) => {
			const child = await originalCreateTask(...args)
			child.start = vi.fn().mockImplementation(() => {
				startCount++
				if (startCount === 1) {
					provider.childCompletionHandlers.get(child.taskId)?.resolve({ summary: "done" })
				}
			})
			return child
		})

		await (ClineProvider.prototype as any).spawnConcurrentChildren.call(provider, {
			parentTaskId: "parent-1",
			tasks: [{ mode: "code", message: "A", worktree: "auto" }],
		})

		expect(provider._createWorktreeForTask).toHaveBeenCalledWith("/workspace", "auto", "parent-1")
	})
})
