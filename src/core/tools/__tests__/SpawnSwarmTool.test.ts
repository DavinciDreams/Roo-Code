// npx vitest core/tools/__tests__/SpawnSwarmTool.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { SpawnSwarmTool } from "../SpawnSwarmTool"
import type { ToolCallbacks } from "../BaseTool"
import { getWorkerBackend } from "../../swarm/backends/registry"

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../swarm/backends/registry", () => ({
	getWorkerBackend: vi.fn(() => ({
		spawn: vi.fn().mockResolvedValue({ agentId: "worker-1@session-1", pid: 1234 }),
		waitForAll: vi.fn().mockResolvedValue(undefined),
		terminate: vi.fn().mockResolvedValue(undefined),
		isActive: vi.fn().mockResolvedValue(false),
	})),
}))

vi.mock("../../swarm/MailboxManager", () => ({
	MailboxManager: vi.fn().mockImplementation(() => ({
		createMailbox: vi.fn(),
		createFileMailbox: vi.fn(),
		destroyMailbox: vi.fn(),
		assignTask: vi.fn().mockResolvedValue(undefined),
		shutdownWorker: vi.fn().mockResolvedValue(undefined),
		notifyIdle: vi.fn().mockResolvedValue(undefined),
		waitForLeaderMessage: vi.fn().mockResolvedValue(null),
		waitForNextMessage: vi.fn().mockResolvedValue(null),
		dispose: vi.fn(),
	})),
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMailboxManager(overrides: Record<string, unknown> = {}) {
	return {
		createMailbox: vi.fn(),
		createFileMailbox: vi.fn(),
		destroyMailbox: vi.fn(),
		assignTask: vi.fn().mockResolvedValue(undefined),
		shutdownWorker: vi.fn().mockResolvedValue(undefined),
		notifyIdle: vi.fn().mockResolvedValue(undefined),
		// Return null by default so the coordination loop exits immediately (timeout path).
		waitForLeaderMessage: vi.fn().mockResolvedValue(null),
		waitForNextMessage: vi.fn().mockResolvedValue(null),
		dispose: vi.fn(),
		...overrides,
	}
}

function makeProvider(overrides: Record<string, unknown> = {}) {
	return {
		mailboxManager: makeMailboxManager(),
		spawnConcurrentChildren: vi.fn().mockResolvedValue([]),
		...overrides,
	}
}

function makeTask(provider: ReturnType<typeof makeProvider>) {
	return {
		taskId: "session-1",
		providerRef: {
			deref: vi.fn(() => provider),
		},
		say: vi.fn().mockResolvedValue(undefined),
	}
}

function makeCallbacks(): ToolCallbacks {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn().mockResolvedValue(undefined),
		pushToolResult: vi.fn(),
	}
}

const SINGLE_WORKER = [{ name: "worker-1", mode: "code" }]
const TWO_WORKERS = [
	{ name: "worker-1", mode: "code" },
	{ name: "worker-2", mode: "code" },
]
const TWO_TASKS = ["task-A", "task-B"]
const THREE_TASKS = ["task-A", "task-B", "task-C"]

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

describe("SpawnSwarmTool — parameter validation", () => {
	let tool: SpawnSwarmTool
	let callbacks: ToolCallbacks
	let provider: ReturnType<typeof makeProvider>

	beforeEach(() => {
		tool = new SpawnSwarmTool()
		callbacks = makeCallbacks()
		provider = makeProvider()
	})

	it("returns a tool error when workers array is empty", async () => {
		const task = makeTask(provider)
		await tool.execute({ workers: [], task_list: ["task-A"] } as any, task as any, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("requires at least one worker"))
	})

	it("returns a tool error when task_list array is empty", async () => {
		const task = makeTask(provider)
		await tool.execute({ workers: SINGLE_WORKER, task_list: [] } as any, task as any, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("requires at least one task"))
	})

	it("returns a tool error when provider reference is lost", async () => {
		const task = {
			taskId: "session-1",
			providerRef: { deref: vi.fn(() => undefined) },
			say: vi.fn(),
		}
		await tool.execute({ workers: SINGLE_WORKER, task_list: TWO_TASKS } as any, task as any, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Provider reference lost"))
	})
})

// ---------------------------------------------------------------------------
// In-process backend
// ---------------------------------------------------------------------------

describe("SpawnSwarmTool — in-process backend (default)", () => {
	let tool: SpawnSwarmTool
	let callbacks: ToolCallbacks

	beforeEach(() => {
		tool = new SpawnSwarmTool()
		callbacks = makeCallbacks()
	})

	it("creates an in-memory mailbox for the session before spawning workers", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		await tool.execute({ workers: SINGLE_WORKER, task_list: TWO_TASKS } as any, task as any, callbacks)
		expect(provider.mailboxManager.createMailbox).toHaveBeenCalledWith("session-1")
	})

	it("calls spawnConcurrentChildren with one task per worker for initial distribution", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		await tool.execute({ workers: TWO_WORKERS, task_list: TWO_TASKS } as any, task as any, callbacks)
		const call = (provider.spawnConcurrentChildren as any).mock.calls[0][0]
		expect(call.tasks).toHaveLength(2)
		expect(call.parentTaskId).toBe("session-1")
	})

	it("does not spawn more initial workers than there are tasks", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		// 2 workers but only 1 task → only 1 initial task should be assigned
		await tool.execute({ workers: TWO_WORKERS, task_list: ["task-A"] } as any, task as any, callbacks)
		const call = (provider.spawnConcurrentChildren as any).mock.calls[0][0]
		expect(call.tasks).toHaveLength(1)
	})

	it("sends a shutdown_request when the task queue is exhausted after an idle notification", async () => {
		const mailboxManager = makeMailboxManager({
			// Simulate one idle notification then null (timeout)
			waitForLeaderMessage: vi
				.fn()
				.mockResolvedValueOnce({
					type: "idle_notification",
					payload: { workerId: "worker-1@session-1", summary: "done" },
				})
				.mockResolvedValue(null),
		})
		const provider = makeProvider({ mailboxManager })
		const task = makeTask(provider)
		// Only 1 task, 1 worker — queue will be empty on first idle notification
		await tool.execute({ workers: SINGLE_WORKER, task_list: ["task-A"] } as any, task as any, callbacks)
		expect(mailboxManager.shutdownWorker).toHaveBeenCalledWith("session-1", "worker-1@session-1")
	})

	it("dispatches a remaining task to an idle worker", async () => {
		const mailboxManager = makeMailboxManager({
			waitForLeaderMessage: vi
				.fn()
				// First idle: there's a remaining task (task-B) → assign it
				.mockResolvedValueOnce({
					type: "idle_notification",
					payload: { workerId: "worker-1@session-1", summary: "done" },
				})
				// Second idle: queue empty → shutdown
				.mockResolvedValueOnce({
					type: "idle_notification",
					payload: { workerId: "worker-1@session-1", summary: "done" },
				})
				.mockResolvedValue(null),
		})
		const provider = makeProvider({ mailboxManager })
		const task = makeTask(provider)
		// 1 worker, 3 tasks: first task given at spawn, remaining 2 dispatched by coordinator
		await tool.execute({ workers: SINGLE_WORKER, task_list: THREE_TASKS } as any, task as any, callbacks)
		expect(mailboxManager.assignTask).toHaveBeenCalledWith("session-1", "worker-1@session-1", "task-B")
	})

	it("sends shutdown to tracked workers when the coordination loop times out", async () => {
		const mailboxManager = makeMailboxManager({
			waitForLeaderMessage: vi
				.fn()
				// One idle notification (worker tracked), then timeout
				.mockResolvedValueOnce({
					type: "idle_notification",
					payload: { workerId: "worker-1@session-1", summary: "" },
				})
				.mockResolvedValueOnce({
					type: "idle_notification",
					payload: { workerId: "worker-2@session-1", summary: "" },
				})
				.mockResolvedValue(null),
		})
		const provider = makeProvider({ mailboxManager })
		const task = makeTask(provider)
		// 2 workers, 5 tasks — timeout fires while workers are still active
		await tool.execute(
			{ workers: TWO_WORKERS, task_list: ["t1", "t2", "t3", "t4", "t5"] } as any,
			task as any,
			callbacks,
		)
		// Both workers should have been tracked and shut down on timeout
		expect(mailboxManager.shutdownWorker.mock.calls.some((c: string[]) => c[1] === "worker-1@session-1")).toBe(true)
		expect(mailboxManager.shutdownWorker.mock.calls.some((c: string[]) => c[1] === "worker-2@session-1")).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// CLI backend
// ---------------------------------------------------------------------------

describe("SpawnSwarmTool — CLI backend", () => {
	let tool: SpawnSwarmTool
	let callbacks: ToolCallbacks

	beforeEach(() => {
		tool = new SpawnSwarmTool()
		callbacks = makeCallbacks()
		vi.mocked(getWorkerBackend).mockReturnValue({
			spawn: vi.fn().mockResolvedValue({ agentId: "worker-1@session-1", pid: 1234 }),
			waitForAll: vi.fn().mockResolvedValue(undefined),
			terminate: vi.fn().mockResolvedValue(undefined),
			isActive: vi.fn().mockResolvedValue(false),
		})
	})

	it("pushes a tool error when getWorkerBackend returns null", async () => {
		vi.mocked(getWorkerBackend).mockReturnValue(null)
		const provider = makeProvider()
		const task = makeTask(provider)
		await tool.execute(
			{ workers: SINGLE_WORKER, task_list: TWO_TASKS, backend: "cli" } as any,
			task as any,
			callbacks,
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("CLI worker backend is not available"),
		)
	})

	it("spawns one CliWorkerBackend process per worker spec", async () => {
		const spawnFn = vi.fn().mockResolvedValue({ agentId: "worker-1@session-1", pid: 1234 })
		vi.mocked(getWorkerBackend).mockReturnValue({
			spawn: spawnFn,
			waitForAll: vi.fn().mockResolvedValue(undefined),
			terminate: vi.fn(),
			isActive: vi.fn().mockResolvedValue(false),
		})
		const provider = makeProvider()
		const task = makeTask(provider)
		await tool.execute(
			{ workers: TWO_WORKERS, task_list: TWO_TASKS, backend: "cli" } as any,
			task as any,
			callbacks,
		)
		expect(spawnFn).toHaveBeenCalledTimes(2)
	})

	it("waits for all CLI processes to exit via waitForAll", async () => {
		const waitForAllFn = vi.fn().mockResolvedValue(undefined)
		vi.mocked(getWorkerBackend).mockReturnValue({
			spawn: vi.fn().mockResolvedValue({ agentId: "w@s", pid: 1 }),
			waitForAll: waitForAllFn,
			terminate: vi.fn(),
			isActive: vi.fn().mockResolvedValue(false),
		})
		const provider = makeProvider()
		const task = makeTask(provider)
		await tool.execute(
			{ workers: SINGLE_WORKER, task_list: TWO_TASKS, backend: "cli" } as any,
			task as any,
			callbacks,
		)
		expect(waitForAllFn).toHaveBeenCalled()
	})

	it("destroys the file mailbox after all workers complete", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		await tool.execute(
			{ workers: SINGLE_WORKER, task_list: TWO_TASKS, backend: "cli" } as any,
			task as any,
			callbacks,
		)
		expect(provider.mailboxManager.destroyMailbox).toHaveBeenCalledWith("session-1")
	})

	it("pushes a completion message containing the session ID", async () => {
		const provider = makeProvider()
		const task = makeTask(provider)
		await tool.execute(
			{ workers: SINGLE_WORKER, task_list: TWO_TASKS, backend: "cli" } as any,
			task as any,
			callbacks,
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("session-1"))
	})
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("SpawnSwarmTool — error handling", () => {
	it("calls handleError when spawnConcurrentChildren throws", async () => {
		const tool = new SpawnSwarmTool()
		const callbacks = makeCallbacks()
		const provider = makeProvider({
			spawnConcurrentChildren: vi.fn().mockRejectedValue(new Error("spawn failed")),
		})
		const task = makeTask(provider)
		await tool.execute({ workers: SINGLE_WORKER, task_list: TWO_TASKS } as any, task as any, callbacks)
		expect(callbacks.handleError).toHaveBeenCalledWith("running swarm", expect.any(Error))
	})
})
