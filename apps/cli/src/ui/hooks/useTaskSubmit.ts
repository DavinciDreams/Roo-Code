import { useCallback } from "react"
import { randomUUID } from "crypto"
import type { WebviewMessage } from "@roo-code/types"

import { getGlobalCommand } from "../../lib/utils/commands.js"

import { useCLIStore } from "../store.js"
import { useUIStateStore } from "../stores/uiStateStore.js"

export interface UseTaskSubmitOptions {
	sendToExtension: ((msg: WebviewMessage) => void) | null
	runTask: ((prompt: string) => Promise<void>) | null
	seenMessageIds: React.MutableRefObject<Set<string>>
	firstTextMessageSkipped: React.MutableRefObject<boolean>
}

export interface UseTaskSubmitReturn {
	handleSubmit: (text: string) => Promise<void>
	handleApprove: () => void
	handleReject: () => void
}

/**
 * Hook to handle task submission, user responses, and approvals.
 *
 * Responsibilities:
 * - Process user message submissions
 * - Detect and handle global commands (like /new, /cost, /help)
 * - Handle pending ask responses
 * - Start new tasks or continue existing ones
 * - Handle Y/N approval responses
 */
export function useTaskSubmit({
	sendToExtension,
	runTask,
	seenMessageIds,
	firstTextMessageSkipped,
}: UseTaskSubmitOptions): UseTaskSubmitReturn {
	const {
		pendingAsk,
		hasStartedTask,
		isComplete,
		addMessage,
		setPendingAsk,
		setHasStartedTask,
		setLoading,
		setComplete,
		setError,
	} = useCLIStore()

	const { setShowCustomInput, setIsTransitioningToCustomInput } = useUIStateStore()

	/**
	 * Handle user text submission (from input or followup question)
	 */
	const handleSubmit = useCallback(
		async (text: string) => {
			if (!sendToExtension || !text.trim()) {
				return
			}

			const trimmedText = text.trim()

			if (trimmedText === "__CUSTOM__") {
				return
			}

			// Check for CLI global action commands (e.g., /new, /cost, /help)
			if (trimmedText.startsWith("/")) {
				const commandMatch = trimmedText.match(/^\/(\w+)(?:\s+(.+))?$/)

				if (commandMatch && commandMatch[1]) {
					const globalCommand = getGlobalCommand(commandMatch[1])
					const commandArg = commandMatch[2]?.trim()

					if (globalCommand?.action === "clearTask") {
						// Reset CLI state and send clearTask to extension.
						useCLIStore.getState().reset()

						// Reset component-level refs to avoid stale message tracking.
						seenMessageIds.current.clear()
						firstTextMessageSkipped.current = false
						sendToExtension({ type: "clearTask" })

						// Re-request state, commands and modes since reset() cleared them.
						sendToExtension({ type: "requestCommands" })
						sendToExtension({ type: "requestModes" })
						return
					}

					if (globalCommand?.action === "showHelp") {
						const helpLines = [
							"CLI Commands:",
							"",
							"  /help              Show this message",
							"  /clear  or  /new   Start a new task",
							"  /cost              Show session token usage and cost",
							"  /model             Show the current model",
							"  /mode [slug]       Show current mode, or switch modes",
							"  /sessions          List recent task sessions",
							"",
							"Start typing to send a message to the agent.",
						]
						useCLIStore
							.getState()
							.addMessage({ id: randomUUID(), role: "system", content: helpLines.join("\n") })
						return
					}

					if (globalCommand?.action === "showCost") {
						const { tokenUsage } = useCLIStore.getState()
						let content: string
						if (!tokenUsage) {
							content = "No cost data yet — start a task first."
						} else {
							const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))
							content = [
								`Session cost: $${tokenUsage.totalCost.toFixed(4)}`,
								`  Tokens in:  ${fmt(tokenUsage.totalTokensIn)}`,
								`  Tokens out: ${fmt(tokenUsage.totalTokensOut)}`,
								tokenUsage.totalCacheWrites != null
									? `  Cache writes: ${fmt(tokenUsage.totalCacheWrites)}`
									: null,
								tokenUsage.totalCacheReads != null
									? `  Cache reads:  ${fmt(tokenUsage.totalCacheReads)}`
									: null,
								`  Context:    ${fmt(tokenUsage.contextTokens)} tokens`,
							]
								.filter(Boolean)
								.join("\n")
						}
						useCLIStore.getState().addMessage({ id: randomUUID(), role: "system", content })
						return
					}

					if (globalCommand?.action === "showModel") {
						const { apiConfiguration } = useCLIStore.getState()
						const model = apiConfiguration?.apiModelId ?? apiConfiguration?.openRouterModelId ?? "(unknown)"
						useCLIStore
							.getState()
							.addMessage({ id: randomUUID(), role: "system", content: `Current model: ${model}` })
						return
					}

					if (globalCommand?.action === "showMode") {
						if (commandArg) {
							// Switch mode via extension
							sendToExtension({ type: "mode", text: commandArg })
							useCLIStore.getState().addMessage({
								id: randomUUID(),
								role: "system",
								content: `Switching to mode: ${commandArg}`,
							})
						} else {
							const { currentMode } = useCLIStore.getState()
							useCLIStore.getState().addMessage({
								id: randomUUID(),
								role: "system",
								content: `Current mode: ${currentMode ?? "(unknown)"}`,
							})
						}
						return
					}

					if (globalCommand?.action === "showSessions") {
						const { taskHistory } = useCLIStore.getState()
						let content: string
						if (taskHistory.length === 0) {
							content = "No recent sessions."
						} else {
							const lines = ["Recent sessions:"]
							for (const s of taskHistory.slice(0, 8)) {
								const date = new Date(s.ts).toLocaleString()
								const cost = s.totalCost != null ? ` · $${s.totalCost.toFixed(4)}` : ""
								const preview = s.task.length > 60 ? s.task.slice(0, 60) + "…" : s.task
								lines.push(`  ${date}${cost}`)
								lines.push(`    ${preview}`)
							}
							content = lines.join("\n")
						}
						useCLIStore.getState().addMessage({ id: randomUUID(), role: "system", content })
						return
					}
				}
			}

			if (pendingAsk) {
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})

				setPendingAsk(null)
				setShowCustomInput(false)
				setIsTransitioningToCustomInput(false)
				setLoading(true)
			} else if (!hasStartedTask) {
				setHasStartedTask(true)
				setLoading(true)
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				try {
					if (runTask) {
						await runTask(trimmedText)
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err))
					setLoading(false)
				}
			} else {
				if (isComplete) {
					setComplete(false)
				}

				setLoading(true)
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})
			}
		},
		[
			sendToExtension,
			runTask,
			pendingAsk,
			hasStartedTask,
			isComplete,
			addMessage,
			setPendingAsk,
			setHasStartedTask,
			setLoading,
			setComplete,
			setError,
			setShowCustomInput,
			setIsTransitioningToCustomInput,
			seenMessageIds,
			firstTextMessageSkipped,
		],
	)

	/**
	 * Handle approval (Y key)
	 */
	const handleApprove = useCallback(() => {
		if (!sendToExtension) {
			return
		}

		sendToExtension({ type: "askResponse", askResponse: "yesButtonClicked" })
		setPendingAsk(null)
		setLoading(true)
	}, [sendToExtension, setPendingAsk, setLoading])

	/**
	 * Handle rejection (N key)
	 */
	const handleReject = useCallback(() => {
		if (!sendToExtension) {
			return
		}

		sendToExtension({ type: "askResponse", askResponse: "noButtonClicked" })
		setPendingAsk(null)
		setLoading(true)
	}, [sendToExtension, setPendingAsk, setLoading])

	return {
		handleSubmit,
		handleApprove,
		handleReject,
	}
}
