import type { SettingsService, ShareResponse, ShareVisibility } from "@roo-code/types"

import type { CloudAPI } from "./CloudAPI.js"

export class CloudShareService {
	private cloudAPI: CloudAPI
	private settingsService: SettingsService
	private log: (...args: unknown[]) => void

	constructor(cloudAPI: CloudAPI, settingsService: SettingsService, log?: (...args: unknown[]) => void) {
		this.cloudAPI = cloudAPI
		this.settingsService = settingsService
		this.log = log || console.log
	}

	// Cloud features disabled — all methods are no-ops.

	async shareTask(_taskId: string, _visibility: ShareVisibility = "organization"): Promise<ShareResponse> {
		this.log("[ShareService] Cloud features disabled — shareTask is a no-op")
		throw new Error("Cloud features are disabled in this fork")
	}

	async canShareTask(): Promise<boolean> {
		// Cloud features disabled — sharing is not available
		return false
	}

	async canSharePublicly(): Promise<boolean> {
		// Cloud features disabled — public sharing is not available
		return false
	}
}
