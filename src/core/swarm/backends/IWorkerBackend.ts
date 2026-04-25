/**
 * Abstraction over a strategy for running external swarm workers.
 *
 * In-process workers (default) bypass this entirely — they are created via
 * `ClineProvider.spawnConcurrentChildren` and run inside the VS Code extension host.
 *
 * External backends (CLI, VS Code window) use this interface so the
 * `spawn_swarm` tool can treat them uniformly.
 */

export interface WorkerSpawnConfig {
	/** Stable agent identifier: "<name>@<sessionId>" */
	agentId: string
	agentName: string
	/** Roo-Code mode slug the worker will run in */
	mode: string
	sessionId: string
	/** Directory where the FileMailbox JSON files live */
	mailboxDir: string
	workspacePath?: string
	/** Override the model used by this worker */
	model?: string
}

export interface WorkerSpawnResult {
	agentId: string
	/** PID of the spawned process, if applicable */
	pid?: number
}

export interface IWorkerBackend {
	readonly name: string
	spawn(config: WorkerSpawnConfig): Promise<WorkerSpawnResult>
	terminate(agentId: string): Promise<void>
	isActive(agentId: string): Promise<boolean>
	/** Wait for all spawned workers to exit. */
	waitForAll(): Promise<void>
}
