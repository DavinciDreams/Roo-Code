import { CliWorkerBackend } from "./CliWorkerBackend"
import type { IWorkerBackend } from "./IWorkerBackend"

export type WorkerBackendType = "in_process" | "cli"

/**
 * Returns the appropriate worker backend.
 *
 * "in_process" is the default: workers run inside the VS Code extension host
 * via `spawnConcurrentChildren` — no separate binary required.
 *
 * "cli" spawns a headless `moo-worker` child process per worker.
 * Requires the moo-worker binary to be built and on PATH (or in the extension's
 * bin/ directory). Full implementation tracked as post-P6.
 */
export function getWorkerBackend(type: WorkerBackendType): IWorkerBackend {
	switch (type) {
		case "cli":
			return new CliWorkerBackend()
		default:
			throw new Error(
				`[getWorkerBackend] Backend "${type}" cannot be returned as IWorkerBackend. ` +
					`In-process workers are managed directly by spawnConcurrentChildren.`,
			)
	}
}
