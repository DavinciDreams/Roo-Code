import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import {
	type ProviderSettings,
	type ProviderSettingsEntry,
	type CustomModePrompts,
	type ModeConfig,
	type ExperimentId,
	type TodoItem,
	type TelemetrySetting,
	type OrganizationAllowList,
	type CloudOrganizationMembership,
	type ExtensionMessage,
	type ExtensionState,
	type MarketplaceItem,
	type MarketplaceInstalledMetadata,
	type SkillMetadata,
	type Command,
	type McpServer,
	RouterModels,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
} from "@roo-code/types"

import { findLastIndex } from "@roo/array"

import { checkExistKey } from "@roo/checkExistApiConfig"
import { Mode, defaultModeSlug, defaultPrompts } from "@roo/modes"
import { CustomSupportPrompts } from "@roo/support-prompt"
import { experimentDefault } from "@roo/experiments"

import { vscode } from "@src/utils/vscode"
import { convertTextMateToHljs } from "@src/utils/textMateToHljs"

export interface ExtensionStateContextType extends ExtensionState {
	historyPreviewCollapsed?: boolean // Add the new state property
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
	mcpServers: McpServer[]
	currentCheckpoint?: string
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	filePaths: string[]
	openedTabs: Array<{ label: string; isActive: boolean; path?: string }>
	commands: Command[]
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion: number
	cloudIsAuthenticated: boolean
	cloudOrganizations?: CloudOrganizationMembership[]
	sharingEnabled: boolean
	publicSharingEnabled: boolean
	mdmCompliant?: boolean
	hasOpenedModeSelector: boolean // New property to track if user has opened mode selector
	setHasOpenedModeSelector: (value: boolean) => void // Setter for the new property
	alwaysAllowFollowupQuestions: boolean // New property for follow-up questions auto-approve
	setAlwaysAllowFollowupQuestions: (value: boolean) => void // Setter for the new property
	followupAutoApproveTimeoutMs: number | undefined // Timeout in ms for auto-approving follow-up questions
	setFollowupAutoApproveTimeoutMs: (value: number) => void // Setter for the timeout
	marketplaceItems?: MarketplaceItem[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	profileThresholds: Record<string, number>
	setProfileThresholds: (value: Record<string, number>) => void
	setApiConfiguration: (config: ProviderSettings) => void
	setCustomInstructions: (value?: string) => void
	setAlwaysAllowReadOnly: (value: boolean) => void
	setAlwaysAllowReadOnlyOutsideWorkspace: (value: boolean) => void
	setAlwaysAllowWrite: (value: boolean) => void
	setAlwaysAllowWriteOutsideWorkspace: (value: boolean) => void
	setAlwaysAllowExecute: (value: boolean) => void
	setAlwaysAllowMcp: (value: boolean) => void
	setAlwaysAllowModeSwitch: (value: boolean) => void
	setAlwaysAllowSubtasks: (value: boolean) => void
	setShowRooIgnoredFiles: (value: boolean) => void
	setEnableSubfolderRules: (value: boolean) => void
	setShowAnnouncement: (value: boolean) => void
	setAllowedCommands: (value: string[]) => void
	setDeniedCommands: (value: string[]) => void
	setAllowedMaxRequests: (value: number | undefined) => void
	setAllowedMaxCost: (value: number | undefined) => void
	setSoundEnabled: (value: boolean) => void
	setSoundVolume: (value: number) => void
	terminalShellIntegrationTimeout?: number
	setTerminalShellIntegrationTimeout: (value: number) => void
	terminalShellIntegrationDisabled?: boolean
	setTerminalShellIntegrationDisabled: (value: boolean) => void
	terminalZdotdir?: boolean
	setTerminalZdotdir: (value: boolean) => void
	setTtsEnabled: (value: boolean) => void
	setTtsSpeed: (value: number) => void
	setEnableCheckpoints: (value: boolean) => void
	checkpointTimeout: number
	setCheckpointTimeout: (value: number) => void
	setWriteDelayMs: (value: number) => void
	terminalOutputPreviewSize?: "small" | "medium" | "large"
	setTerminalOutputPreviewSize: (value: "small" | "medium" | "large") => void
	mcpEnabled: boolean
	setMcpEnabled: (value: boolean) => void
	taskSyncEnabled: boolean
	setTaskSyncEnabled: (value: boolean) => void
	setCurrentApiConfigName: (value: string) => void
	setListApiConfigMeta: (value: ProviderSettingsEntry[]) => void
	mode: Mode
	setMode: (value: Mode) => void
	setCustomModePrompts: (value: CustomModePrompts) => void
	setCustomSupportPrompts: (value: CustomSupportPrompts) => void
	enhancementApiConfigId?: string
	setEnhancementApiConfigId: (value: string) => void
	setExperimentEnabled: (id: ExperimentId, enabled: boolean) => void
	setAutoApprovalEnabled: (value: boolean) => void
	customModes: ModeConfig[]
	setCustomModes: (value: ModeConfig[]) => void
	setMaxOpenTabsContext: (value: number) => void
	maxWorkspaceFiles: number
	setMaxWorkspaceFiles: (value: number) => void
	setTelemetrySetting: (value: TelemetrySetting) => void
	awsUsePromptCache?: boolean
	setAwsUsePromptCache: (value: boolean) => void
	maxImageFileSize: number
	setMaxImageFileSize: (value: number) => void
	maxTotalImageSize: number
	setMaxTotalImageSize: (value: number) => void
	machineId?: string
	pinnedApiConfigs?: Record<string, boolean>
	setPinnedApiConfigs: (value: Record<string, boolean>) => void
	togglePinnedApiConfig: (configName: string) => void
	setHistoryPreviewCollapsed: (value: boolean) => void
	setReasoningBlockCollapsed: (value: boolean) => void
	enterBehavior?: "send" | "newline"
	setEnterBehavior: (value: "send" | "newline") => void
	autoCondenseContext: boolean
	setAutoCondenseContext: (value: boolean) => void
	autoCondenseContextPercent: number
	setAutoCondenseContextPercent: (value: number) => void
	routerModels?: RouterModels
	includeDiagnosticMessages?: boolean
	setIncludeDiagnosticMessages: (value: boolean) => void
	maxDiagnosticMessages?: number
	setMaxDiagnosticMessages: (value: number) => void
	includeTaskHistoryInEnhance?: boolean
	setIncludeTaskHistoryInEnhance: (value: boolean) => void
	includeCurrentTime?: boolean
	setIncludeCurrentTime: (value: boolean) => void
	includeCurrentCost?: boolean
	setIncludeCurrentCost: (value: boolean) => void
	showWorktreesInHomeScreen: boolean
	setShowWorktreesInHomeScreen: (value: boolean) => void
	skills?: SkillMetadata[]
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const mergeExtensionState = (prevState: ExtensionState, newState: Partial<ExtensionState>) => {
	const { customModePrompts: prevCustomModePrompts, experiments: prevExperiments, ...prevRest } = prevState

	const {
		apiConfiguration,
		customModePrompts: newCustomModePrompts,
		customSupportPrompts,
		experiments: newExperiments,
		...newRest
	} = newState

	const customModePrompts = { ...prevCustomModePrompts, ...(newCustomModePrompts ?? {}) }
	const experiments = { ...prevExperiments, ...(newExperiments ?? {}) }
	const rest = { ...prevRest, ...newRest }

	// Protect clineMessages from stale state pushes using sequence numbering.
	// Multiple async event sources (cloud auth, settings, task streaming) can trigger
	// concurrent state pushes. If a stale push arrives after a newer one, its clineMessages
	// would overwrite the newer messages. The sequence number prevents this by only applying
	// clineMessages when the incoming seq is strictly greater than the last applied seq.
	if (
		newState.clineMessagesSeq !== undefined &&
		prevState.clineMessagesSeq !== undefined &&
		newState.clineMessagesSeq <= prevState.clineMessagesSeq &&
		newState.clineMessages !== undefined
	) {
		rest.clineMessages = prevState.clineMessages
		rest.clineMessagesSeq = prevState.clineMessagesSeq
	}

	// Note that we completely replace the previous apiConfiguration and customSupportPrompts objects
	// with new ones since the state that is broadcast is the entire objects so merging is not necessary.
	return {
		...rest,
		apiConfiguration: apiConfiguration ?? prevState.apiConfiguration,
		customModePrompts,
		customSupportPrompts: customSupportPrompts ?? prevState.customSupportPrompts,
		experiments,
	}
}

export const ExtensionStateContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [state, setState] = useState<ExtensionState>({
		apiConfiguration: {},
		version: "",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		allowedCommands: [],
		deniedCommands: [],
		soundEnabled: false,
		soundVolume: 0.5,
		ttsEnabled: false,
		ttsSpeed: 1.0,
		enableCheckpoints: true,
		checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS, // Default to 15 seconds
		language: "en", // Default language code
		writeDelayMs: 1000,
		terminalShellIntegrationTimeout: 4000,
		mcpEnabled: true,
		taskSyncEnabled: false,
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		mode: defaultModeSlug,
		customModePrompts: defaultPrompts,
		customSupportPrompts: {},
		experiments: experimentDefault,
		enhancementApiConfigId: "",
		hasOpenedModeSelector: false, // Default to false (not opened yet)
		autoApprovalEnabled: false,
		customModes: [],
		maxOpenTabsContext: 20,
		maxWorkspaceFiles: 200,
		cwd: "",
		telemetrySetting: "unset",
		showRooIgnoredFiles: true, // Default to showing .rooignore'd files with lock symbol (current behavior).
		enableSubfolderRules: false, // Default to disabled - must be enabled to load rules from subdirectories
		renderContext: "sidebar",
		maxReadFileLine: -1, // Default max line limit for read_file tool (-1 for default)
		maxImageFileSize: 5, // Default max image file size in MB
		maxTotalImageSize: 20, // Default max total image size in MB
		pinnedApiConfigs: {}, // Empty object for pinned API configs
		terminalZshOhMy: false, // Default Oh My Zsh integration setting
		terminalZshP10k: false, // Default Powerlevel10k integration setting
		terminalZdotdir: false, // Default ZDOTDIR handling setting
		historyPreviewCollapsed: false, // Initialize the new state (default to expanded)
		reasoningBlockCollapsed: true, // Default to collapsed
		enterBehavior: "send", // Default: Enter sends, Shift+Enter creates newline
		cloudUserInfo: null,
		cloudIsAuthenticated: false,
		cloudOrganizations: [],
		sharingEnabled: false,
		publicSharingEnabled: false,
		organizationAllowList: ORGANIZATION_ALLOW_ALL,
		organizationSettingsVersion: -1,
		autoCondenseContext: true,
		autoCondenseContextPercent: 100,
		profileThresholds: {},
		codebaseIndexConfig: {
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexEmbedderProvider: "openai",
			codebaseIndexEmbedderBaseUrl: "",
			codebaseIndexEmbedderModelId: "",
			codebaseIndexSearchMaxResults: undefined,
			codebaseIndexSearchMinScore: undefined,
		},
		codebaseIndexModels: { ollama: {}, openai: {} },
		includeDiagnosticMessages: true,
		maxDiagnosticMessages: 50,
		openRouterImageApiKey: "",
		openRouterImageGenerationSelectedModel: "",
		includeCurrentTime: true,
		includeCurrentCost: true,
		lockApiConfigAcrossModes: false,
	})

	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [theme, setTheme] = useState<any>(undefined)
	const [filePaths, setFilePaths] = useState<string[]>([])
	const [openedTabs, setOpenedTabs] = useState<Array<{ label: string; isActive: boolean; path?: string }>>([])
	const [commands, setCommands] = useState<Command[]>([])
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])
	const [currentCheckpoint, setCurrentCheckpoint] = useState<string>()
	const [extensionRouterModels, setExtensionRouterModels] = useState<RouterModels | undefined>(undefined)
	const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>([])
	const [alwaysAllowFollowupQuestions, setAlwaysAllowFollowupQuestions] = useState(false) // Add state for follow-up questions auto-approve
	const [followupAutoApproveTimeoutMs, setFollowupAutoApproveTimeoutMs] = useState<number | undefined>(undefined) // Will be set from global settings
	const [marketplaceInstalledMetadata, setMarketplaceInstalledMetadata] = useState<MarketplaceInstalledMetadata>({
		project: {},
		global: {},
	})
	const [skills, setSkills] = useState<SkillMetadata[]>([])
	const [includeTaskHistoryInEnhance, setIncludeTaskHistoryInEnhance] = useState(true)
	const [prevCloudIsAuthenticated, setPrevCloudIsAuthenticated] = useState(false)
	const [includeCurrentTime, setIncludeCurrentTime] = useState(true)
	const [includeCurrentCost, setIncludeCurrentCost] = useState(true)

	const setListApiConfigMeta = useCallback(
		(value: ProviderSettingsEntry[]) => setState((prevState) => ({ ...prevState, listApiConfigMeta: value })),
		[],
	)

	const setApiConfiguration = useCallback((value: ProviderSettings) => {
		setState((prevState) => ({
			...prevState,
			apiConfiguration: {
				...prevState.apiConfiguration,
				...value,
			},
		}))
	}, [])

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "state": {
					const newState = message.state ?? {}
					setState((prevState) => mergeExtensionState(prevState, newState))
					setShowWelcome(!checkExistKey(newState.apiConfiguration))
					setDidHydrateState(true)
					// Update alwaysAllowFollowupQuestions if present in state message
					if (newState.alwaysAllowFollowupQuestions !== undefined) {
						setAlwaysAllowFollowupQuestions(newState.alwaysAllowFollowupQuestions)
					}
					// Update followupAutoApproveTimeoutMs if present in state message
					if (newState.followupAutoApproveTimeoutMs !== undefined) {
						setFollowupAutoApproveTimeoutMs(newState.followupAutoApproveTimeoutMs)
					}
					// Update includeTaskHistoryInEnhance if present in state message
					if (newState.includeTaskHistoryInEnhance !== undefined) {
						setIncludeTaskHistoryInEnhance(newState.includeTaskHistoryInEnhance)
					}
					// Update includeCurrentTime if present in state message
					if (newState.includeCurrentTime !== undefined) {
						setIncludeCurrentTime(newState.includeCurrentTime)
					}
					// Update includeCurrentCost if present in state message
					if (newState.includeCurrentCost !== undefined) {
						setIncludeCurrentCost(newState.includeCurrentCost)
					}
					// Handle marketplace data if present in state message
					if (newState.marketplaceItems !== undefined) {
						setMarketplaceItems(newState.marketplaceItems)
					}
					if (newState.marketplaceInstalledMetadata !== undefined) {
						setMarketplaceInstalledMetadata(newState.marketplaceInstalledMetadata)
					}
					break
				}
				case "action": {
					if (message.action === "toggleAutoApprove") {
						// Toggle the auto-approval state
						setState((prevState) => {
							const newValue = !(prevState.autoApprovalEnabled ?? false)
							// Also send the update to the extension
							vscode.postMessage({ type: "autoApprovalEnabled", bool: newValue })
							return { ...prevState, autoApprovalEnabled: newValue }
						})
					}
					break
				}
				case "theme": {
					if (message.text) {
						setTheme(convertTextMateToHljs(JSON.parse(message.text)))
					}
					break
				}
				case "workspaceUpdated": {
					const paths = message.filePaths ?? []
					const tabs = message.openedTabs ?? []

					setFilePaths(paths)
					setOpenedTabs(tabs)
					break
				}
				case "commands": {
					setCommands(message.commands ?? [])
					break
				}
				case "messageUpdated": {
					const clineMessage = message.clineMessage!
					setState((prevState) => {
						// worth noting it will never be possible for a more up-to-date message to be sent here or in normal messages post since the presentAssistantContent function uses lock
						const lastIndex = findLastIndex(prevState.clineMessages, (msg) => msg.ts === clineMessage.ts)
						if (lastIndex !== -1) {
							const newClineMessages = [...prevState.clineMessages]
							newClineMessages[lastIndex] = clineMessage
							return { ...prevState, clineMessages: newClineMessages }
						}
						// Log a warning if messageUpdated arrives for a timestamp not in the
						// frontend's clineMessages. With the seq guard and cloud event isolation
						// (layers 1+2), this should not happen under normal conditions. If it
						// does, it signals a state synchronization issue worth investigating.
						console.warn(
							`[messageUpdated] Received update for unknown message ts=${clineMessage.ts}, dropping. ` +
								`Frontend has ${prevState.clineMessages.length} messages.`,
						)
						return prevState
					})
					break
				}
				case "skills": {
					if (message.skills) {
						setSkills(message.skills)
					}
					break
				}
				case "mcpServers": {
					setMcpServers(message.mcpServers ?? [])
					break
				}
				case "currentCheckpointUpdated": {
					setCurrentCheckpoint(message.text)
					break
				}
				case "listApiConfig": {
					setListApiConfigMeta(message.listApiConfig ?? [])
					break
				}
				case "routerModels": {
					setExtensionRouterModels(message.routerModels)
					break
				}
				case "marketplaceData": {
					if (message.marketplaceItems !== undefined) {
						setMarketplaceItems(message.marketplaceItems)
					}
					if (message.marketplaceInstalledMetadata !== undefined) {
						setMarketplaceInstalledMetadata(message.marketplaceInstalledMetadata)
					}
					break
				}
				case "taskHistoryUpdated": {
					// Efficiently update just the task history without replacing entire state
					if (message.taskHistory !== undefined) {
						setState((prevState) => ({
							...prevState,
							taskHistory: message.taskHistory!,
						}))
					}
					break
				}
				case "taskHistoryItemUpdated": {
					const item = message.taskHistoryItem
					if (!item) {
						break
					}
					setState((prevState) => {
						const existingIndex = prevState.taskHistory.findIndex((h) => h.id === item.id)
						let nextHistory: typeof prevState.taskHistory
						if (existingIndex === -1) {
							nextHistory = [item, ...prevState.taskHistory]
						} else {
							nextHistory = [...prevState.taskHistory]
							nextHistory[existingIndex] = item
						}
						// Keep UI semantics consistent with extension: newest-first ordering.
						nextHistory.sort((a, b) => b.ts - a.ts)
						return {
							...prevState,
							taskHistory: nextHistory,
							currentTaskItem:
								prevState.currentTaskItem?.id === item.id ? item : prevState.currentTaskItem,
						}
					})
					break
				}
			}
		},
		[setListApiConfigMeta],
	)

	useEffect(() => {
		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [handleMessage])

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	// Watch for authentication state changes and refresh Roo models
	useEffect(() => {
		const currentAuth = state.cloudIsAuthenticated ?? false
		const currentProvider = state.apiConfiguration?.apiProvider
		if (!prevCloudIsAuthenticated && currentAuth && currentProvider === "roo") {
			// User just authenticated and Roo is the active provider - refresh Roo models
			vscode.postMessage({ type: "requestRooModels" })
		}
		setPrevCloudIsAuthenticated(currentAuth)
	}, [state.cloudIsAuthenticated, prevCloudIsAuthenticated, state.apiConfiguration?.apiProvider])

	const contextValue: ExtensionStateContextType = useMemo(
		() => ({
			...state,
			reasoningBlockCollapsed: state.reasoningBlockCollapsed ?? true,
			didHydrateState,
			showWelcome,
			theme,
			mcpServers,
			currentCheckpoint,
			filePaths,
			openedTabs,
			commands,
			soundVolume: state.soundVolume,
			ttsSpeed: state.ttsSpeed,
			writeDelayMs: state.writeDelayMs,
			routerModels: extensionRouterModels,
			cloudIsAuthenticated: state.cloudIsAuthenticated ?? false,
			cloudOrganizations: state.cloudOrganizations ?? [],
			organizationSettingsVersion: state.organizationSettingsVersion ?? -1,
			marketplaceItems,
			marketplaceInstalledMetadata,
			profileThresholds: state.profileThresholds ?? {},
			alwaysAllowFollowupQuestions,
			followupAutoApproveTimeoutMs,
			taskSyncEnabled: state.taskSyncEnabled,
			setExperimentEnabled: (id: ExperimentId, enabled: boolean) =>
				setState((prevState) => ({ ...prevState, experiments: { ...prevState.experiments, [id]: enabled } })),
			setApiConfiguration,
			setCustomInstructions: (value?: string) =>
				setState((prevState) => ({ ...prevState, customInstructions: value })),
			setAlwaysAllowReadOnly: (value: boolean) =>
				setState((prevState) => ({ ...prevState, alwaysAllowReadOnly: value })),
			setAlwaysAllowReadOnlyOutsideWorkspace: (value: boolean) =>
				setState((prevState) => ({ ...prevState, alwaysAllowReadOnlyOutsideWorkspace: value })),
			setAlwaysAllowWrite: (value: boolean) =>
				setState((prevState) => ({ ...prevState, alwaysAllowWrite: value })),
			setAlwaysAllowWriteOutsideWorkspace: (value: boolean) =>
				setState((prevState) => ({ ...prevState, alwaysAllowWriteOutsideWorkspace: value })),
			setAlwaysAllowExecute: (value: boolean) =>
				setState((prevState) => ({ ...prevState, alwaysAllowExecute: value })),
			setAlwaysAllowMcp: (value: boolean) => setState((prevState) => ({ ...prevState, alwaysAllowMcp: value })),
			setAlwaysAllowModeSwitch: (value: boolean) =>
				setState((prevState) => ({ ...prevState, alwaysAllowModeSwitch: value })),
			setAlwaysAllowSubtasks: (value: boolean) =>
				setState((prevState) => ({ ...prevState, alwaysAllowSubtasks: value })),
			setAlwaysAllowFollowupQuestions,
			setFollowupAutoApproveTimeoutMs: (value: number) =>
				setState((prevState) => ({ ...prevState, followupAutoApproveTimeoutMs: value })),
			setShowAnnouncement: (value: boolean) =>
				setState((prevState) => ({ ...prevState, shouldShowAnnouncement: value })),
			setAllowedCommands: (value: string[]) =>
				setState((prevState) => ({ ...prevState, allowedCommands: value })),
			setDeniedCommands: (value: string[]) => setState((prevState) => ({ ...prevState, deniedCommands: value })),
			setAllowedMaxRequests: (value: number | undefined) =>
				setState((prevState) => ({ ...prevState, allowedMaxRequests: value })),
			setAllowedMaxCost: (value: number | undefined) =>
				setState((prevState) => ({ ...prevState, allowedMaxCost: value })),
			setSoundEnabled: (value: boolean) => setState((prevState) => ({ ...prevState, soundEnabled: value })),
			setSoundVolume: (value: number) => setState((prevState) => ({ ...prevState, soundVolume: value })),
			setTtsEnabled: (value: boolean) => setState((prevState) => ({ ...prevState, ttsEnabled: value })),
			setTtsSpeed: (value: number) => setState((prevState) => ({ ...prevState, ttsSpeed: value })),
			setEnableCheckpoints: (value: boolean) =>
				setState((prevState) => ({ ...prevState, enableCheckpoints: value })),
			setCheckpointTimeout: (value: number) =>
				setState((prevState) => ({ ...prevState, checkpointTimeout: value })),
			setWriteDelayMs: (value: number) => setState((prevState) => ({ ...prevState, writeDelayMs: value })),
			setTerminalOutputPreviewSize: (value: "small" | "medium" | "large") =>
				setState((prevState) => ({ ...prevState, terminalOutputPreviewSize: value })),
			setTerminalShellIntegrationTimeout: (value: number) =>
				setState((prevState) => ({ ...prevState, terminalShellIntegrationTimeout: value })),
			setTerminalShellIntegrationDisabled: (value: boolean) =>
				setState((prevState) => ({ ...prevState, terminalShellIntegrationDisabled: value })),
			setTerminalZdotdir: (value: boolean) => setState((prevState) => ({ ...prevState, terminalZdotdir: value })),
			setMcpEnabled: (value: boolean) => setState((prevState) => ({ ...prevState, mcpEnabled: value })),
			setTaskSyncEnabled: (value: boolean) =>
				setState((prevState) => ({ ...prevState, taskSyncEnabled: value }) as any),
			setCurrentApiConfigName: (value: string) =>
				setState((prevState) => ({ ...prevState, currentApiConfigName: value })),
			setListApiConfigMeta,
			setMode: (value: Mode) => setState((prevState) => ({ ...prevState, mode: value })),
			setCustomModePrompts: (value: CustomModePrompts) =>
				setState((prevState) => ({ ...prevState, customModePrompts: value })),
			setCustomSupportPrompts: (value: CustomSupportPrompts) =>
				setState((prevState) => ({ ...prevState, customSupportPrompts: value })),
			setEnhancementApiConfigId: (value: string) =>
				setState((prevState) => ({ ...prevState, enhancementApiConfigId: value })),
			setAutoApprovalEnabled: (value: boolean) =>
				setState((prevState) => ({ ...prevState, autoApprovalEnabled: value })),
			setCustomModes: (value: ModeConfig[]) => setState((prevState) => ({ ...prevState, customModes: value })),
			setMaxOpenTabsContext: (value: number) =>
				setState((prevState) => ({ ...prevState, maxOpenTabsContext: value })),
			setMaxWorkspaceFiles: (value: number) =>
				setState((prevState) => ({ ...prevState, maxWorkspaceFiles: value })),
			setTelemetrySetting: (value: TelemetrySetting) =>
				setState((prevState) => ({ ...prevState, telemetrySetting: value })),
			setShowRooIgnoredFiles: (value: boolean) =>
				setState((prevState) => ({ ...prevState, showRooIgnoredFiles: value })),
			setEnableSubfolderRules: (value: boolean) =>
				setState((prevState) => ({ ...prevState, enableSubfolderRules: value })),
			setAwsUsePromptCache: (value: boolean) =>
				setState((prevState) => ({ ...prevState, awsUsePromptCache: value })),
			setMaxImageFileSize: (value: number) =>
				setState((prevState) => ({ ...prevState, maxImageFileSize: value })),
			setMaxTotalImageSize: (value: number) =>
				setState((prevState) => ({ ...prevState, maxTotalImageSize: value })),
			setPinnedApiConfigs: (value: Record<string, boolean>) =>
				setState((prevState) => ({ ...prevState, pinnedApiConfigs: value })),
			togglePinnedApiConfig: (configId: string) =>
				setState((prevState) => {
					const currentPinned = prevState.pinnedApiConfigs || {}
					const newPinned = {
						...currentPinned,
						[configId]: !currentPinned[configId],
					}

					// If the config is now unpinned, remove it from the object
					if (!newPinned[configId]) {
						delete newPinned[configId]
					}

					return { ...prevState, pinnedApiConfigs: newPinned }
				}),
			setHistoryPreviewCollapsed: (value: boolean) =>
				setState((prevState) => ({ ...prevState, historyPreviewCollapsed: value })),
			setReasoningBlockCollapsed: (value: boolean) =>
				setState((prevState) => ({ ...prevState, reasoningBlockCollapsed: value })),
			enterBehavior: state.enterBehavior ?? "send",
			setEnterBehavior: (value: "send" | "newline") =>
				setState((prevState) => ({ ...prevState, enterBehavior: value })),
			setHasOpenedModeSelector: (value: boolean) =>
				setState((prevState) => ({ ...prevState, hasOpenedModeSelector: value })),
			setAutoCondenseContext: (value: boolean) =>
				setState((prevState) => ({ ...prevState, autoCondenseContext: value })),
			setAutoCondenseContextPercent: (value: number) =>
				setState((prevState) => ({ ...prevState, autoCondenseContextPercent: value })),
			setProfileThresholds: (value: Record<string, number>) =>
				setState((prevState) => ({ ...prevState, profileThresholds: value })),
			includeDiagnosticMessages: state.includeDiagnosticMessages,
			setIncludeDiagnosticMessages: (value: boolean) => {
				setState((prevState) => ({ ...prevState, includeDiagnosticMessages: value }))
			},
			maxDiagnosticMessages: state.maxDiagnosticMessages,
			setMaxDiagnosticMessages: (value: number) => {
				setState((prevState) => ({ ...prevState, maxDiagnosticMessages: value }))
			},
			includeTaskHistoryInEnhance,
			setIncludeTaskHistoryInEnhance,
			includeCurrentTime,
			setIncludeCurrentTime,
			includeCurrentCost,
			setIncludeCurrentCost,
			skills,
			showWorktreesInHomeScreen: state.showWorktreesInHomeScreen ?? true,
			setShowWorktreesInHomeScreen: (value: boolean) =>
				setState((prevState) => ({ ...prevState, showWorktreesInHomeScreen: value })),
		}),
		// setState is stable; setListApiConfigMeta/setApiConfiguration/setAlwaysAllowFollowupQuestions
		// are wrapped in useCallback with [] deps so they are also stable.
		[
			state,
			didHydrateState,
			showWelcome,
			theme,
			mcpServers,
			currentCheckpoint,
			filePaths,
			openedTabs,
			commands,
			extensionRouterModels,
			marketplaceItems,
			marketplaceInstalledMetadata,
			alwaysAllowFollowupQuestions,
			followupAutoApproveTimeoutMs,
			includeTaskHistoryInEnhance,
			includeCurrentTime,
			includeCurrentCost,
			setListApiConfigMeta,
			setApiConfiguration,
			setAlwaysAllowFollowupQuestions,
			setIncludeTaskHistoryInEnhance,
			setIncludeCurrentTime,
			setIncludeCurrentCost,
			skills,
		],
	)

	return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)

	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}

	return context
}
