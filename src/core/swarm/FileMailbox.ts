import fs from "fs/promises"
import path from "path"

import lockfile from "proper-lockfile"

import type { TeammateMessage, TeammateMessageType } from "@roo-code/types"

import type { IMailboxService } from "./IMailboxService"

const POLL_INTERVAL_MS = 500

/**
 * File-backed mailbox for cross-process swarm workers.
 *
 * Each agent's queue lives at `<baseDir>/<safe-agentId>.json`.
 * Concurrent writes are serialised with proper-lockfile (advisory lock
 * via a sibling `.lock` directory); polling replaces the EventEmitter
 * used by InMemoryMailbox.
 *
 * baseDir is typically `~/.roo/swarm/<sessionId>/`.
 */
export class FileMailbox implements IMailboxService {
	private _disposed = false

	constructor(private readonly baseDir: string) {}

	// -------------------------------------------------------------------------
	// IMailboxService
	// -------------------------------------------------------------------------

	async send(to: string, msg: TeammateMessage): Promise<void> {
		const p = await this.ensureInbox(to)
		await this.withLock(p, async () => {
			const queue = await this.readRaw(p)
			queue.push(msg)
			await fs.writeFile(p, JSON.stringify(queue, null, 2), "utf-8")
		})
	}

	async read(agentId: string): Promise<TeammateMessage[]> {
		const p = this.inboxPath(agentId)
		return this.readRaw(p)
	}

	async markRead(agentId: string, idx: number): Promise<void> {
		const p = await this.ensureInbox(agentId)
		await this.withLock(p, async () => {
			const queue = await this.readRaw(p)
			queue.splice(idx, 1)
			await fs.writeFile(p, JSON.stringify(queue, null, 2), "utf-8")
		})
	}

	async waitForMessage(
		agentId: string,
		types: TeammateMessageType[],
		opts: { timeoutMs?: number } = {},
	): Promise<TeammateMessage | null> {
		const { timeoutMs = 60_000 } = opts

		if (this._disposed) return null

		const immediate = await this.dequeueMatching(agentId, types)
		if (immediate) return immediate

		return new Promise((resolve) => {
			let settled = false

			const finish = (msg: TeammateMessage | null) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				clearInterval(poll)
				resolve(msg)
			}

			const timer = setTimeout(() => finish(null), timeoutMs)

			const poll = setInterval(async () => {
				if (settled || this._disposed) {
					finish(null)
					return
				}
				const msg = await this.dequeueMatching(agentId, types)
				if (msg) finish(msg)
			}, POLL_INTERVAL_MS)
		})
	}

	dispose(): void {
		this._disposed = true
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private inboxPath(agentId: string): string {
		// Sanitise agentId so it's safe as a filename.
		const safe = agentId.replace(/[^a-zA-Z0-9_-]/g, "_")
		return path.join(this.baseDir, `${safe}.json`)
	}

	/** Ensure the inbox file and its parent directory exist. Race-safe. */
	private async ensureInbox(agentId: string): Promise<string> {
		const p = this.inboxPath(agentId)
		await fs.mkdir(path.dirname(p), { recursive: true })
		try {
			// wx = exclusive create; throws EEXIST if the file is already there
			await fs.writeFile(p, "[]", { flag: "wx", encoding: "utf-8" })
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
		}
		return p
	}

	private async readRaw(filePath: string): Promise<TeammateMessage[]> {
		try {
			const raw = await fs.readFile(filePath, "utf-8")
			return JSON.parse(raw) as TeammateMessage[]
		} catch {
			return []
		}
	}

	private async withLock(filePath: string, fn: () => Promise<void>): Promise<void> {
		const release = await lockfile.lock(filePath, {
			retries: { retries: 10, minTimeout: 50, maxTimeout: 200 },
		})
		try {
			await fn()
		} finally {
			await release()
		}
	}

	/** Read, find the first matching message, remove it, write back. */
	private async dequeueMatching(agentId: string, types: TeammateMessageType[]): Promise<TeammateMessage | null> {
		const p = this.inboxPath(agentId)
		try {
			await fs.access(p)
		} catch {
			return null // inbox file doesn't exist yet
		}

		let result: TeammateMessage | null = null
		await this.withLock(p, async () => {
			const queue = await this.readRaw(p)
			const idx = queue.findIndex((m) => types.includes(m.type))
			if (idx >= 0) {
				result = queue.splice(idx, 1)[0]
				await fs.writeFile(p, JSON.stringify(queue, null, 2), "utf-8")
			}
		})
		return result
	}
}
