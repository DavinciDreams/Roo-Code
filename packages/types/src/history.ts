import { z } from "zod"

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(), // Provider profile name for sticky profile feature
	status: z.enum(["active", "completed", "delegated"]).optional(),
	delegatedToId: z.string().optional(), // Last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task
	awaitingChildId: z.string().optional(), // Child currently awaited (set when delegated)
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
	completionPayload: z.record(z.unknown()).optional(), // Structured JSON result from child
	worktreePath: z.string().optional(), // Worktree path if this task ran in an isolated worktree
	parallelQueue: z
		.array(
			z.object({
				mode: z.string(),
				message: z.string(),
				worktree: z.string().optional(),
				todos: z.string().optional(),
				abortOnFailure: z.boolean().optional(), // If true, remaining queue is abandoned when this task fails
			}),
		)
		.optional(), // Remaining tasks for spawn_parallel_tasks fan-out
	parallelResults: z
		.array(
			z.object({
				taskId: z.string(),
				summary: z.string(),
				payload: z.record(z.unknown()).optional(),
				error: z.string().optional(), // Set when the child task failed or was aborted
			}),
		)
		.optional(), // Accumulated results from completed parallel children
	abortOnChildFailure: z.boolean().optional(), // When true, the entire parallel queue is abandoned if any child fails
})

export type HistoryItem = z.infer<typeof historyItemSchema>
