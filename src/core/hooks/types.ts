/**
 * Hook Types for Roo Code Extension
 *
 * This module defines the type system for the hook functionality,
 * which allows users to execute custom commands at specific points
 * in the extension's lifecycle (e.g., before/after context condensation).
 */

/**
 * Hook event types that can be triggered in the extension
 */
export type HookEvent = "PreCompact" | "PostCompact"

/**
 * Trigger type for compact hooks
 */
export type CompactTrigger = "manual" | "auto"

/**
 * Base hook configuration
 */
export interface BaseHook {
	/** Unique identifier for this hook */
	id: string
	/** Type of hook (command, http) */
	type: "command" | "http"
	/** Optional description of what this hook does */
	description?: string
	/** Whether this hook is enabled */
	enabled?: boolean
	/** Optional timeout in seconds (default: 60) */
	timeout?: number
}

/**
 * Command hook configuration - executes a shell command
 */
export interface CommandHook extends BaseHook {
	type: "command"
	/** Shell command to execute */
	command: string
	/** Shell interpreter to use (bash, powershell, cmd) */
	shell?: "bash" | "powershell" | "cmd"
	/** Working directory for the command (default: project root) */
	cwd?: string
	/** Environment variables to pass to the command */
	env?: Record<string, string>
}

/**
 * HTTP hook configuration - sends an HTTP POST request
 */
export interface HttpHook extends BaseHook {
	type: "http"
	/** URL to POST the hook data to */
	url: string
	/** HTTP method (default: POST) */
	method?: "POST" | "PUT" | "PATCH"
	/** Additional headers to include in the request */
	headers?: Record<string, string>
}

/**
 * Union type for all hook configurations
 */
export type Hook = CommandHook | HttpHook

/**
 * Hook matcher configuration - allows filtering when hooks run
 */
export interface HookMatcher {
	/** Optional pattern to match (e.g., trigger type) */
	matcher?: string
	/** List of hooks to execute when the matcher matches */
	hooks: Hook[]
}

/**
 * Hooks configuration - maps hook events to their matchers
 */
export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>

/**
 * Input data passed to PreCompact hooks
 */
export interface PreCompactHookInput {
	/** Hook event name */
	hook_event_name: "PreCompact"
	/** Trigger type (manual or auto) */
	trigger: CompactTrigger
	/** Custom instructions for condensation (if any) */
	custom_instructions: string | null
	/** Current working directory */
	cwd: string
	/** Task ID */
	taskId: string
}

/**
 * Input data passed to PostCompact hooks
 */
export interface PostCompactHookInput {
	/** Hook event name */
	hook_event_name: "PostCompact"
	/** Trigger type (manual or auto) */
	trigger: CompactTrigger
	/** The generated summary from condensation */
	compact_summary: string
	/** Number of tokens before condensation */
	prev_tokens: number
	/** Number of tokens after condensation */
	new_tokens: number
	/** Current working directory */
	cwd: string
	/** Task ID */
	taskId: string
}

/**
 * Union type for all hook inputs
 */
export type HookInput = PreCompactHookInput | PostCompactHookInput

/**
 * Result of executing a single hook
 */
export interface HookExecutionResult {
	/** The hook that was executed */
	hook: Hook
	/** Whether the hook executed successfully */
	succeeded: boolean
	/** Output from the hook (stdout for commands, response body for HTTP) */
	output: string
	/** Error message if the hook failed */
	error?: string
	/** Execution time in milliseconds */
	duration: number
}

/**
 * Result of executing hooks for an event
 */
export interface HookExecutionSummary {
	/** Event name */
	event: HookEvent
	/** All hook execution results */
	results: HookExecutionResult[]
	/** Whether any hook failed */
	hasFailures: boolean
	/** Total execution time in milliseconds */
	totalDuration: number
	/** User-facing message summarizing the results */
	userMessage?: string
}

/**
 * Options for executing hooks
 */
export interface HookExecutionOptions {
	/** Abort signal to cancel hook execution */
	signal?: AbortSignal
	/** Working directory for command hooks */
	cwd?: string
	/** Task ID for tracking */
	taskId?: string
}
