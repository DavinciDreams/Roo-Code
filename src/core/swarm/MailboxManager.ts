import os from "os"
import path from "path"

import type { TeammateMessage } from "@roo-code/types"

import type { IMailboxService } from "./IMailboxService"
import { InMemoryMailbox } from "./InMemoryMailbox"
import { FileMailbox } from "./FileMailbox"

/**
 * Manages one mailbox per swarm session.
 * A session's mailbox is only created when the session opts in to persistent
 * workers (`persistent: true` on spawnConcurrentChildren).
 *
 * Two backends are available:
 * - InMemoryMailbox  — in-process workers (zero latency, default)
 * - FileMailbox      — cross-process workers (polls JSON file with lockfile)
 *
 * All public methods are no-ops when the session has no mailbox, so callers
 * don't need to guard against missing sessions.
 */
export class MailboxManager {
	private mailboxes = new Map<string, IMailboxService>()

	/** Create an in-process (memory) mailbox for the session. */
	createMailbox(sessionId: string): void {
		if (!this.mailboxes.has(sessionId)) {
			this.mailboxes.set(sessionId, new InMemoryMailbox())
		}
	}

	/**
	 * Create a file-backed mailbox for the session.
	 * Used by cross-process workers (P5/P6).
	 * Files land at `<baseDir>/<safe-agentId>.json`.
	 * Defaults to `~/.roo/swarm/<sessionId>/` when baseDir is omitted.
	 */
	createFileMailbox(sessionId: string, baseDir?: string): void {
		if (!this.mailboxes.has(sessionId)) {
			const dir = baseDir ?? path.join(os.homedir(), ".roo", "swarm", sessionId)
			this.mailboxes.set(sessionId, new FileMailbox(dir))
		}
	}

	getMailbox(sessionId: string): IMailboxService | undefined {
		return this.mailboxes.get(sessionId)
	}

	/**
	 * Called by a worker when it finishes a turn.
	 * Stores an `idle_notification` in the worker's own queue so the leader's
	 * `on(WorkerIdle)` handler can read it if needed.
	 */
	async notifyIdle(
		sessionId: string,
		workerId: string,
		summary: string,
		payload?: Record<string, unknown>,
	): Promise<void> {
		const mailbox = this.mailboxes.get(sessionId)
		if (!mailbox) return
		await mailbox.send(`leader:${sessionId}`, {
			type: "idle_notification",
			from: workerId,
			to: `leader:${sessionId}`,
			payload: { workerId, summary, ...payload },
			ts: Date.now(),
		})
	}

	/** Leader assigns a new task to an idle worker. */
	async assignTask(sessionId: string, workerId: string, message: string): Promise<void> {
		const mailbox = this.mailboxes.get(sessionId)
		if (!mailbox) throw new Error(`[MailboxManager] No mailbox for session "${sessionId}"`)
		await mailbox.send(workerId, {
			type: "task_assignment",
			from: `leader:${sessionId}`,
			to: workerId,
			payload: { message },
			ts: Date.now(),
		})
	}

	/** Leader tells a worker to stop after its current idle period. */
	async shutdownWorker(sessionId: string, workerId: string): Promise<void> {
		const mailbox = this.mailboxes.get(sessionId)
		if (!mailbox) return
		await mailbox.send(workerId, {
			type: "shutdown_request",
			from: `leader:${sessionId}`,
			to: workerId,
			ts: Date.now(),
		})
	}

	/**
	 * Waits for the next `idle_notification` sent by any worker to the leader.
	 * Used by the spawn_swarm coordination loop to know when a worker is free.
	 * Returns null on timeout or when no mailbox exists for the session.
	 */
	async waitForLeaderMessage(sessionId: string, opts?: { timeoutMs?: number }): Promise<TeammateMessage | null> {
		const mailbox = this.mailboxes.get(sessionId)
		if (!mailbox) return null
		return mailbox.waitForMessage(`leader:${sessionId}`, ["idle_notification"], opts)
	}

	/**
	 * Waits for the worker's next `task_assignment` or `shutdown_request`.
	 * Returns null if the timeout fires first or the session has no mailbox.
	 */
	async waitForNextMessage(
		sessionId: string,
		workerId: string,
		opts?: { timeoutMs?: number },
	): Promise<TeammateMessage | null> {
		const mailbox = this.mailboxes.get(sessionId)
		if (!mailbox) return null
		return mailbox.waitForMessage(workerId, ["task_assignment", "shutdown_request"], opts)
	}

	destroyMailbox(sessionId: string): void {
		this.mailboxes.get(sessionId)?.dispose()
		this.mailboxes.delete(sessionId)
	}

	dispose(): void {
		for (const mailbox of this.mailboxes.values()) mailbox.dispose()
		this.mailboxes.clear()
	}
}
