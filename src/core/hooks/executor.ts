/**
 * Hook Executor
 *
 * This module handles the execution of hooks, including command hooks
 * and HTTP hooks.
 */

import { exec } from "child_process"
import { promisify } from "util"
import * as vscode from "vscode"
import type {
	CommandHook,
	HttpHook,
	Hook,
	HookExecutionOptions,
	HookExecutionResult,
	HookExecutionSummary,
	HookEvent,
	HookInput,
} from "./types"

const execAsync = promisify(exec)

let _hooksOutputChannel: vscode.OutputChannel | undefined
function getHooksOutputChannel(): vscode.OutputChannel {
	if (!_hooksOutputChannel) {
		_hooksOutputChannel = vscode.window.createOutputChannel("Roo Code Hooks")
	}
	return _hooksOutputChannel
}

/**
 * Default timeout for hook execution in milliseconds
 */
const DEFAULT_HOOK_TIMEOUT_MS = 60 * 1000 // 60 seconds

/**
 * Executes a command hook
 *
 * @param hook - The command hook to execute
 * @param input - The hook input data
 * @param options - Execution options
 * @returns The execution result
 */
async function executeCommandHook(
	hook: CommandHook,
	input: HookInput,
	options: HookExecutionOptions,
): Promise<HookExecutionResult> {
	const startTime = Date.now()
	const timeout = (hook.timeout || 60) * 1000
	const cwd = hook.cwd || options.cwd || process.cwd()

	// Prepare environment variables
	const env = {
		...process.env,
		...hook.env,
		// Add hook input as environment variables
		HOOK_EVENT: input.hook_event_name,
		HOOK_INPUT: JSON.stringify(input),
	}

	// Determine shell to use
	let shell = hook.shell || "bash"
	let command = hook.command

	// On Windows, default to cmd if no shell specified
	if (process.platform === "win32" && !hook.shell) {
		shell = "cmd"
	}

	// Wrap command for different shells
	if (shell === "powershell") {
		// Escape backslashes first, then double-quotes, to prevent shell injection
		const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
		command = `powershell -Command "${escaped}"`
	} else if (shell === "cmd") {
		// Escape % (variable expansion) and ^ (cmd escape char) to prevent injection
		const escaped = command.replace(/\^/g, "^^").replace(/%/g, "%%")
		command = `cmd /c "${escaped}"`
	}

	try {
		// Execute the command with timeout
		const { stdout, stderr } = await execAsync(command, {
			cwd,
			env,
			timeout,
			windowsHide: true,
		})

		const output = stdout.trim()
		const error = stderr.trim()

		return {
			hook,
			succeeded: true,
			output: output || "",
			error: error || undefined,
			duration: Date.now() - startTime,
		}
	} catch (error) {
		let errorMessage = "Unknown error"
		if (error instanceof Error) {
			errorMessage = error.message
			// Check if it was a timeout
			if (error.message.includes("timed out")) {
				errorMessage = `Command timed out after ${timeout}ms`
			}
		}

		return {
			hook,
			succeeded: false,
			output: "",
			error: errorMessage,
			duration: Date.now() - startTime,
		}
	}
}

/**
 * Executes an HTTP hook
 *
 * @param hook - The HTTP hook to execute
 * @param input - The hook input data
 * @param options - Execution options
 * @returns The execution result
 */
async function executeHttpHook(
	hook: HttpHook,
	input: HookInput,
	options: HookExecutionOptions,
): Promise<HookExecutionResult> {
	const startTime = Date.now()
	const timeout = (hook.timeout || 60) * 1000

	try {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeout)

		// Combine options signal with timeout signal
		if (options.signal) {
			options.signal.addEventListener("abort", () => controller.abort())
		}

		const response = await fetch(hook.url, {
			method: hook.method || "POST",
			headers: {
				"Content-Type": "application/json",
				...hook.headers,
			},
			body: JSON.stringify(input),
			signal: controller.signal,
		})

		clearTimeout(timeoutId)

		const responseText = await response.text()

		if (!response.ok) {
			return {
				hook,
				succeeded: false,
				output: responseText,
				error: `HTTP ${response.status}: ${response.statusText}`,
				duration: Date.now() - startTime,
			}
		}

		return {
			hook,
			succeeded: true,
			output: responseText,
			duration: Date.now() - startTime,
		}
	} catch (error) {
		let errorMessage = "Unknown error"
		if (error instanceof Error) {
			errorMessage = error.message
			if (error.name === "AbortError") {
				errorMessage = `HTTP request timed out after ${timeout}ms`
			}
		}

		return {
			hook,
			succeeded: false,
			output: "",
			error: errorMessage,
			duration: Date.now() - startTime,
		}
	}
}

/**
 * Executes a single hook
 *
 * @param hook - The hook to execute
 * @param input - The hook input data
 * @param options - Execution options
 * @returns The execution result
 */
export async function executeHook(
	hook: Hook,
	input: HookInput,
	options: HookExecutionOptions = {},
): Promise<HookExecutionResult> {
	// Check for abort signal
	if (options.signal?.aborted) {
		return {
			hook,
			succeeded: false,
			output: "",
			error: "Hook execution aborted",
			duration: 0,
		}
	}

	// Execute based on hook type
	if (hook.type === "command") {
		return executeCommandHook(hook, input, options)
	} else if (hook.type === "http") {
		return executeHttpHook(hook, input, options)
	}

	// This should never happen due to type checking
	return {
		hook,
		succeeded: false,
		output: "",
		error: `Unknown hook type: ${(hook as Hook).type}`,
		duration: 0,
	}
}

/**
 * Executes multiple hooks for an event
 *
 * @param event - The hook event
 * @param hooks - The hooks to execute
 * @param input - The hook input data
 * @param options - Execution options
 * @returns The execution summary
 */
export async function executeHooks(
	event: HookEvent,
	hooks: Hook[],
	input: HookInput,
	options: HookExecutionOptions = {},
): Promise<HookExecutionSummary> {
	const startTime = Date.now()

	// Execute all hooks in parallel
	const results = await Promise.all(hooks.map((hook) => executeHook(hook, input, options)))

	// Check for failures
	const hasFailures = results.some((result) => !result.succeeded)

	// Build user message
	const messages: string[] = []
	for (const result of results) {
		const hookType = result.hook.type === "command" ? "command" : "http"
		const hookName = result.hook.description || result.hook.id

		if (result.succeeded) {
			if (result.output) {
				messages.push(`${event} [${hookName}] completed successfully: ${result.output}`)
			} else {
				messages.push(`${event} [${hookName}] completed successfully`)
			}
		} else {
			if (result.error) {
				messages.push(`${event} [${hookName}] failed: ${result.error}`)
			} else {
				messages.push(`${event} [${hookName}] failed`)
			}
		}
	}

	if (messages.length > 0) {
		const ch = getHooksOutputChannel()
		ch.appendLine(`[${new Date().toISOString()}] ${event} hooks executed`)
		ch.appendLine(messages.join("\n"))
		ch.appendLine("---")
	}

	return {
		event,
		results,
		hasFailures,
		totalDuration: Date.now() - startTime,
		userMessage: messages.length > 0 ? messages.join("\n") : undefined,
	}
}
