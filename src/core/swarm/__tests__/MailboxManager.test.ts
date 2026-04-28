// npx vitest core/swarm/__tests__/MailboxManager.test.ts

import os from "os"
import path from "path"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { MailboxManager } from "../MailboxManager"
import { InMemoryMailbox } from "../InMemoryMailbox"
import { FileMailbox } from "../FileMailbox"

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Single shared mock object — returned by both constructors so tests can assert
// on the same `.send` / `.waitForMessage` / `.dispose` spies.
const mockMailbox = {
	send: vi.fn().mockResolvedValue(undefined),
	read: vi.fn().mockResolvedValue([]),
	waitForMessage: vi.fn().mockResolvedValue(null),
	dispose: vi.fn(),
}

vi.mock("../InMemoryMailbox", () => ({
	InMemoryMailbox: vi.fn().mockImplementation(() => mockMailbox),
}))

vi.mock("../FileMailbox", () => ({
	FileMailbox: vi.fn().mockImplementation(() => mockMailbox),
}))

// ---------------------------------------------------------------------------
// createMailbox / createFileMailbox
// ---------------------------------------------------------------------------

describe("MailboxManager — createMailbox / createFileMailbox", () => {
	let manager: MailboxManager

	beforeEach(() => {
		manager = new MailboxManager()
		vi.clearAllMocks()
	})

	it("createMailbox creates a new InMemoryMailbox for the session", () => {
		manager.createMailbox("s1")
		expect(InMemoryMailbox).toHaveBeenCalledTimes(1)
		expect(manager.getMailbox("s1")).toBeDefined()
	})

	it("createMailbox is idempotent — a second call for the same sessionId does not replace the first mailbox", () => {
		manager.createMailbox("s1")
		const first = manager.getMailbox("s1")
		manager.createMailbox("s1")
		expect(manager.getMailbox("s1")).toBe(first)
		expect(InMemoryMailbox).toHaveBeenCalledTimes(1)
	})

	it("createFileMailbox creates a new FileMailbox for the session", () => {
		manager.createFileMailbox("s1", "/tmp/roo/swarm/s1")
		expect(FileMailbox).toHaveBeenCalledTimes(1)
		expect(manager.getMailbox("s1")).toBeDefined()
	})

	it("createFileMailbox passes the provided baseDir to the FileMailbox constructor", () => {
		manager.createFileMailbox("s1", "/custom/dir")
		expect(FileMailbox).toHaveBeenCalledWith("/custom/dir")
	})

	it("createFileMailbox derives a default baseDir of ~/.roo/swarm/<sessionId>/ when baseDir is omitted", () => {
		manager.createFileMailbox("s1")
		const expected = path.join(os.homedir(), ".roo", "swarm", "s1")
		expect(FileMailbox).toHaveBeenCalledWith(expected)
	})

	it("createFileMailbox is idempotent — a second call for the same sessionId does not replace the first mailbox", () => {
		manager.createFileMailbox("s1", "/a")
		const first = manager.getMailbox("s1")
		manager.createFileMailbox("s1", "/b")
		expect(manager.getMailbox("s1")).toBe(first)
		expect(FileMailbox).toHaveBeenCalledTimes(1)
	})

	it("getMailbox returns undefined for an unknown sessionId", () => {
		expect(manager.getMailbox("unknown")).toBeUndefined()
	})

	it("getMailbox returns the mailbox after createMailbox is called", () => {
		manager.createMailbox("s1")
		expect(manager.getMailbox("s1")).toBeDefined()
	})
})

// ---------------------------------------------------------------------------
// notifyIdle
// ---------------------------------------------------------------------------

describe("MailboxManager — notifyIdle", () => {
	let manager: MailboxManager

	beforeEach(() => {
		manager = new MailboxManager()
		vi.clearAllMocks()
	})

	it("sends an idle_notification message addressed to leader:<sessionId>", async () => {
		manager.createMailbox("s1")
		await manager.notifyIdle("s1", "worker-1@s1", "done")
		expect(mockMailbox.send).toHaveBeenCalledWith(
			"leader:s1",
			expect.objectContaining({ type: "idle_notification", to: "leader:s1" }),
		)
	})

	it("includes the workerId, summary, and any extra payload fields in the message", async () => {
		manager.createMailbox("s1")
		await manager.notifyIdle("s1", "worker-1@s1", "done", { extra: "data" })
		expect(mockMailbox.send).toHaveBeenCalledWith(
			"leader:s1",
			expect.objectContaining({
				payload: expect.objectContaining({ workerId: "worker-1@s1", summary: "done", extra: "data" }),
			}),
		)
	})

	it("is a no-op when no mailbox exists for the session (does not throw)", async () => {
		await expect(manager.notifyIdle("unknown", "w", "done")).resolves.toBeUndefined()
		expect(mockMailbox.send).not.toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------
// assignTask
// ---------------------------------------------------------------------------

describe("MailboxManager — assignTask", () => {
	let manager: MailboxManager

	beforeEach(() => {
		manager = new MailboxManager()
		vi.clearAllMocks()
	})

	it("sends a task_assignment message addressed to the workerId", async () => {
		manager.createMailbox("s1")
		await manager.assignTask("s1", "worker-1@s1", "do something")
		expect(mockMailbox.send).toHaveBeenCalledWith(
			"worker-1@s1",
			expect.objectContaining({ type: "task_assignment", to: "worker-1@s1" }),
		)
	})

	it("includes the task message string in the payload", async () => {
		manager.createMailbox("s1")
		await manager.assignTask("s1", "worker-1@s1", "do something")
		expect(mockMailbox.send).toHaveBeenCalledWith(
			"worker-1@s1",
			expect.objectContaining({ payload: { message: "do something" } }),
		)
	})

	it("throws when no mailbox exists for the session", async () => {
		await expect(manager.assignTask("unknown", "w", "task")).rejects.toThrow('No mailbox for session "unknown"')
	})
})

// ---------------------------------------------------------------------------
// shutdownWorker
// ---------------------------------------------------------------------------

describe("MailboxManager — shutdownWorker", () => {
	let manager: MailboxManager

	beforeEach(() => {
		manager = new MailboxManager()
		vi.clearAllMocks()
	})

	it("sends a shutdown_request message addressed to the workerId", async () => {
		manager.createMailbox("s1")
		await manager.shutdownWorker("s1", "worker-1@s1")
		expect(mockMailbox.send).toHaveBeenCalledWith(
			"worker-1@s1",
			expect.objectContaining({ type: "shutdown_request", to: "worker-1@s1" }),
		)
	})

	it("is a no-op when no mailbox exists for the session (does not throw)", async () => {
		await expect(manager.shutdownWorker("unknown", "w")).resolves.toBeUndefined()
		expect(mockMailbox.send).not.toHaveBeenCalled()
	})
})

// ---------------------------------------------------------------------------
// waitForLeaderMessage
// ---------------------------------------------------------------------------

describe("MailboxManager — waitForLeaderMessage", () => {
	let manager: MailboxManager

	beforeEach(() => {
		manager = new MailboxManager()
		vi.clearAllMocks()
	})

	it("delegates to mailbox.waitForMessage with recipient 'leader:<sessionId>' and type ['idle_notification']", async () => {
		manager.createMailbox("s1")
		await manager.waitForLeaderMessage("s1")
		expect(mockMailbox.waitForMessage).toHaveBeenCalledWith("leader:s1", ["idle_notification"], undefined)
	})

	it("forwards the timeoutMs option to the underlying mailbox", async () => {
		manager.createMailbox("s1")
		await manager.waitForLeaderMessage("s1", { timeoutMs: 5000 })
		expect(mockMailbox.waitForMessage).toHaveBeenCalledWith("leader:s1", ["idle_notification"], { timeoutMs: 5000 })
	})

	it("returns null when no mailbox exists for the session", async () => {
		expect(await manager.waitForLeaderMessage("unknown")).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// waitForNextMessage
// ---------------------------------------------------------------------------

describe("MailboxManager — waitForNextMessage", () => {
	let manager: MailboxManager

	beforeEach(() => {
		manager = new MailboxManager()
		vi.clearAllMocks()
	})

	it("delegates to mailbox.waitForMessage with the workerId and types ['task_assignment', 'shutdown_request']", async () => {
		manager.createMailbox("s1")
		await manager.waitForNextMessage("s1", "worker-1@s1")
		expect(mockMailbox.waitForMessage).toHaveBeenCalledWith(
			"worker-1@s1",
			["task_assignment", "shutdown_request"],
			undefined,
		)
	})

	it("returns null when no mailbox exists for the session", async () => {
		expect(await manager.waitForNextMessage("unknown", "w")).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// destroyMailbox / dispose
// ---------------------------------------------------------------------------

describe("MailboxManager — destroyMailbox / dispose", () => {
	let manager: MailboxManager

	beforeEach(() => {
		manager = new MailboxManager()
		vi.clearAllMocks()
	})

	it("destroyMailbox calls dispose() on the mailbox and removes it from the map", () => {
		manager.createMailbox("s1")
		manager.destroyMailbox("s1")
		expect(mockMailbox.dispose).toHaveBeenCalledTimes(1)
		expect(manager.getMailbox("s1")).toBeUndefined()
	})

	it("destroyMailbox is a no-op for an unknown sessionId", () => {
		expect(() => manager.destroyMailbox("unknown")).not.toThrow()
	})

	it("dispose() calls dispose() on every registered mailbox and empties the map", () => {
		manager.createMailbox("s1")
		manager.createMailbox("s2")
		manager.dispose()
		expect(mockMailbox.dispose).toHaveBeenCalled()
		expect(manager.getMailbox("s1")).toBeUndefined()
		expect(manager.getMailbox("s2")).toBeUndefined()
	})

	it("getMailbox returns undefined for a session after destroyMailbox is called", () => {
		manager.createMailbox("s1")
		manager.destroyMailbox("s1")
		expect(manager.getMailbox("s1")).toBeUndefined()
	})
})
