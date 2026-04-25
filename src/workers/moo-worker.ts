#!/usr/bin/env node
/**
 * moo-worker — Headless Moo Code swarm worker process.
 *
 * Launched by CliWorkerBackend with:
 *   node moo-worker.js
 *     --agent-id   <name>@<sessionId>
 *     --session-id <sessionId>
 *     --mode       <mode-slug>
 *     --mailbox-dir <path>          # directory containing FileMailbox JSON files
 *     [--workspace  <path>]
 *     [--model      <model-id>]
 *
 * Protocol (via FileMailbox):
 *   1. Wait for first `task_assignment` message in own inbox.
 *   2. Execute the task (see TODO below).
 *   3. Send `idle_notification` to `leader:<sessionId>`.
 *   4. Wait for next `task_assignment` or `shutdown_request`.
 *   5. On `shutdown_request`: exit 0.
 *
 * TODO: Full headless execution requires extracting `Task` from VS Code
 * dependencies. The current `Task` class depends on `ClineProvider` which
 * wraps many VS Code APIs (webview, storage, output channels). Completing
 * this requires either:
 *   a) A VS Code-agnostic `HeadlessTask` that calls the Anthropic API directly, or
 *   b) Launching a new VS Code window pre-loaded with the extension (VsCodeWindowBackend).
 *
 * This file documents the contract so the protocol is correct from day one.
 */

import path from "path"

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
	console.error("[moo-worker] Missing required arguments: --agent-id, --session-id, --mode, --mailbox-dir")
	process.exit(1)
}

// ---------------------------------------------------------------------------
// FileMailbox client (reuse the compiled FileMailbox if available, otherwise
// inline a minimal implementation for the skeleton)
// ---------------------------------------------------------------------------

// Resolve the FileMailbox relative to this binary.
// In a real build this import will resolve correctly; for the skeleton we
// dynamically require it so the file can be compiled standalone.
const { FileMailbox } = require(path.resolve(__dirname, "..", "core", "swarm", "FileMailbox"))

// ---------------------------------------------------------------------------
// Main worker loop
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
	const mailbox = new FileMailbox(mailboxDir)

	console.log(`[moo-worker] ${agentId} started. mode=${mode} workspace=${workspacePath}`)

	while (true) {
		// Wait for next task assignment or shutdown.
		const msg = await mailbox.waitForMessage(agentId, ["task_assignment", "shutdown_request"], {
			timeoutMs: 300_000, // 5-minute safety timeout
		})

		if (!msg || msg.type === "shutdown_request") {
			console.log(`[moo-worker] ${agentId} shutting down.`)
			break
		}

		const taskMessage = msg.payload?.message as string | undefined
		if (!taskMessage) continue

		console.log(`[moo-worker] ${agentId} received task: ${taskMessage.slice(0, 80)}`)

		// TODO: Execute the task using a headless Task runner.
		// This requires VS Code-agnostic LLM loop — see file header for details.
		const summary = `[stub] ${agentId} processed: ${taskMessage.slice(0, 60)}`

		// Notify leader that this worker is idle.
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
	console.error(`[moo-worker] Fatal error:`, err)
	process.exit(1)
})
