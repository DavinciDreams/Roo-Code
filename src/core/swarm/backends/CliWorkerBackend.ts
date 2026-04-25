import { spawn, type ChildProcess } from "child_process"
import path from "path"

import type { IWorkerBackend, WorkerSpawnConfig, WorkerSpawnResult } from "./IWorkerBackend"

/**
 * Spawns each swarm worker as a headless `moo-worker` child process.
 *
 * The binary communicates via FileMailbox (JSON files in `mailboxDir`),
 * so no VS Code APIs are required in the worker process.
 *
 * NOTE: The `moo-worker` binary (src/bin/moo-worker.ts) is a skeleton.
 * Full headless task execution requires extracting `Task` from VS Code
 * dependencies — tracked as a follow-up after P6.
 */
export class CliWorkerBackend implements IWorkerBackend {
	readonly name = "cli"

	private processes = new Map<string, ChildProcess>()
	private exitPromises = new Map<string, Promise<void>>()

	async spawn(config: WorkerSpawnConfig): Promise<WorkerSpawnResult> {
		// In the bundled extension (dist/extension.js), __dirname = dist/.
		// Workers are compiled to dist/workers/ alongside the main bundle.
		const binPath = config.workerBinPath ?? path.resolve(__dirname, "workers", "moo-worker.js")

		const args = [
			binPath,
			"--agent-id",
			config.agentId,
			"--session-id",
			config.sessionId,
			"--mode",
			config.mode,
			"--mailbox-dir",
			config.mailboxDir,
		]

		if (config.workspacePath) args.push("--workspace", config.workspacePath)
		if (config.model) args.push("--model", config.model)

		const child = spawn(process.execPath, args, {
			cwd: config.workspacePath,
			stdio: "inherit",
		})

		this.processes.set(config.agentId, child)

		const exitPromise = new Promise<void>((resolve) => {
			child.on("exit", () => {
				this.processes.delete(config.agentId)
				resolve()
			})
		})
		this.exitPromises.set(config.agentId, exitPromise)

		return { agentId: config.agentId, pid: child.pid }
	}

	async terminate(agentId: string): Promise<void> {
		const child = this.processes.get(agentId)
		if (child) child.kill("SIGTERM")
	}

	async isActive(agentId: string): Promise<boolean> {
		return this.processes.has(agentId)
	}

	async waitForAll(): Promise<void> {
		await Promise.all(Array.from(this.exitPromises.values()))
	}
}
