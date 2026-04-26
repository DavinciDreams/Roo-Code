import os from "os"
import path from "path"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { MailboxManager } from "../swarm/MailboxManager"
import { getWorkerBackend } from "../swarm/backends/registry"
import type { WorkerBackendType } from "../swarm/backends/registry"

interface WorkerSpec {
	name: string
	mode: string
	color?: string
}

interface SpawnSwarmParams {
	workers: WorkerSpec[]
	task_list: string[]
	abort_on_failure?: boolean
	backend?: WorkerBackendType
}

interface SwarmProvider {
	spawnConcurrentChildren(params: {
		parentTaskId: string
		tasks: Array<{ mode: string; message: string; role?: string }>
		abortOnChildFailure?: boolean
		persistent?: boolean
	}): Promise<Array<{ taskId: string; summary: string; payload?: Record<string, unknown>; error?: string }>>
	mailboxManager: MailboxManager
}

/**
 * Tool that spawns a pool of named worker agents and distributes a task list
 * across them using the mailbox coordination system.
 *
 * Workers are created either in-process (inside the VS Code extension host) or
 * as headless CLI processes depending on the requested backend. Tasks are fed to
 * idle workers one at a time; when the queue is exhausted each worker receives a
 * shutdown signal. The tool resolves only after all workers have finished.
 */
export class SpawnSwarmTool extends BaseTool<"spawn_swarm"> {
	readonly name = "spawn_swarm" as const

	/**
	 * Validates parameters, selects the appropriate worker backend, and runs the
	 * swarm to completion before pushing a formatted result summary.
	 *
	 * @param params.workers - Ordered list of worker specs (name, mode, optional color).
	 * @param params.task_list - Ordered list of task strings to distribute across workers.
	 * @param params.abort_on_failure - When true, a single worker failure halts the entire swarm.
	 * @param params.backend - Worker execution backend; `"in_process"` (default) or `"cli"`.
	 * @param task - The owning Task instance, used to access the provider and mailbox manager.
	 * @param callbacks - Standard tool callbacks for error handling and result delivery.
	 */
	async execute(params: SpawnSwarmParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { workers, task_list, abort_on_failure = false, backend = "in_process" } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!workers || workers.length === 0) {
				pushToolResult(formatResponse.toolError("spawn_swarm requires at least one worker"))
				return
			}
			if (!task_list || task_list.length === 0) {
				pushToolResult(formatResponse.toolError("spawn_swarm requires at least one task in task_list"))
				return
			}

			if (backend === "cli") {
				await this.runWithCliBackend(params, task, pushToolResult)
			} else {
				await this.runInProcess(params, task, pushToolResult, handleError)
			}
		} catch (error) {
			await handleError("running swarm", error as Error)
		}
	}

	// ---------------------------------------------------------------------------
	// In-process path — workers run inside the VS Code extension host
	// ---------------------------------------------------------------------------

	private async runInProcess(
		params: SpawnSwarmParams,
		task: Task,
		pushToolResult: (result: string) => void,
		handleError: (action: string, error: Error) => Promise<void>,
	): Promise<void> {
		const { workers, task_list, abort_on_failure = false } = params
		const provider = task.providerRef.deref() as SwarmProvider | undefined
		if (!provider) {
			pushToolResult(formatResponse.toolError("Provider reference lost"))
			return
		}

		// sessionId = task.taskId (mirrors spawnConcurrentChildren convention)
		const sessionId = task.taskId
		const taskQueue = [...task_list]

		// Distribute initial tasks — one per worker (or fewer if task_list is short)
		const initialTasks = workers.slice(0, taskQueue.length).map((w) => ({
			mode: w.mode,
			message: taskQueue.shift()!,
			role: w.name,
		}))

		if (initialTasks.length === 0) {
			pushToolResult(formatResponse.toolError("No tasks to assign to workers"))
			return
		}

		// Pre-create mailbox so the coordination loop can start before
		// spawnConcurrentChildren creates it (createMailbox is idempotent).
		provider.mailboxManager.createMailbox(sessionId)

		// Run spawn + coordination concurrently.
		const [results] = await Promise.all([
			provider.spawnConcurrentChildren({
				parentTaskId: sessionId,
				tasks: initialTasks,
				abortOnChildFailure: abort_on_failure,
				persistent: true,
			}),
			this.coordinateTaskQueue(provider.mailboxManager, sessionId, taskQueue, initialTasks.length),
		])

		pushToolResult(this.formatResults(results))
	}

	/**
	 * Reads idle_notifications from the leader mailbox and dispatches the next
	 * queued task (or a shutdown_request when the queue is empty).
	 * Runs concurrently with `spawnConcurrentChildren` until all workers shut down.
	 *
	 * `pendingWorkers` is the authoritative counter: it starts at workerCount and
	 * decrements each time we send a shutdown_request. `activeWorkerIds` is a
	 * secondary set used *only* for the timeout path to know which workers to
	 * notify — it tracks workers that have reported idle but haven't been shut down.
	 */
	private async coordinateTaskQueue(
		mailboxManager: MailboxManager,
		sessionId: string,
		remainingTasks: string[],
		workerCount: number,
	): Promise<void> {
		let pendingWorkers = workerCount
		const activeWorkerIds = new Set<string>()

		while (pendingWorkers > 0) {
			const msg = await mailboxManager.waitForLeaderMessage(sessionId, { timeoutMs: 120_000 })

			if (!msg) {
				// Safety timeout — send shutdown to all known active workers before exiting.
				console.warn(
					`[SpawnSwarm] Timed out waiting for worker response — sending shutdown to ${activeWorkerIds.size} tracked worker(s).`,
				)
				for (const id of activeWorkerIds) {
					await mailboxManager.shutdownWorker(sessionId, id).catch(() => {})
				}
				break
			}

			const workerId = msg.payload?.workerId as string | undefined
			if (!workerId) continue

			activeWorkerIds.add(workerId)

			const nextTask = remainingTasks.shift()
			if (nextTask) {
				await mailboxManager.assignTask(sessionId, workerId, nextTask)
			} else {
				await mailboxManager.shutdownWorker(sessionId, workerId)
				activeWorkerIds.delete(workerId)
				pendingWorkers--
			}
		}
	}

	// ---------------------------------------------------------------------------
	// CLI backend path — workers run as headless morse-worker processes
	// ---------------------------------------------------------------------------

	private async runWithCliBackend(
		params: SpawnSwarmParams,
		task: Task,
		pushToolResult: (result: string) => void,
	): Promise<void> {
		const { workers, task_list, abort_on_failure = false } = params
		const provider = task.providerRef.deref() as SwarmProvider | undefined
		if (!provider) {
			pushToolResult(formatResponse.toolError("Provider reference lost"))
			return
		}

		const sessionId = task.taskId
		const mailboxDir = path.join(os.homedir(), ".roo", "swarm", sessionId)
		const taskQueue = [...task_list]

		// File mailbox — cross-process workers communicate via JSON files.
		provider.mailboxManager.createFileMailbox(sessionId, mailboxDir)

		const cliBackend = getWorkerBackend("cli")
		if (!cliBackend) {
			pushToolResult(formatResponse.toolError("CLI worker backend is not available in this environment"))
			return
		}

		// Spawn all workers.
		for (const worker of workers) {
			await cliBackend.spawn({
				agentId: `${worker.name}@${sessionId}`,
				agentName: worker.name,
				mode: worker.mode,
				sessionId,
				mailboxDir,
			})
		}

		// Send initial tasks (one per worker).
		for (const worker of workers.slice(0, taskQueue.length)) {
			const firstTask = taskQueue.shift()!
			await provider.mailboxManager.assignTask(sessionId, `${worker.name}@${sessionId}`, firstTask)
		}

		// Run coordination loop + wait for all processes to exit.
		await Promise.all([
			this.coordinateTaskQueue(
				provider.mailboxManager,
				sessionId,
				taskQueue,
				Math.min(workers.length, task_list.length),
			),
			cliBackend.waitForAll(),
		])

		provider.mailboxManager.destroyMailbox(sessionId)
		pushToolResult(`[spawn_swarm] All CLI workers completed for session ${sessionId}.`)
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	private formatResults(results: Array<{ taskId: string; summary: string; error?: string }>): string {
		const successes = results.filter((r) => !r.error)
		const failures = results.filter((r) => r.error)

		const lines: string[] = [`[spawn_swarm] ${results.length} tasks completed. Failures: ${failures.length}`]

		for (const r of successes) {
			lines.push(`✓ ${r.taskId}: ${r.summary.slice(0, 120)}${r.summary.length > 120 ? "…" : ""}`)
		}
		for (const r of failures) {
			lines.push(`✗ ${r.taskId}: ${r.error}`)
		}

		return lines.join("\n")
	}

	/**
	 * Streams a partial UI update that shows the expected worker count while the
	 * model is still emitting the tool call parameters.
	 */
	override async handlePartial(task: Task, block: ToolUse<"spawn_swarm">): Promise<void> {
		const workers = block.nativeArgs?.workers
		const count = Array.isArray(workers) ? workers.length : "?"
		await task.say("tool", `Spawning swarm (${count} workers)…`, undefined, block.partial)
	}
}

export const spawnSwarmTool = new SpawnSwarmTool()
