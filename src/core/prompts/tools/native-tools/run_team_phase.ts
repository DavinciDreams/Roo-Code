import type OpenAI from "openai"

const RUN_TEAM_PHASE_DESCRIPTION = `Run one phase of a pre-configured team workflow defined in .roo/teams/<team_slug>.json.

A team config describes an ordered list of phases (e.g., discovery → execution → review). Each phase runs one or more specialist agents. This tool executes exactly ONE phase and returns its aggregated results.

**Typical orchestrator loop:**
1. Read .roo/teams/<slug>.json (with read_file) to learn the phase names and requireApproval flags.
2. For each phase in order:
   a. If requireApproval is true, call ask_followup_question to get user sign-off.
   b. Call run_team_phase with the phase name, the original task, and accumulated context from prior phases.
3. After the last phase, call attempt_completion with the final summary.

**Execution modes (set in the team config per-phase):**
- concurrent: false (default) — agents in the phase run one at a time; you receive results when all finish.
- concurrent: true — all agents start simultaneously; you receive results when all finish.

Pass prior phase results as JSON in the \`context\` parameter so later phases (e.g., review agents) have full context.

CRITICAL: This tool MUST be called alone. Do NOT call it alongside other tools in the same turn.`

export default {
	type: "function",
	function: {
		name: "run_team_phase",
		description: RUN_TEAM_PHASE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				team_slug: {
					type: "string",
					description:
						'Slug of the team to run (matches the "slug" field in the team config, e.g., "fullstack")',
				},
				phase_name: {
					type: "string",
					description:
						'Name of the phase to execute (matches the "name" field in a phase entry, e.g., "discovery")',
				},
				task: {
					type: "string",
					description:
						"The original user task description. Injected into agent instructions via {{task}}. Pass the same value for every phase.",
				},
				context: {
					type: ["string", "null"],
					description:
						"JSON string of accumulated results from previous phases. Injected into agent instructions via {{context}}. Omit or pass null for the first phase.",
				},
			},
			required: ["team_slug", "phase_name", "task", "context"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
