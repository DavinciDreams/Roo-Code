/**
 * Hook System for Roo Code Extension
 *
 * This module provides a hook system that allows users to execute custom
 * commands at specific points in the extension's lifecycle, such as before
 * and after context condensation.
 *
 * Features:
 * - Command hooks: Execute shell commands
 * - HTTP hooks: Send HTTP POST requests
 * - Configuration via JSON file in workspace
 * - Async execution with timeout support
 * - Graceful error handling
 */

import type {
	CompactTrigger,
	HookExecutionOptions,
	HooksConfig,
	PreCompactHookInput,
	PostCompactHookInput,
} from "./types"
import { loadHooksConfig, getHooksForEvent, DEFAULT_HOOKS_CONFIG_FILE } from "./config"
import { executeHooks } from "./executor"

// Re-export types and utilities
export * from "./types"
export { loadHooksConfig, getHooksForEvent, DEFAULT_HOOKS_CONFIG_FILE } from "./config"
export { executeHooks, executeHook } from "./executor"

/**
 * Hook system configuration
 */
export interface HookSystemConfig {
	/** Whether hooks are enabled */
	enabled: boolean
	/** Path to hooks configuration file */
	configPath?: string
	/** Workspace root path */
	workspacePath: string
}

/**
 * Result of executing pre-compact hooks
 */
export interface PreCompactHookResult {
	/** New custom instructions from hooks */
	newCustomInstructions?: string
	/** User-facing message */
	userMessage?: string
	/** Whether any hook failed */
	hasFailures: boolean
}

/**
 * Result of executing post-compact hooks
 */
export interface PostCompactHookResult {
	/** User-facing message */
	userMessage?: string
	/** Whether any hook failed */
	hasFailures: boolean
}

/**
 * Hook system class that manages hook execution
 */
export class HookSystem {
	private config: HookSystemConfig

	constructor(config: HookSystemConfig) {
		this.config = config
	}

	/**
	 * Updates the hook system configuration
	 */
	updateConfig(config: Partial<HookSystemConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Checks if hooks are enabled
	 */
	isEnabled(): boolean {
		return this.config.enabled
	}

	/**
	 * Loads hooks configuration fresh from disk on each call so that
	 * changes to .roo-hooks.json are always picked up without a reload.
	 */
	private async loadConfig(): Promise<HooksConfig> {
		const result = await loadHooksConfig(this.config.workspacePath, this.config.configPath)
		return result.config
	}

	/**
	 * Executes pre-compact hooks
	 */
	async executePreCompactHooks(
		trigger: CompactTrigger,
		customInstructions: string | null,
		options: HookExecutionOptions = {},
	): Promise<PreCompactHookResult> {
		if (!this.isEnabled()) {
			return { hasFailures: false }
		}

		const config = await this.loadConfig()
		const hooks = getHooksForEvent(config, "PreCompact", trigger)

		if (hooks.length === 0) {
			return { hasFailures: false }
		}

		const input: PreCompactHookInput = {
			hook_event_name: "PreCompact",
			trigger,
			custom_instructions: customInstructions,
			cwd: options.cwd || this.config.workspacePath,
			taskId: options.taskId || "",
		}

		const summary = await executeHooks("PreCompact", hooks, input, options)

		const successfulOutputs = summary.results
			.filter((result) => result.succeeded && result.output.trim().length > 0)
			.map((result) => result.output.trim())

		return {
			newCustomInstructions: successfulOutputs.length > 0 ? successfulOutputs.join("\n\n") : undefined,
			userMessage: summary.userMessage,
			hasFailures: summary.hasFailures,
		}
	}

	/**
	 * Executes post-compact hooks
	 */
	async executePostCompactHooks(
		trigger: CompactTrigger,
		compactSummary: string,
		prevTokens: number,
		newTokens: number,
		options: HookExecutionOptions = {},
	): Promise<PostCompactHookResult> {
		if (!this.isEnabled()) {
			return { hasFailures: false }
		}

		const config = await this.loadConfig()
		const hooks = getHooksForEvent(config, "PostCompact", trigger)

		if (hooks.length === 0) {
			return { hasFailures: false }
		}

		const input: PostCompactHookInput = {
			hook_event_name: "PostCompact",
			trigger,
			compact_summary: compactSummary,
			prev_tokens: prevTokens,
			new_tokens: newTokens,
			cwd: options.cwd || this.config.workspacePath,
			taskId: options.taskId || "",
		}

		const summary = await executeHooks("PostCompact", hooks, input, options)

		return {
			userMessage: summary.userMessage,
			hasFailures: summary.hasFailures,
		}
	}
}

/**
 * Creates a new hook system instance
 */
export function createHookSystem(workspacePath: string, enabled: boolean = true, configPath?: string): HookSystem {
	return new HookSystem({ enabled, workspacePath, configPath })
}
