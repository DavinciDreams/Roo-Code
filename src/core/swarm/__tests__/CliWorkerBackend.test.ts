// npx vitest core/swarm/__tests__/CliWorkerBackend.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { CliWorkerBackend } from "../backends/CliWorkerBackend"
import type { WorkerSpawnConfig } from "../backends/IWorkerBackend"
import { spawn } from "child_process"

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

function makeMockChild(exitImmediately = true) {
	const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}

	const child = {
		pid: 9999,
		kill: vi.fn(),
		stdout: { on: vi.fn() },
		stderr: { on: vi.fn() },
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			if (!listeners[event]) listeners[event] = []
			listeners[event].push(handler)
			if (event === "exit" && exitImmediately) {
				handler(0)
			}
		}),
		emit: (event: string, ...args: unknown[]) => listeners[event]?.forEach((h) => h(...args)),
	}

	return child
}

vi.mock("child_process", () => ({
	spawn: vi.fn(() => makeMockChild()),
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<WorkerSpawnConfig> = {}): WorkerSpawnConfig {
	return {
		agentId: "worker-1@session-1",
		agentName: "worker-1",
		mode: "code",
		sessionId: "session-1",
		mailboxDir: "/tmp/roo/swarm/session-1",
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------

describe("CliWorkerBackend — spawn", () => {
	let backend: CliWorkerBackend

	beforeEach(() => {
		backend = new CliWorkerBackend()
		vi.clearAllMocks()
		vi.mocked(spawn).mockImplementation((() => makeMockChild()) as any)
	})

	it("spawns a child process using process.execPath as the Node binary", async () => {
		await backend.spawn(makeConfig())
		expect(spawn).toHaveBeenCalledWith(process.execPath, expect.any(Array), expect.any(Object))
	})

	it("passes --agent-id, --session-id, --mode, and --mailbox-dir as CLI arguments", async () => {
		await backend.spawn(makeConfig())
		const args = vi.mocked(spawn).mock.calls[0][1] as string[]
		expect(args).toContain("--agent-id")
		expect(args).toContain("worker-1@session-1")
		expect(args).toContain("--session-id")
		expect(args).toContain("session-1")
		expect(args).toContain("--mode")
		expect(args).toContain("code")
		expect(args).toContain("--mailbox-dir")
		expect(args).toContain("/tmp/roo/swarm/session-1")
	})

	it("uses stdio: pipe (not inherit) so worker output can be prefixed", async () => {
		await backend.spawn(makeConfig())
		const options = vi.mocked(spawn).mock.calls[0][2] as any
		expect(options.stdio).toEqual(["pipe", "pipe", "pipe"])
	})

	it("passes --workspace when workspacePath is specified", async () => {
		await backend.spawn(makeConfig({ workspacePath: "/my/workspace" }))
		const args = vi.mocked(spawn).mock.calls[0][1] as string[]
		expect(args).toContain("--workspace")
		expect(args).toContain("/my/workspace")
	})

	it("does NOT pass --workspace when workspacePath is omitted", async () => {
		await backend.spawn(makeConfig({ workspacePath: undefined }))
		const args = vi.mocked(spawn).mock.calls[0][1] as string[]
		expect(args).not.toContain("--workspace")
	})

	it("passes --model when model is specified", async () => {
		await backend.spawn(makeConfig({ model: "claude-opus-4-7" }))
		const args = vi.mocked(spawn).mock.calls[0][1] as string[]
		expect(args).toContain("--model")
		expect(args).toContain("claude-opus-4-7")
	})

	it("returns the correct agentId in the spawn result", async () => {
		const result = await backend.spawn(makeConfig())
		expect(result.agentId).toBe("worker-1@session-1")
	})

	it("uses a custom workerBinPath when provided", async () => {
		await backend.spawn(makeConfig({ workerBinPath: "/custom/morse-worker.js" }))
		const args = vi.mocked(spawn).mock.calls[0][1] as string[]
		expect(args[0]).toBe("/custom/morse-worker.js")
	})
})

// ---------------------------------------------------------------------------
// isActive
// ---------------------------------------------------------------------------

describe("CliWorkerBackend — isActive", () => {
	let backend: CliWorkerBackend

	beforeEach(() => {
		backend = new CliWorkerBackend()
		vi.clearAllMocks()
	})

	it("returns false for an agent that was never spawned", async () => {
		expect(await backend.isActive("unknown@session")).toBe(false)
	})

	it("returns false for an agent whose process has already exited", async () => {
		vi.mocked(spawn).mockImplementationOnce((() => makeMockChild(true)) as any)
		await backend.spawn(makeConfig())
		// After exit event fires, the process is removed from the map.
		expect(await backend.isActive("worker-1@session-1")).toBe(false)
	})

	it("returns true for an agent that was spawned and has not yet exited", async () => {
		const child = makeMockChild(false) // does NOT fire exit immediately
		vi.mocked(spawn).mockImplementationOnce((() => child) as any)
		await backend.spawn(makeConfig())
		expect(await backend.isActive("worker-1@session-1")).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// terminate
// ---------------------------------------------------------------------------

describe("CliWorkerBackend — terminate", () => {
	let backend: CliWorkerBackend

	beforeEach(() => {
		backend = new CliWorkerBackend()
		vi.clearAllMocks()
	})

	it("sends SIGTERM to a running process", async () => {
		const child = makeMockChild(false)
		vi.mocked(spawn).mockImplementationOnce((() => child) as any)
		await backend.spawn(makeConfig())
		await backend.terminate("worker-1@session-1")
		expect(child.kill).toHaveBeenCalledWith("SIGTERM")
	})

	it("does nothing when terminate is called for an unknown agentId", async () => {
		await expect(backend.terminate("nonexistent@session")).resolves.toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// waitForAll
// ---------------------------------------------------------------------------

describe("CliWorkerBackend — waitForAll", () => {
	let backend: CliWorkerBackend

	beforeEach(() => {
		backend = new CliWorkerBackend()
		vi.clearAllMocks()
	})

	it("resolves immediately when no processes have been spawned", async () => {
		await expect(backend.waitForAll()).resolves.toBeUndefined()
	})

	it("resolves after all spawned processes have exited", async () => {
		vi.mocked(spawn).mockImplementation((() => makeMockChild(true)) as any)
		await backend.spawn(makeConfig({ agentId: "w-1@s" }))
		await backend.spawn(makeConfig({ agentId: "w-2@s" }))
		await expect(backend.waitForAll()).resolves.toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// backend identity
// ---------------------------------------------------------------------------

describe("CliWorkerBackend — backend identity", () => {
	it("backend.name equals 'cli'", () => {
		expect(new CliWorkerBackend().name).toBe("cli")
	})
})

// ---------------------------------------------------------------------------
// stdout/stderr prefixing
// ---------------------------------------------------------------------------

describe("CliWorkerBackend — output prefixing", () => {
	it("attaches stdout and stderr handlers that prefix each line with [worker:id]", async () => {
		const stdoutHandlers: Array<(data: Buffer) => void> = []
		const stderrHandlers: Array<(data: Buffer) => void> = []

		const child = {
			pid: 1,
			kill: vi.fn(),
			on: vi.fn((event: string, handler: () => void) => {
				if (event === "exit") handler()
			}),
			stdout: { on: vi.fn((_e: string, h: (d: Buffer) => void) => stdoutHandlers.push(h)) },
			stderr: { on: vi.fn((_e: string, h: (d: Buffer) => void) => stderrHandlers.push(h)) },
		}

		vi.mocked(spawn).mockImplementationOnce((() => child) as any)

		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

		await backend.spawn(makeConfig({ agentId: "alice@s1" }))

		stdoutHandlers[0]?.(Buffer.from("line1\nline2\n"))
		stderrHandlers[0]?.(Buffer.from("err1\n"))

		expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("[worker:alice@s1] line1"))
		expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("[worker:alice@s1] line2"))
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[worker:alice@s1] err1"))

		stdoutSpy.mockRestore()
		stderrSpy.mockRestore()
	})

	// Declare backend here so the test above can reference it
	let backend: CliWorkerBackend
	beforeEach(() => {
		backend = new CliWorkerBackend()
		vi.clearAllMocks()
	})
})
