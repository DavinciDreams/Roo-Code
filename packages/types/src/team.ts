/**
 * Team configuration — defines a named, phased multi-agent workflow.
 * Team configs live in .roo/teams/<slug>.json inside the workspace.
 */

export interface TeamAgentSpec {
	/** Mode slug for this agent (e.g., "code", "architect") */
	mode: string
	/** Role label shown in results (e.g., "frontend", "explorer"). Optional, for readability. */
	role?: string
	/**
	 * Instruction template for this agent.
	 * Supports: {{task}}, {{context}}, {{phase}}, {{team}}
	 */
	instruction: string
	/**
	 * Optional git worktree isolation.
	 * "auto" creates a new branch+worktree; any other string is used as the branch name.
	 */
	worktree?: string
}

export interface TeamPhase {
	/** Phase identifier used when calling run_team_phase (e.g., "discovery", "execution") */
	name: string
	/** Human-readable label for UI display. Defaults to name if omitted. */
	label?: string
	/** When true, all agents in this phase run concurrently. Default: false (sequential). */
	concurrent?: boolean
	/**
	 * When true, the orchestrator should ask for user approval before this phase starts.
	 * The run_team_phase tool itself does not enforce this — it is a signal for the
	 * orchestrator mode to call ask_followup_question first.
	 */
	requireApproval?: boolean
	/**
	 * When true and concurrent is also true, abort all remaining sibling agents as soon as
	 * one fails. Has no effect in sequential mode.
	 */
	abortOnChildFailure?: boolean
	/** Agents to run in this phase. Must contain at least one entry. */
	agents: TeamAgentSpec[]
}

export interface TeamConfig {
	/** Auto-populated with the source file path at load time. Not set by user. */
	$source?: string
	/** Unique identifier used in tool calls and skill registration (e.g., "fullstack"). */
	slug: string
	/** Human-readable team name (e.g., "Full-Stack Dev Team"). */
	name: string
	/** Short description of what this team does. Shown in team listings. */
	description?: string
	/** Ordered list of phases. The orchestrator runs them in this order. */
	phases: TeamPhase[]
	/**
	 * Path to a Markdown file containing shared conventions for all agents.
	 * Relative to the workspace root. Content is injected into every agent's message
	 * inside a <team_conventions> block.
	 */
	conventions?: string
	/**
	 * Mode slug for the orchestrating task. Defaults to "architect".
	 * This is informational — the skill / invocation mechanism uses it to set the initial mode.
	 */
	orchestratorMode?: string
}
