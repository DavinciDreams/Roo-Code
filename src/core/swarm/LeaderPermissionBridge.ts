import * as vscode from "vscode"
import { randomUUID } from "crypto"

import type { AgentColorName } from "@roo-code/types"

/**
 * A pending tool-approval request from a concurrent worker agent.
 */
export interface WorkerPermissionRequest {
	requestId: string
	workerTaskId: string
	agentName: string
	color: AgentColorName
	/** Canonical tool name (e.g. "write_to_file") */
	toolName: string
	/** Human-readable description shown in the approval dialog */
	description: string
}

type PermissionHandler = (req: WorkerPermissionRequest) => Promise<boolean>

// Module-level singleton — one ClineProvider registers itself; all in-process
// worker tasks can reach it without needing a direct reference.
let activeHandler: PermissionHandler | null = null

/**
 * Called by ClineProvider to register itself as the approval surface.
 * Returns a cleanup function that deregisters the handler on dispose.
 */
export function registerPermissionHandler(handler: PermissionHandler): () => void {
	activeHandler = handler
	return () => {
		if (activeHandler === handler) activeHandler = null
	}
}

/** True when a ClineProvider has registered a handler. */
export function hasPermissionHandler(): boolean {
	return activeHandler !== null
}

/**
 * Called by concurrent workers when they need tool-use approval.
 * Routes the request to the registered leader handler.
 * Returns false (deny) when no handler is registered — safe fail-closed.
 */
export async function submitWorkerPermissionRequest(
	workerTaskId: string,
	agentName: string,
	color: AgentColorName,
	toolName: string,
	description: string,
): Promise<boolean> {
	if (!activeHandler) return false
	const req: WorkerPermissionRequest = {
		requestId: randomUUID(),
		workerTaskId,
		agentName,
		color,
		toolName,
		description,
	}
	return activeHandler(req)
}

/**
 * Default VS Code approval handler used by ClineProvider.
 * Shows a modal dialog with the worker's identity and tool details.
 */
export async function showWorkerPermissionDialog(req: WorkerPermissionRequest): Promise<boolean> {
	const label = `${req.agentName} (${req.color})`
	const detail = req.description.length > 400 ? req.description.slice(0, 400) + "…" : req.description

	const result = await vscode.window.showInformationMessage(
		`Worker approval request from ${label}`,
		{ modal: true, detail: `Tool: ${req.toolName}\n\n${detail}` },
		"Allow",
		"Deny",
	)
	return result === "Allow"
}
