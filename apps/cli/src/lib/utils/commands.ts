/**
 * CLI-specific global slash commands
 *
 * These commands are handled entirely within the CLI and trigger actions
 * by sending messages to the extension host. They are separate from the
 * extension's built-in commands which expand into prompt content.
 */

/**
 * Action types that can be triggered by global commands.
 *
 * Extension actions  — forwarded to the extension host via sendToExtension.
 * Informational      — handled locally in the CLI layer (display data from store).
 */
export type GlobalCommandAction =
	// Extension-side actions
	| "clearTask"
	| "setMode"
	// CLI-local informational actions
	| "showHelp"
	| "showCost"
	| "showModel"
	| "showMode"
	| "showSessions"

/**
 * Definition of a CLI global command
 */
export interface GlobalCommand {
	/** Command name (without the leading /) */
	name: string
	/** Description shown in the autocomplete picker */
	description: string
	/** Action to trigger when the command is executed */
	action: GlobalCommandAction
	/** Whether this command accepts an optional argument (shown in autocomplete) */
	argumentHint?: string
}

/**
 * CLI-specific global slash commands
 * These commands trigger actions rather than expanding into prompt content.
 */
export const GLOBAL_COMMANDS: GlobalCommand[] = [
	{
		name: "new",
		description: "Start a new task (clears conversation)",
		action: "clearTask",
	},
	{
		name: "clear",
		description: "Clear the current task and start fresh",
		action: "clearTask",
	},
	{
		name: "help",
		description: "Show available CLI commands",
		action: "showHelp",
	},
	{
		name: "cost",
		description: "Show token usage and cost for this session",
		action: "showCost",
	},
	{
		name: "model",
		description: "Show the current model",
		action: "showModel",
	},
	{
		name: "mode",
		description: "Show the current mode, or switch to a different mode",
		action: "showMode",
		argumentHint: "[slug]",
	},
	{
		name: "sessions",
		description: "List recent task sessions",
		action: "showSessions",
	},
]

/**
 * Get a global command by name
 */
export function getGlobalCommand(name: string): GlobalCommand | undefined {
	return GLOBAL_COMMANDS.find((cmd) => cmd.name === name)
}

/**
 * Get global commands formatted for autocomplete
 * Returns commands in the SlashCommandResult format expected by the autocomplete trigger
 */
export function getGlobalCommandsForAutocomplete(): Array<{
	name: string
	description?: string
	argumentHint?: string
	source: "global" | "project" | "built-in"
	action?: string
}> {
	return GLOBAL_COMMANDS.map((cmd) => ({
		name: cmd.name,
		description: cmd.description,
		argumentHint: cmd.argumentHint,
		source: "global" as const,
		action: cmd.action,
	}))
}
