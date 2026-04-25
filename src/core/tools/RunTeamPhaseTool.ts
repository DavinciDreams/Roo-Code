import * as fs from "fs/promises"
import * as path from "path"

import type { TeamConfig } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, ToolCallbacks } from "./BaseTool"

interface RunTeamPhaseParams {
	team_slug: string
	phase_name: string
	task: string
	context?: string | null
}

/**
 * Minimal provider surface needed by RunTeamPhaseTool.
 * Cast from providerRef.deref() using `provider as TeamPhaseProvider`.
 */
interface TeamPhaseProvider {
	getTeamConfig(slug: string): TeamConfig | undefined
	delegateParentAndOpenChild(params: {
		parentTaskId: string
		message: string
		initialTodos: []
		mode: string
		worktree?: string
		parallelQueue?: Array<{ mode: string; message: string; worktree?: string }>
	}): Promise<Task>
	spawnConcurrentChildren(params: {
		parentTaskId: string
		tasks: Array<{ mode: string; message: string; worktree?: string; role?: string }>
		abortOnChildFailure?: boolean
	}): Promise<Array<{ taskId: string; summary: string; error?: string }>>
}

export class RunTeamPhaseTool extends BaseTool<"run_team_phase"> {
	readonly name = "run_team_phase" as const

	async execute(params: RunTeamPhaseParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { team_slug, phase_name, task: taskDesc, context } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			const provider = task.providerRef.deref() as TeamPhaseProvider | undefined
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			// 1) Look up team config
			const teamConfig = provider.getTeamConfig(team_slug)
			if (!teamConfig) {
				pushToolResult(
					formatResponse.toolError(
						`Team "${team_slug}" not found. Make sure .roo/teams/${team_slug}.json exists in the workspace.`,
					),
				)
				return
			}

			// 2) Find the phase
			const phase = teamConfig.phases.find((p) => p.name === phase_name)
			if (!phase) {
				const available = teamConfig.phases.map((p) => p.name).join(", ")
				pushToolResult(
					formatResponse.toolError(
						`Phase "${phase_name}" not found in team "${team_slug}". Available phases: ${available}`,
					),
				)
				return
			}

			if (!phase.agents || phase.agents.length === 0) {
				pushToolResult(formatResponse.toolError(`Phase "${phase_name}" has no agents defined.`))
				return
			}

			// 3) Load shared conventions (non-fatal if missing)
			let conventionsPrefix = ""
			if (teamConfig.conventions) {
				try {
					const conventionsPath = path.resolve(task.workspacePath, teamConfig.conventions)
					const content = await fs.readFile(conventionsPath, "utf-8")
					if (content.trim()) {
						conventionsPrefix = `<team_conventions>\n${content.trim()}\n</team_conventions>\n\n`
					}
				} catch {
					// Conventions file not found — proceed without it
				}
			}

			// 4) Interpolate {{task}}, {{context}}, {{phase}}, {{team}} in instructions
			const interpolate = (template: string) =>
				template
					.replace(/\{\{task\}\}/g, taskDesc)
					.replace(/\{\{context\}\}/g, context ?? "")
					.replace(/\{\{phase\}\}/g, phase_name)
					.replace(/\{\{team\}\}/g, teamConfig.name)

			const agentSpecs = phase.agents.map((agent) => ({
				mode: agent.mode,
				role: agent.role,
				message: conventionsPrefix + interpolate(agent.instruction),
				worktree: agent.worktree,
			}))

			// 5) Ask approval
			const toolMessage = JSON.stringify({
				tool: "runTeamPhase",
				team: teamConfig.name,
				phase: phase.label ?? phase_name,
				agentCount: agentSpecs.length,
				concurrent: phase.concurrent ?? false,
				agents: agentSpecs.map((s) => ({ role: s.role ?? s.mode, mode: s.mode })),
			})

			const didApprove = await askApproval("tool", toolMessage)
			if (!didApprove) return

			task.consecutiveMistakeCount = 0

			// 6) Execute the phase
			if (phase.concurrent) {
				// Concurrent: all agents start simultaneously; parent stays alive.
				const results = await provider.spawnConcurrentChildren({
					parentTaskId: task.taskId,
					tasks: agentSpecs.map(({ mode, message, worktree, role }) => ({ mode, message, worktree, role })),
					abortOnChildFailure: phase.abortOnChildFailure ?? false,
				})
				pushToolResult(JSON.stringify(results, null, 2))
			} else if (agentSpecs.length === 1) {
				// Single sequential agent — simple delegation (like new_task)
				await provider.delegateParentAndOpenChild({
					parentTaskId: task.taskId,
					message: agentSpecs[0].message,
					initialTodos: [],
					mode: agentSpecs[0].mode,
					worktree: agentSpecs[0].worktree,
				})
				// Parent is now suspended; this line is reached only if delegation didn't proceed.
				pushToolResult(`Phase "${phase_name}" agent started. Awaiting completion...`)
			} else {
				// Multiple sequential agents — queue drain (first runs, rest queued)
				const [first, ...rest] = agentSpecs
				await provider.delegateParentAndOpenChild({
					parentTaskId: task.taskId,
					message: first.message,
					initialTodos: [],
					mode: first.mode,
					worktree: first.worktree,
					parallelQueue: rest.map(({ mode, message, worktree }) => ({ mode, message, worktree })),
				})
				// Parent is now suspended; this line is reached only if delegation didn't proceed.
				pushToolResult(
					`Phase "${phase_name}" started with ${agentSpecs.length} sequential agents. Awaiting all results...`,
				)
			}
		} catch (error) {
			await handleError("running team phase", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"run_team_phase">): Promise<void> {
		const partialMessage = JSON.stringify({ tool: "runTeamPhase" })
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const runTeamPhaseTool = new RunTeamPhaseTool()
