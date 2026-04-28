// npx vitest core/tools/__tests__/NewTaskTool.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NewTaskTool } from "../NewTaskTool"
import type { ToolCallbacks } from "../BaseTool"
import { getModeBySlug } from "../../../shared/modes"

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({ get: vi.fn().mockReturnValue(false) })),
	},
}))

vi.mock("../../../shared/package", () => ({
	Package: {
		name: "morse-code",
		publisher: "MorseCode",
		version: "1.0.0",
		outputChannel: "Morse-Code",
	},
}))

vi.mock("../../../shared/modes", () => ({
	getModeBySlug: vi.fn(() => ({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "Test role",
		groups: ["command", "read", "edit"],
	})),
	defaultModeSlug: "ask",
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Tool Error: ${msg}`),
	},
}))

vi.mock("../UpdateTodoListTool", () => ({
	parseMarkdownChecklist: vi.fn(() => []),
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Record<string, unknown> = {}) {
	return {
		getState: vi.fn().mockResolvedValue({ mode: "ask", customModes: [] }),
		handleModeSwitch: vi.fn(),
		delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
		...overrides,
	}
}

function makeTask(provider: ReturnType<typeof makeProvider>, overrides: Record<string, unknown> = {}) {
	return {
		taskId: "parent-1",
		consecutiveMistakeCount: 0,
		isPaused: false,
		pausedModeSlug: "ask",
		enableCheckpoints: false,
		checkpointSave: vi.fn(),
		startSubtask: vi.fn().mockResolvedValue({ taskId: "child-1" }),
		ask: vi.fn(),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing param error"),
		emit: vi.fn(),
		recordToolError: vi.fn(),
		didToolFailInCurrentTurn: false,
		providerRef: { deref: vi.fn(() => provider) },
		...overrides,
	}
}

function makeCallbacks(): ToolCallbacks {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn().mockResolvedValue(undefined),
		pushToolResult: vi.fn(),
	}
}

// ---------------------------------------------------------------------------
// worktree parameter
// ---------------------------------------------------------------------------

describe("NewTaskTool — worktree parameter", () => {
	beforeEach(() => vi.clearAllMocks())

	it("passes the worktree parameter through to delegateParentAndOpenChild when provided", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something", worktree: "/my/worktree" }, task as any, callbacks)
		expect(provider.delegateParentAndOpenChild).toHaveBeenCalledWith(
			expect.objectContaining({ worktree: "/my/worktree" }),
		)
	})

	it("omits worktree from the delegation call when it is not provided", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		const call = (provider.delegateParentAndOpenChild as any).mock.calls[0][0]
		expect(call.worktree).toBeUndefined()
	})

	it("accepts 'auto' as a valid worktree value", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something", worktree: "auto" }, task as any, callbacks)
		expect(provider.delegateParentAndOpenChild).toHaveBeenCalledWith(expect.objectContaining({ worktree: "auto" }))
	})

	it("passes an explicit branch name string as the worktree value", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute(
			{ mode: "code", message: "do something", worktree: "feature/my-branch" },
			task as any,
			callbacks,
		)
		expect(provider.delegateParentAndOpenChild).toHaveBeenCalledWith(
			expect.objectContaining({ worktree: "feature/my-branch" }),
		)
	})
})

// ---------------------------------------------------------------------------
// class interface
// ---------------------------------------------------------------------------

describe("NewTaskTool — class interface", () => {
	beforeEach(() => vi.clearAllMocks())

	it("tool.name property equals 'new_task'", () => {
		expect(new NewTaskTool().name).toBe("new_task")
	})

	it("execute() delegates to the child and pushes a result string containing the child taskId", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("child-1"))
	})
})

// ---------------------------------------------------------------------------
// mode validation
// ---------------------------------------------------------------------------

describe("NewTaskTool — mode validation", () => {
	beforeEach(() => vi.clearAllMocks())

	it("rejects an unrecognised mode slug with an appropriate error message", async () => {
		vi.mocked(getModeBySlug).mockReturnValueOnce(undefined as any)
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "nonexistent", message: "do something" }, task as any, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Invalid mode"))
	})

	it("accepts any slug returned by getModeBySlug", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(provider.delegateParentAndOpenChild).toHaveBeenCalled()
	})

	it("does not increment consecutiveMistakeCount on a valid mode", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(task.consecutiveMistakeCount).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// approval flow
// ---------------------------------------------------------------------------

describe("NewTaskTool — approval flow", () => {
	beforeEach(() => vi.clearAllMocks())

	it("calls askApproval before delegating to the child task", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(callbacks.askApproval).toHaveBeenCalled()
	})

	it("does not call delegateParentAndOpenChild when the user denies approval", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		;(callbacks.askApproval as any).mockResolvedValue(false)
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(provider.delegateParentAndOpenChild).not.toHaveBeenCalled()
	})

	it("pushes no tool result when the user denies approval", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		;(callbacks.askApproval as any).mockResolvedValue(false)
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------
// checkpoint integration
// ---------------------------------------------------------------------------

describe("NewTaskTool — checkpoint integration", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not call checkpointSave (checkpoint lifecycle is managed externally)", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider)
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(task.checkpointSave).not.toHaveBeenCalled()
	})

	it("completes successfully regardless of the enableCheckpoints flag", async () => {
		const tool = new NewTaskTool()
		const provider = makeProvider()
		const task = makeTask(provider, { enableCheckpoints: true })
		const callbacks = makeCallbacks()
		await tool.execute({ mode: "code", message: "do something" }, task as any, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("child-1"))
	})
})
