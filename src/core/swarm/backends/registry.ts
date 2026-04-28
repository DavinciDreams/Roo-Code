import { CliWorkerBackend } from "./CliWorkerBackend"
import type { IWorkerBackend } from "./IWorkerBackend"

export type WorkerBackendType = "in_process" | "cli"

/**
 * Returns the appropriate worker backend.
 *
 * "in_process" is the default: workers run inside the VS Code extension host
 * via `spawnConcurrentChildren` — no separate binary required.
 *
 * "cli" spawns a headless `morse-worker` child process per worker.
 * Requires the morse-worker binary to be built and on PATH (or in the extension's
 * bin/ directory). Full implementation tracked as post-P6.
 */
export function getWorkerBackend(type: WorkerBackendType): IWorkerBackend | null {
	switch (type) {
		case "cli":
			return new CliWorkerBackend()
		case "in_process":
			// In-process workers are managed directly by spawnConcurrentChildren,
			// not through the IWorkerBackend interface.
			return null
		default: {
			const _exhaustive: never = type
			console.warn(`[getWorkerBackend] Unknown backend type: ${_exhaustive}`)
			return null
		}
	}
}
