/**
 * Swarm / multi-agent identity types.
 * These types describe agent identities, sessions, and the message envelope
 * used between agents (mailbox protocol, implemented in Phase 3+).
 */

export type AgentColorName = "red" | "blue" | "green" | "yellow" | "purple" | "orange" | "pink" | "cyan"

/**
 * Stable identity for a single agent within a swarm session.
 */
export interface AgentIdentity {
	/** Stable unique identifier — "<name>@<sessionId>" */
	agentId: string
	/** Human-readable role name (e.g. "Backend Engineer") */
	agentName: string
	/** Assigned display color */
	color: AgentColorName
	/** True for the task that called spawnConcurrentChildren */
	isLeader: boolean
	/** The Roo-Code taskId this identity is bound to */
	taskId: string
}

/**
 * In-memory session tracking all agents spawned by a single concurrent spawn call.
 * Keyed by taskId in the `teammates` record.
 */
export interface SwarmSession {
	/** Same as the leaderTaskId for simplicity */
	sessionId: string
	/** The parent task that created this session */
	leaderTaskId: string
	/** All registered worker identities, keyed by taskId */
	teammates: Record<string, AgentIdentity>
}

// ---------------------------------------------------------------------------
// Mailbox protocol (P3 stubs — types only, no implementation yet)
// ---------------------------------------------------------------------------

export type TeammateMessageType =
	| "task_assignment"
	| "idle_notification"
	| "shutdown_request"
	| "permission_request"
	| "permission_response"

export interface TeammateMessage {
	type: TeammateMessageType
	from: string
	to: string
	payload?: Record<string, unknown>
	ts: number
}
