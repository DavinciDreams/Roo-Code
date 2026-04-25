import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	buildSkillApprovalMessage,
	buildSkillResult,
	resolveSkillContentForMode,
} from "../../services/skills/skillInvocation"

interface SkillParams {
	skill: string
	args?: string
}

/**
 * Tool that resolves and executes a named skill from the skills system.
 *
 * When invoked, it looks up the requested skill for the current mode via the
 * SkillsManager, injects the skill's SKILL.md content as context, and — after
 * user approval — returns the rendered skill result to the agent. Skills that
 * do not exist for the active mode are rejected with a list of available
 * alternatives.
 */
export class SkillTool extends BaseTool<"skill"> {
	readonly name = "skill" as const

	/**
	 * Resolves the named skill for the current mode, requests user approval, and
	 * pushes the skill's rendered content as the tool result.
	 *
	 * @param params.skill - The name of the skill to look up.
	 * @param params.args - Optional arguments forwarded verbatim to the skill renderer.
	 * @param task - The owning Task instance, used to access provider state and error tracking.
	 * @param callbacks - Standard tool callbacks for approval, error handling, and result delivery.
	 */
	async execute(params: SkillParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { skill: skillName, args } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate skill name parameter
			if (!skillName) {
				task.consecutiveMistakeCount++
				task.recordToolError("skill")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("skill", "skill"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Get SkillsManager from provider
			const provider = task.providerRef.deref()
			const skillsManager = provider?.getSkillsManager()

			if (!skillsManager) {
				task.recordToolError("skill")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("Skills Manager not available"))
				return
			}

			// Get current mode for skill resolution
			const state = await provider?.getState()
			const currentMode = state?.mode ?? "code"

			// Fetch skill content
			const skillContent = await resolveSkillContentForMode(skillsManager, skillName, currentMode)

			if (!skillContent) {
				// Get available skills for error message
				const availableSkills = skillsManager.getSkillsForMode(currentMode)
				const skillNames = availableSkills.map((s) => s.name)

				task.recordToolError("skill")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Skill '${skillName}' not found. Available skills: ${skillNames.join(", ") || "(none)"}`,
					),
				)
				return
			}

			// Build approval message
			const toolMessage = buildSkillApprovalMessage(skillName, args, skillContent)

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			pushToolResult(buildSkillResult(skillName, args, skillContent))
		} catch (error) {
			await handleError("executing skill", error as Error)
		}
	}

	/**
	 * Streams a partial UI update while the skill name and args are still being
	 * received from the model, so the user sees progressive feedback before the
	 * full tool call is ready for execution.
	 */
	override async handlePartial(task: Task, block: ToolUse<"skill">): Promise<void> {
		const skillName: string | undefined = block.params.skill
		const args: string | undefined = block.params.args

		const partialMessage = JSON.stringify({
			tool: "skill",
			skill: skillName,
			args: args,
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const skillTool = new SkillTool()
