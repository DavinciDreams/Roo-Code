import type { TeammateMessage, TeammateMessageType } from "@roo-code/types"

/**
 * Abstraction over a mailbox backend.
 * - InMemoryMailbox  — in-process workers (P3, zero latency)
 * - FileMailbox      — cross-process workers (P5, uses proper-lockfile)
 */
export interface IMailboxService {
	/** Deliver a message to the agent identified by `to`. */
	send(to: string, msg: TeammateMessage): Promise<void>

	/** Peek at all pending messages for `agentId` without removing them. */
	read(agentId: string): Promise<TeammateMessage[]>

	/** Remove the message at `idx` for `agentId`. */
	markRead(agentId: string, idx: number): Promise<void>

	/**
	 * Wait for the next message whose type is in `types`.
	 * Removes the matched message from the queue before returning it.
	 * Returns null if the timeout elapses before a matching message arrives.
	 */
	waitForMessage(
		agentId: string,
		types: TeammateMessageType[],
		opts?: { timeoutMs?: number },
	): Promise<TeammateMessage | null>

	dispose(): void
}
