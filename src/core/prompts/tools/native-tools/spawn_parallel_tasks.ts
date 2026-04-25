import type OpenAI from "openai"

const SPAWN_PARALLEL_TASKS_DESCRIPTION = `Spawn multiple subtasks and collect their aggregated results before continuing.

**Execution modes:**
- \`concurrent: false\` (default) — tasks run one at a time; the parent task is suspended until all finish. Lower resource use; good for dependent or quota-sensitive work.
- \`concurrent: true\` — all tasks start simultaneously and run in parallel while the parent stays active. Best for truly independent work where wall-clock time matters.

Use this when you need to split work into independent chunks (e.g., implement N features, analyze N files, run N experiments). When all tasks finish, you receive their aggregated results as a JSON array.

CRITICAL: This tool MUST be called alone. Do NOT call it alongside other tools in the same turn.`

export default {
	type: "function",
	function: {
		name: "spawn_parallel_tasks",
		description: SPAWN_PARALLEL_TASKS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				tasks: {
					type: "array",
					description: "List of tasks to execute. Must contain at least 2 items.",
					items: {
						type: "object",
						properties: {
							mode: {
								type: "string",
								description: "Mode slug for this task (e.g., code, debug, architect)",
							},
							message: {
								type: "string",
								description: "Instructions for this task",
							},
							worktree: {
								type: ["string", "null"],
								description:
									'Optional git worktree isolation. "auto" creates a new branch+worktree, or provide a branch name.',
							},
							todos: {
								type: ["string", "null"],
								description: "Optional markdown checklist of initial todos for this task",
							},
						},
						required: ["mode", "message", "worktree", "todos"],
						additionalProperties: false,
					},
					minItems: 2,
				},
				concurrent: {
					type: ["boolean", "null"],
					description:
						"When true, all tasks run simultaneously (parent stays active). When false or omitted, tasks run sequentially.",
				},
				abortOnChildFailure: {
					type: ["boolean", "null"],
					description:
						"When true and concurrent is also true, abort all remaining sibling tasks as soon as one fails. Has no effect in sequential mode (use the default false to collect all results regardless of failures).",
				},
			},
			required: ["tasks", "concurrent", "abortOnChildFailure"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
