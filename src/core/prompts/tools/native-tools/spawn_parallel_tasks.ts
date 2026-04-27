import type OpenAI from "openai"

const SPAWN_PARALLEL_TASKS_DESCRIPTION = `Spawn multiple subtasks that execute sequentially and whose results are aggregated before returning to you.

Use this when you need to split work into independent chunks (e.g., implement N features, analyze N files, run N experiments) and collect all results before proceeding. Each task runs to completion before the next starts. When all tasks finish, you receive their aggregated results as a JSON array.

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
			},
			required: ["tasks"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
