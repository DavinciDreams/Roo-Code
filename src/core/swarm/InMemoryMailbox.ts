import EventEmitter from "events"

import type { TeammateMessage, TeammateMessageType } from "@roo-code/types"

import type { IMailboxService } from "./IMailboxService"

/**
 * In-process mailbox backed by a plain Map + EventEmitter.
 * Delivery is synchronous (within the same event loop turn) so there is zero
 * polling latency.  A configurable timeout provides a safety fallback.
 */
export class InMemoryMailbox implements IMailboxService {
	private queues = new Map<string, TeammateMessage[]>()
	private emitter = new EventEmitter()

	constructor() {
		// Suppress MaxListenersExceededWarning when many workers are waiting simultaneously.
		this.emitter.setMaxListeners(0)
	}

	async send(to: string, msg: TeammateMessage): Promise<void> {
		if (!this.queues.has(to)) this.queues.set(to, [])
		this.queues.get(to)!.push(msg)
		this.emitter.emit(`msg:${to}`)
	}

	async read(agentId: string): Promise<TeammateMessage[]> {
		return [...(this.queues.get(agentId) ?? [])]
	}

	async markRead(agentId: string, idx: number): Promise<void> {
		this.queues.get(agentId)?.splice(idx, 1)
	}

	async waitForMessage(
		agentId: string,
		types: TeammateMessageType[],
		opts: { timeoutMs?: number } = {},
	): Promise<TeammateMessage | null> {
		const { timeoutMs = 60_000 } = opts

		// Check the existing queue before registering a listener.
		const match = this.dequeueMatching(agentId, types)
		if (match) return match

		return new Promise((resolve) => {
			let settled = false

			const timer = setTimeout(() => {
				if (settled) return
				settled = true
				this.emitter.off(`msg:${agentId}`, handler)
				resolve(null)
			}, timeoutMs)

			const handler = () => {
				if (settled) return
				const msg = this.dequeueMatching(agentId, types)
				if (!msg) return // Message was of a different type — keep waiting.
				settled = true
				clearTimeout(timer)
				this.emitter.off(`msg:${agentId}`, handler)
				resolve(msg)
			}

			this.emitter.on(`msg:${agentId}`, handler)
		})
	}

	dispose(): void {
		this.queues.clear()
		this.emitter.removeAllListeners()
	}

	private dequeueMatching(agentId: string, types: TeammateMessageType[]): TeammateMessage | null {
		const q = this.queues.get(agentId)
		if (!q) return null
		const idx = q.findIndex((m) => types.includes(m.type))
		if (idx < 0) return null
		return q.splice(idx, 1)[0]
	}
}
