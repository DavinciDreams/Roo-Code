import { memo } from "react"
import { ArrowRight } from "lucide-react"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import type { SubtaskTreeNode } from "./types"
import { countAllSubtasks } from "./types"
import { StandardTooltip } from "../ui"
import SubtaskCollapsibleRow from "./SubtaskCollapsibleRow"

const AGENT_COLOR_MAP: Record<string, string> = {
	red: "#f87171",
	blue: "#60a5fa",
	green: "#4ade80",
	yellow: "#facc15",
	purple: "#c084fc",
	orange: "#fb923c",
	pink: "#f472b6",
	cyan: "#22d3ee",
}

interface SubtaskRowProps {
	/** The subtask tree node to display */
	node: SubtaskTreeNode
	/** Nesting depth (1 = direct child of parent group) */
	depth: number
	/** Callback when expand/collapse is toggled for a node */
	onToggleExpand: (taskId: string) => void
	/** Optional className for styling */
	className?: string
}

/**
 * Displays a subtask row with recursive nesting support.
 * Leaf nodes render just the task row. Nodes with children show
 * a collapsible section that can be expanded to reveal nested subtasks.
 */
const SubtaskRow = ({ node, depth, onToggleExpand, className }: SubtaskRowProps) => {
	const { item, children, isExpanded } = node
	const hasChildren = children.length > 0

	const handleClick = () => {
		vscode.postMessage({ type: "showTaskWithId", text: item.id })
	}

	return (
		<div data-testid={`subtask-row-${item.id}`} className={className}>
			{/* Task row with depth indentation */}
			<div
				className={cn(
					"group flex items-center justify-between gap-2 pr-4 py-1 cursor-pointer",
					"text-vscode-foreground/60 hover:text-vscode-foreground transition-colors",
				)}
				style={{ paddingLeft: `${depth * 16}px` }}
				onClick={handleClick}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault()
						handleClick()
					}
				}}>
				<div className="flex items-center gap-1.5 min-w-0">
					{item.agentColor && AGENT_COLOR_MAP[item.agentColor] && (
						<StandardTooltip content={item.agentName ?? item.agentColor} delay={300}>
							<span
								className="size-2 rounded-full shrink-0"
								style={{ backgroundColor: AGENT_COLOR_MAP[item.agentColor] }}
							/>
						</StandardTooltip>
					)}
					<StandardTooltip content={item.task} delay={600}>
						<span className="text-sm line-clamp-1">{item.task}</span>
					</StandardTooltip>
				</div>
				<ArrowRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
			</div>

			{/* Nested subtask collapsible section */}
			{hasChildren && (
				<div style={{ paddingLeft: `${depth * 16}px` }}>
					<SubtaskCollapsibleRow
						count={countAllSubtasks(children)}
						isExpanded={isExpanded}
						onToggle={() => onToggleExpand(item.id)}
					/>
				</div>
			)}

			{/* Expanded nested subtasks */}
			{hasChildren && (
				<div
					className={cn(
						"overflow-clip transition-all duration-300",
						isExpanded ? "max-h-[2000px]" : "max-h-0",
					)}>
					{children.map((child) => (
						<SubtaskRow
							key={child.item.id}
							node={child}
							depth={depth + 1}
							onToggleExpand={onToggleExpand}
						/>
					))}
				</div>
			)}
		</div>
	)
}

export default memo(SubtaskRow)
