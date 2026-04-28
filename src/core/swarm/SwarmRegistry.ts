import type { AgentColorName, AgentIdentity, SwarmSession } from "@roo-code/types"

const AGENT_COLORS: AgentColorName[] = ["blue", "green", "yellow", "purple", "orange", "pink", "cyan", "red"]

/**
 * In-memory registry that tracks swarm sessions and assigns stable identities
 * (name + color) to concurrent worker agents.
 *
 * One instance lives on ClineProvider.  Sessions are created when
 * spawnConcurrentChildren() starts and destroyed when all children resolve.
 */
export class SwarmRegistry {
	private sessions: Map<string, SwarmSession> = new Map()
	private colorIndex = 0

	createSession(sessionId: string, leaderTaskId: string): SwarmSession {
		const session: SwarmSession = { sessionId, leaderTaskId, teammates: {} }
		this.sessions.set(sessionId, session)
		return session
	}

	/** Round-robin color assignment, stable across the provider lifetime. */
	assignColor(): AgentColorName {
		const color = AGENT_COLORS[this.colorIndex % AGENT_COLORS.length]
		this.colorIndex++
		return color
	}

	registerWorker(sessionId: string, identity: AgentIdentity): void {
		const session = this.sessions.get(sessionId)
		if (session) {
			session.teammates[identity.taskId] = identity
		}
	}

	unregisterWorker(sessionId: string, taskId: string): void {
		const session = this.sessions.get(sessionId)
		if (session) {
			delete session.teammates[taskId]
		}
	}

	getSession(sessionId: string): SwarmSession | undefined {
		return this.sessions.get(sessionId)
	}

	/** Find the session a given task belongs to (as a worker). */
	getSessionForTask(taskId: string): SwarmSession | undefined {
		for (const session of this.sessions.values()) {
			if (taskId in session.teammates) return session
		}
		return undefined
	}

	destroySession(sessionId: string): void {
		this.sessions.delete(sessionId)
	}

	dispose(): void {
		this.sessions.clear()
	}
}
