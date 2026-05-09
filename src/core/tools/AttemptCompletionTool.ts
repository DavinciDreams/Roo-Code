import * as vscode from "vscode"

import { RooCodeEventName, type HistoryItem } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"
import type { MailboxManager } from "../swarm/MailboxManager"
import type { SwarmRegistry } from "../swarm/SwarmRegistry"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AttemptCompletionParams {
	result: string
	command?: string
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
		completionPayload?: Record<string, unknown>
		childFailed?: boolean
	}): Promise<void>
	/** Returns the live Task instance if it is still registered (concurrent mode check). */
	getTaskById?(taskId: string): import("../task/Task").Task | undefined
	/** Resolves a concurrent child's completion Promise in the parent's spawnConcurrentChildren call. */
	resolveChildCompletion?(params: {
		childTaskId: string
		summary: string
		payload?: Record<string, unknown>
		failed?: boolean
	}): Promise<void>
	/** SwarmRegistry — used to find which session a task belongs to. */
	swarmRegistry?: SwarmRegistry
	/** MailboxManager — only present when the session was started with persistent:true. */
	mailboxManager?: MailboxManager
	/** EventEmitter — used to emit swarm lifecycle events. */
	emit?(event: string, ...args: unknown[]): boolean
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		const { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			await task.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos = task.todoList && task.todoList.some((todo) => todo.status !== "completed")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion")
				pushToolResult(await task.sayAndCreateMissingParamError("attempt_completion", "result"))
				return
			}

			task.consecutiveMistakeCount = 0

			await task.say("completion_result", result, undefined, false)

			// Check for subtask using parentTaskId (metadata-driven delegation)
			if (task.parentTaskId) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active") {
							// Normal subtask completion - do delegation
							const delegation = await this.delegateToParent(
								task,
								result,
								provider,
								askFinishSubTaskApproval,
								pushToolResult,
							)
							if (delegation === "delegated") {
								this.emitTaskCompleted(task)
							}
							// "reassigned" — worker continues; do NOT emit TaskCompleted
							if (delegation !== "continue") return
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							console.error(
								`[AttemptCompletionTool] Unexpected child task status "${status}" for task ${task.taskId}. ` +
									`Expected "active" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						console.error(
							`[AttemptCompletionTool] Failed to get history for task ${task.taskId}: ${(err as Error)?.message ?? String(err)}. ` +
								`Skipping delegation.`,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			const { response, text, images } = await task.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				this.emitTaskCompleted(task)
				return
			}

			// User provided feedback - push tool result to continue the conversation
			await task.say("user_feedback", text ?? "", images)

			const feedbackText = `<user_message>\n${text}\n</user_message>`
			pushToolResult(formatResponse.toolResult(feedbackText, images))
		} catch (error) {
			await handleError("inspecting site", error as Error)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns:
	 * - "delegated"   completion was approved and parent resumed (or concurrent Promise resolved)
	 * - "reassigned"  worker received a new task_assignment; LLM loop continues without completing
	 * - "denied"      user denied finishing the subtask
	 * - "continue"    caller should fall through to normal completion ask flow
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<"delegated" | "reassigned" | "denied" | "continue"> {
		const didApprove = await askFinishSubTaskApproval()

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return "denied"
		}

		// If the result is valid JSON, pass it as a structured payload alongside the summary.
		let completionPayload: Record<string, unknown> | undefined
		try {
			const parsed = JSON.parse(result)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				completionPayload = parsed as Record<string, unknown>
			}
		} catch {
			// Not JSON — leave completionPayload undefined
		}

		// Concurrent path: if the parent task is still alive in the provider's task map,
		// this child was spawned concurrently — either enter the idle loop (persistent) or
		// resolve its completion Promise immediately.
		const parentIsAlive =
			typeof provider.getTaskById === "function" && provider.getTaskById(task.parentTaskId!) !== undefined
		if (parentIsAlive && typeof provider.resolveChildCompletion === "function") {
			// Idle loop — only for persistent swarm sessions (a mailbox exists for the session).
			const session = provider.swarmRegistry?.getSessionForTask(task.taskId)
			const mailbox = session ? provider.mailboxManager?.getMailbox(session.sessionId) : undefined

			if (session && mailbox) {
				// Notify the leader that this worker is idle.
				await provider.mailboxManager!.notifyIdle(session.sessionId, task.taskId, result, completionPayload)
				provider.emit?.(RooCodeEventName.WorkerIdle, session.sessionId, task.taskId)

				// Wait for leader to either assign a new task or shut us down.
				const nextMsg = await provider.mailboxManager!.waitForNextMessage(session.sessionId, task.taskId, {
					timeoutMs: 300_000, // 5-minute safety timeout
				})

				if (nextMsg?.type === "task_assignment" && typeof nextMsg.payload?.message === "string") {
					// Give worker a new task — do NOT resolve the parent's completion Promise.
					pushToolResult(
						`[Task complete]\n\nNew task assigned by swarm leader:\n\n${nextMsg.payload.message}`,
					)
					return "reassigned"
				}

				// shutdown_request or timeout — fall through to complete normally.
				if (nextMsg?.type === "shutdown_request") {
					provider.emit?.(RooCodeEventName.WorkerShutdown, session.sessionId, task.taskId)
				}
			}

			pushToolResult("")
			await provider.resolveChildCompletion({
				childTaskId: task.taskId,
				summary: result,
				payload: completionPayload,
			})
			return "delegated"
		}

		// Sequential path: parent was disposed; recreate it from history.
		pushToolResult("")
		await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary: result,
			completionPayload,
		})

		return "delegated"
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			} else {
				await task.say("completion_result", result ?? "", undefined, false)
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			}
		} else {
			await task.say("completion_result", result ?? "", undefined, block.partial)
		}
	}

	private emitTaskCompleted(task: Task): void {
		// Force final token usage update before emitting TaskCompleted.
		// This ensures the latest stats are captured regardless of throttle timer.
		task.emitFinalTokenUsageUpdate()

		TelemetryService.instance.captureTaskCompleted(task.taskId)
		task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()
