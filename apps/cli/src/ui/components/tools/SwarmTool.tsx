import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { truncateText, sanitizeContent, getToolDisplayName, getToolIconName } from "./utils.js"

const MAX_TASK_PREVIEW = 4
const MAX_RESULT_LINES = 16

interface WorkerSpec {
	name: string
	mode: string
	color?: string
}

interface SwarmInput {
	workers?: WorkerSpec[]
	task_list?: string[]
	abort_on_failure?: boolean
	backend?: string
	// run_team_phase fields
	phase?: string
	agents?: Array<{ name: string; mode: string }>
}

function parseSwarmInput(rawContent: string | undefined): SwarmInput | null {
	if (!rawContent) return null
	try {
		return JSON.parse(rawContent) as SwarmInput
	} catch {
		return null
	}
}

export function SwarmTool({ toolData, rawContent }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const displayName = getToolDisplayName(toolData.tool)
	const input = parseSwarmInput(rawContent)

	// The tool result text (populated after swarm completes)
	const resultText = toolData.content ? sanitizeContent(toolData.content) : ""
	const { text: resultPreview, truncated: resultTruncated, hiddenLines } = truncateText(resultText, MAX_RESULT_LINES)

	// Determine workers and tasks from input
	const workers = input?.workers ?? input?.agents ?? []
	const tasks = input?.task_list ?? []
	const isTeamPhase = toolData.tool === "run_team_phase"

	// Parse result lines for success/failure coloring
	const resultLines = resultPreview ? resultPreview.split("\n") : []

	return (
		<Box flexDirection="column" paddingX={1} marginBottom={1}>
			{/* Header */}
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				<Text bold color={theme.toolHeader}>
					{" "}
					{displayName}
				</Text>
				{workers.length > 0 && (
					<Text color={theme.dimText}>
						{" "}
						· {workers.length} worker{workers.length !== 1 ? "s" : ""}
					</Text>
				)}
				{tasks.length > 0 && (
					<Text color={theme.dimText}>
						{" "}
						· {tasks.length} task{tasks.length !== 1 ? "s" : ""}
					</Text>
				)}
				{input?.backend && input.backend !== "in_process" && (
					<Text color={theme.warningColor}> [{input.backend}]</Text>
				)}
			</Box>

			{/* Worker pool */}
			{workers.length > 0 && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					<Text color={theme.dimText} dimColor>
						Workers:
					</Text>
					{workers.map((w, i) => (
						<Box key={i} marginLeft={2}>
							<Icon name="bullet" color={theme.focusColor} />
							<Text color={theme.text} bold>
								{" "}
								{w.name}
							</Text>
							<Text color={theme.dimText}> ({w.mode})</Text>
						</Box>
					))}
				</Box>
			)}

			{/* Phase name (run_team_phase) */}
			{isTeamPhase && input?.phase && (
				<Box marginLeft={2} marginTop={1}>
					<Text color={theme.dimText}>phase: </Text>
					<Text color={theme.focusColor} bold>
						{input.phase}
					</Text>
				</Box>
			)}

			{/* Task queue preview */}
			{tasks.length > 0 && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					<Text color={theme.dimText} dimColor>
						Tasks:
					</Text>
					{tasks.slice(0, MAX_TASK_PREVIEW).map((t, i) => (
						<Box key={i} marginLeft={2}>
							<Text color={theme.dimText}>{i + 1}. </Text>
							<Text color={theme.toolText}>{t.length > 80 ? t.slice(0, 80) + "…" : t}</Text>
						</Box>
					))}
					{tasks.length > MAX_TASK_PREVIEW && (
						<Box marginLeft={2}>
							<Text color={theme.dimText} dimColor>
								… and {tasks.length - MAX_TASK_PREVIEW} more
							</Text>
						</Box>
					)}
				</Box>
			)}

			{/* Results (shown after swarm completes) */}
			{resultLines.length > 0 && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					{resultLines.map((line, i) => {
						const isSuccess = line.startsWith("✓")
						const isFailure = line.startsWith("✗")
						const color = isSuccess ? theme.successColor : isFailure ? theme.errorColor : theme.toolText
						return (
							<Text key={i} color={color}>
								{line}
							</Text>
						)
					})}
					{resultTruncated && (
						<Text color={theme.dimText} dimColor>
							… ({hiddenLines} more lines)
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}
