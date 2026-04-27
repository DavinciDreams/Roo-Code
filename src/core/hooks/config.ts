/**
 * Hook Configuration Loader
 *
 * This module handles loading and validating hook configurations from
 * JSON files in the workspace.
 */

import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"
import type { Hook, HookEvent, HooksConfig } from "./types"

/**
 * Schema for validating command hooks
 */
const CommandHookSchema = z.object({
	id: z.string().min(1),
	type: z.literal("command"),
	description: z.string().optional(),
	enabled: z.boolean().optional(),
	timeout: z.number().positive().optional(),
	command: z.string().min(1),
	shell: z.enum(["bash", "powershell", "cmd"]).optional(),
	cwd: z.string().optional(),
	env: z.record(z.string()).optional(),
})

/**
 * Schema for validating HTTP hooks
 */
const HttpHookSchema = z.object({
	id: z.string().min(1),
	type: z.literal("http"),
	description: z.string().optional(),
	enabled: z.boolean().optional(),
	timeout: z.number().positive().optional(),
	url: z.string().url(),
	method: z.enum(["POST", "PUT", "PATCH"]).optional(),
	headers: z.record(z.string()).optional(),
})

/**
 * Schema for validating hooks
 */
const HookSchema: z.ZodDiscriminatedUnion<"type", [typeof CommandHookSchema, typeof HttpHookSchema]> =
	z.discriminatedUnion("type", [CommandHookSchema, HttpHookSchema])

/**
 * Schema for validating hook matchers
 */
const HookMatcherSchema = z.object({
	matcher: z.string().optional(),
	hooks: z.array(HookSchema),
})

/**
 * Schema for validating the entire hooks configuration
 */
const HooksConfigSchema: z.ZodType<HooksConfig> = z.object({
	PreCompact: z.array(HookMatcherSchema).optional(),
	PostCompact: z.array(HookMatcherSchema).optional(),
})

/**
 * Default hooks configuration file name
 */
export const DEFAULT_HOOKS_CONFIG_FILE = ".roo-hooks.json"

/**
 * Result of loading hooks configuration
 */
export interface HooksConfigLoadResult {
	/** The loaded configuration */
	config: HooksConfig
	/** Path to the configuration file */
	configPath: string
	/** Whether the configuration was loaded from a file */
	loadedFromFile: boolean
	/** Error message if loading failed */
	error?: string
}

/**
 * Loads hooks configuration from the workspace
 *
 * @param workspacePath - The workspace root path
 * @param configFileName - Optional custom configuration file name
 * @returns The loaded hooks configuration
 */
export async function loadHooksConfig(workspacePath: string, configFileName?: string): Promise<HooksConfigLoadResult> {
	const configPath = path.join(workspacePath, configFileName || DEFAULT_HOOKS_CONFIG_FILE)

	// Check if configuration file exists
	if (!fs.existsSync(configPath)) {
		return {
			config: {},
			configPath,
			loadedFromFile: false,
		}
	}

	try {
		const fileContent = await fs.promises.readFile(configPath, "utf-8")
		const rawConfig = JSON.parse(fileContent)

		// Validate the configuration
		const validatedConfig = HooksConfigSchema.parse(rawConfig)

		return {
			config: validatedConfig,
			configPath,
			loadedFromFile: true,
		}
	} catch (error) {
		let errorMessage = "Failed to load hooks configuration"

		if (error instanceof z.ZodError) {
			errorMessage = `Invalid hooks configuration: ${error.errors.map((e) => e.message).join(", ")}`
		} else if (error instanceof Error) {
			errorMessage = `Failed to load hooks configuration: ${error.message}`
		}

		// Show error to user
		void vscode.window.showErrorMessage(errorMessage)

		return {
			config: {},
			configPath,
			loadedFromFile: false,
			error: errorMessage,
		}
	}
}

/**
 * Gets hooks for a specific event from the configuration
 *
 * @param config - The hooks configuration
 * @param event - The hook event to get hooks for
 * @param matchQuery - Optional query string to filter hooks
 * @returns Array of hooks that match the event and query
 */
export function getHooksForEvent(config: HooksConfig, event: HookEvent, matchQuery?: string): Hook[] {
	const matchers = config[event]

	if (!matchers || matchers.length === 0) {
		return []
	}

	// Flatten all hooks from all matchers
	const allHooks: Hook[] = []

	for (const matcher of matchers) {
		// If a matcher is specified, check if it matches the query
		if (matcher.matcher && matchQuery) {
			// Simple string matching - can be enhanced with glob patterns if needed
			if (!matchQuery.includes(matcher.matcher)) {
				continue
			}
		}

		// Filter enabled hooks
		const enabledHooks = matcher.hooks.filter((hook) => hook.enabled !== false)

		allHooks.push(...enabledHooks)
	}

	return allHooks
}

/**
 * Validates a hooks configuration object
 *
 * @param config - The configuration to validate
 * @returns Whether the configuration is valid
 */
export function validateHooksConfig(config: unknown): config is HooksConfig {
	try {
		HooksConfigSchema.parse(config)
		return true
	} catch {
		return false
	}
}
