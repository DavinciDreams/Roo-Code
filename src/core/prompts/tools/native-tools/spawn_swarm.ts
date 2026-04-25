import type OpenAI from "openai"

const SPAWN_SWARM_DESCRIPTION = `Create a pool of persistent AI workers that collectively pull tasks from a shared queue.

Unlike run_team_phase (which pushes one task per agent per phase), spawn_swarm lets N workers process M tasks where M >> N. Workers stay alive between tasks and pull the next item as soon as they finish the current one.

**When to use spawn_swarm vs run_team_phase:**
- spawn_swarm: many similar tasks (file-by-file analysis, parallel test writing, batch refactors)
- run_team_phase: structured pipeline with distinct phases (discovery → coding → review)

**How it works:**
1. N workers are spawned, each receiving its first task immediately.
2. When a worker finishes, it notifies the leader; the leader dispatches the next queued task.
3. When the queue is empty, idle workers are shut down gracefully.
4. Returns a summary of all task results when the last worker exits.

**Backend options:**
- "in_process" (default): workers run inside VS Code — zero overhead, same extension context
- "cli": workers run as separate morse-worker processes — full OS isolation, requires binary

CRITICAL: This tool MUST be called alone. Do NOT call it alongside other tools in the same turn.`

export default {
	type: "function",
	function: {
		name: "spawn_swarm",
		description: SPAWN_SWARM_DESCRIPTION,
		strict: false,
		parameters: {
			type: "object",
			properties: {
				workers: {
					type: "array",
					description: "The worker pool. Each entry defines one persistent worker. Workers run concurrently.",
					items: {
						type: "object",
						properties: {
							name: {
								type: "string",
								description: 'Human-readable worker name shown in the UI (e.g. "analyst", "coder-1")',
							},
							mode: {
								type: "string",
								description: 'Roo-Code mode slug the worker will run in (e.g. "code", "architect")',
							},
							color: {
								type: "string",
								description:
									"Optional display color. One of: red, blue, green, yellow, purple, orange, pink, cyan",
							},
						},
						required: ["name", "mode"],
						additionalProperties: false,
					},
					minItems: 1,
				},
				task_list: {
					type: "array",
					description:
						"Ordered list of task descriptions. Workers pull from this queue in order. Can be longer than the worker count.",
					items: { type: "string" },
					minItems: 1,
				},
				abort_on_failure: {
					type: "boolean",
					description:
						"If true, stop all workers and return immediately when any single task fails. Default: false.",
				},
				backend: {
					type: "string",
					enum: ["in_process", "cli"],
					description:
						'"in_process" (default): workers run inside VS Code. "cli": spawns headless morse-worker processes.',
				},
			},
			required: ["workers", "task_list"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
