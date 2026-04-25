import { TodoItem } from "@roo-code/types"

import { Task } from "../task/Task"
import { getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { parseMarkdownChecklist } from "./UpdateTodoListTool"

interface ParallelTaskSpec {
	mode: string
	message: string
	worktree?: string
	todos?: string
}

interface SpawnParallelTasksParams {
	tasks: ParallelTaskSpec[]
	/** When true, the entire queue is abandoned if any child task fails or is aborted. Default: false (continue on failure). */
	abortOnChildFailure?: boolean
	/**
	 * When true, all child tasks run concurrently (parent stays alive; JS cooperative multitasking).
	 * When false (default), tasks run sequentially via the parallel queue drain mechanism.
	 */
	concurrent?: boolean
}

export class SpawnParallelTasksTool extends BaseTool<"spawn_parallel_tasks"> {
	readonly name = "spawn_parallel_tasks" as const

	async execute(params: SpawnParallelTasksParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { tasks, abortOnChildFailure = false, concurrent = false } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!tasks || tasks.length < 2) {
				task.consecutiveMistakeCount++
				task.recordToolError("spawn_parallel_tasks")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("spawn_parallel_tasks requires at least 2 tasks"))
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const state = await provider.getState()

			// Validate all modes up front before asking approval
			for (const spec of tasks) {
				if (!spec.mode) {
					pushToolResult(formatResponse.toolError(`Each task must have a mode`))
					return
				}
				if (!spec.message) {
					pushToolResult(formatResponse.toolError(`Each task must have a message`))
					return
				}
				const targetMode = getModeBySlug(spec.mode, state?.customModes)
				if (!targetMode) {
					pushToolResult(formatResponse.toolError(`Invalid mode: ${spec.mode}`))
					return
				}
			}

			// Parse todos for all tasks
			const parsedTasks: Array<{ spec: ParallelTaskSpec; todoItems: TodoItem[] }> = []
			for (const spec of tasks) {
				let todoItems: TodoItem[] = []
				if (spec.todos) {
					try {
						todoItems = parseMarkdownChecklist(spec.todos)
					} catch {
						pushToolResult(
							formatResponse.toolError(`Invalid todos format in task "${spec.message.slice(0, 40)}..."`),
						)
						return
					}
				}
				parsedTasks.push({ spec, todoItems })
			}

			const toolMessage = JSON.stringify({
				tool: "spawnParallelTasks",
				taskCount: tasks.length,
				tasks: tasks.map((t) => ({ mode: t.mode, message: t.message.slice(0, 100) })),
			})

			const didApprove = await askApproval("tool", toolMessage)
			if (!didApprove) return

			task.consecutiveMistakeCount = 0

			if (concurrent) {
				// Concurrent path: all children run simultaneously; parent stays alive.
				// spawnConcurrentChildren awaits all completions and returns aggregated results.
				const results = await (provider as any).spawnConcurrentChildren({
					parentTaskId: task.taskId,
					tasks: parsedTasks.map((t) => ({
						mode: t.spec.mode,
						message: t.spec.message,
						worktree: t.spec.worktree || undefined,
						todos: t.todoItems,
					})),
					abortOnChildFailure,
				})
				pushToolResult(JSON.stringify(results, null, 2))
			} else {
				// Sequential fan-out: first task starts immediately; the rest are queued in the
				// parent's history. reopenParentFromDelegation drains the queue, starting each
				// child in turn, and resumes the parent with aggregated results when empty.
				const [first, ...rest] = parsedTasks

				await (provider as any).delegateParentAndOpenChild({
					parentTaskId: task.taskId,
					message: first.spec.message,
					initialTodos: first.todoItems,
					mode: first.spec.mode,
					worktree: first.spec.worktree || undefined,
					abortOnChildFailure,
					parallelQueue: rest.map((t) => ({
						mode: t.spec.mode,
						message: t.spec.message,
						worktree: t.spec.worktree || undefined,
						todos: t.spec.todos || undefined,
					})),
				})

				pushToolResult(`Spawned ${tasks.length} sequential tasks. Awaiting all results...`)
			}
		} catch (error) {
			await handleError("spawning parallel tasks", error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"spawn_parallel_tasks">): Promise<void> {
		const partialMessage = JSON.stringify({ tool: "spawnParallelTasks" })
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const spawnParallelTasksTool = new SpawnParallelTasksTool()
