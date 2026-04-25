#!/usr/bin/env node
/**
 * morse-worker — Headless Morse Code swarm worker process.
 *
 * Launched by CliWorkerBackend with:
 *   node morse-worker.js
 *     --agent-id   <name>@<sessionId>
 *     --session-id <sessionId>
 *     --mode       <mode-slug>
 *     --mailbox-dir <path>          # directory containing FileMailbox JSON files
 *     [--workspace  <path>]
 *     [--model      <model-id>]
 *
 * Protocol (via FileMailbox):
 *   1. Wait for first `task_assignment` message in own inbox.
 *   2. Execute the task by spawning the Morse CLI binary as a child process.
 *   3. Send `idle_notification` to `leader:<sessionId>`.
 *   4. Wait for next `task_assignment` or `shutdown_request`.
 *   5. On `shutdown_request`: exit 0.
 *
 * NOTE: ExtensionHost (the class used by the CLI for headless task execution)
 * depends on vscode-shim and many VS Code API shims that are only safe to
 * initialise once per process. Running it directly inside this worker would
 * also require bundling the entire CLI into the extension. Instead, this
 * worker spawns the Morse CLI binary (`roo`) as a child process per task,
 * passing the workspace, mode, model, and task message as flags. stdout/stderr
 * from the CLI child are captured and the exit code determines success/failure.
 * The collected output becomes the task summary returned to the leader.
 *
 * The CLI binary is resolved as:
 *   1. The `ROO_CLI_BIN` environment variable (useful for test overrides).
 *   2. `roo` on PATH (standard installation via `npm install -g morse-code`).
 */

import path from "path"
import { spawn } from "child_process"

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
	const args: Record<string, string> = {}
	for (let i = 0; i < argv.length - 1; i++) {
		if (argv[i].startsWith("--")) {
			args[argv[i].slice(2)] = argv[i + 1]
			i++
		}
	}
	return args
}

const args = parseArgs(process.argv.slice(2))

const agentId = args["agent-id"]
const sessionId = args["session-id"]
const mode = args["mode"]
const mailboxDir = args["mailbox-dir"]
const workspacePath = args["workspace"] ?? process.cwd()
const model = args["model"] ?? "claude-sonnet-4-6"

if (!agentId || !sessionId || !mode || !mailboxDir) {
	console.error("[morse-worker] Missing required arguments: --agent-id, --session-id, --mode, --mailbox-dir")
	process.exit(1)
}

// ---------------------------------------------------------------------------
// FileMailbox client
// ---------------------------------------------------------------------------

// Resolve the FileMailbox relative to this binary.
// In the bundled build, FileMailbox is compiled into dist/core/swarm/FileMailbox.js
// alongside this worker at dist/workers/morse-worker.js.
const { FileMailbox } = require(path.resolve(__dirname, "..", "core", "swarm", "FileMailbox"))

// ---------------------------------------------------------------------------
// Task execution via Morse CLI child process
// ---------------------------------------------------------------------------

async function executeTaskViaCli(taskMessage: string): Promise<string> {
	const cliBin = process.env.ROO_CLI_BIN ?? "roo"

	const cliArgs = [
		"--mode",
		mode,
		"--model",
		model,
		"--workspace",
		workspacePath,
		"--message",
		taskMessage,
		"--output-format",
		"text",
		"--yes", // non-interactive: auto-approve tool calls
		"--exit-on-done", // exit after task completes
	]

	return new Promise<string>((resolve, reject) => {
		const output: Buffer[] = []

		const child = spawn(cliBin, cliArgs, {
			cwd: workspacePath,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		})

		child.stdout?.on("data", (chunk: Buffer) => output.push(chunk))
		child.stderr?.on("data", (chunk: Buffer) => output.push(chunk))

		child.on("error", (err) => {
			reject(new Error(`[morse-worker] Failed to spawn CLI binary "${cliBin}": ${err.message}`))
		})

		child.on("close", (code) => {
			const combined = Buffer.concat(output).toString("utf8").trim()
			if (code === 0) {
				resolve(combined || `[morse-worker] Task completed (no output)`)
			} else {
				reject(new Error(`[morse-worker] CLI exited with code ${code}: ${combined.slice(0, 500)}`))
			}
		})
	})
}

// ---------------------------------------------------------------------------
// Main worker loop
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
	const mailbox = new FileMailbox(mailboxDir)

	console.log(`[morse-worker] ${agentId} started. mode=${mode} workspace=${workspacePath}`)

	while (true) {
		const msg = await mailbox.waitForMessage(agentId, ["task_assignment", "shutdown_request"], {
			timeoutMs: 300_000, // 5-minute safety timeout
		})

		if (!msg || msg.type === "shutdown_request") {
			console.log(`[morse-worker] ${agentId} shutting down.`)
			break
		}

		const taskMessage = msg.payload?.message as string | undefined
		if (!taskMessage) continue

		console.log(`[morse-worker] ${agentId} received task: ${taskMessage.slice(0, 80)}`)

		let summary: string
		try {
			summary = await executeTaskViaCli(taskMessage)
			console.log(`[morse-worker] ${agentId} task completed successfully.`)
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err)
			console.error(`[morse-worker] ${agentId} task failed: ${errMsg}`)
			summary = `[error] ${errMsg}`
		}

		await mailbox.send(`leader:${sessionId}`, {
			type: "idle_notification",
			from: agentId,
			to: `leader:${sessionId}`,
			payload: { workerId: agentId, summary },
			ts: Date.now(),
		})
	}

	mailbox.dispose()
	process.exit(0)
}

run().catch((err) => {
	console.error(`[morse-worker] Fatal error:`, err)
	process.exit(1)
})
