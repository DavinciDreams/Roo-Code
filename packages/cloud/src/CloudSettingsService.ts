import EventEmitter from "events"

import type { ExtensionContext } from "vscode"

import {
	type SettingsService,
	type SettingsServiceEvents,
	type AuthService,
	type UserFeatures,
	type UserSettingsConfig,
	type UserSettingsData,
	OrganizationAllowList,
	OrganizationSettings,
	ORGANIZATION_ALLOW_ALL,
} from "@roo-code/types"

/**
 * CloudSettingsService — cloud features disabled.
 *
 * All methods that would make HTTP calls to app.roocode.com are no-ops.
 * Returns empty/default settings.
 */
export class CloudSettingsService extends EventEmitter<SettingsServiceEvents> implements SettingsService {
	private log: (...args: unknown[]) => void

	constructor(_context: ExtensionContext, _authService: AuthService, log?: (...args: unknown[]) => void) {
		super()
		this.log = log || console.log
		this.log("[cloud-settings] Cloud features disabled — CloudSettingsService is a no-op")
	}

	/**
	 * Initialize — cloud features disabled, no-op.
	 */
	public async initialize(): Promise<void> {
		this.log("[cloud-settings] Cloud features disabled — initialize is a no-op")
	}

	public getAllowList(): OrganizationAllowList {
		return ORGANIZATION_ALLOW_ALL
	}

	public getSettings(): OrganizationSettings | undefined {
		return undefined
	}

	public getUserSettings(): UserSettingsData | undefined {
		return undefined
	}

	public getUserFeatures(): UserFeatures {
		return {}
	}

	public getUserSettingsConfig(): UserSettingsConfig {
		return {}
	}

	public async updateUserSettings(_settings: Partial<UserSettingsConfig>): Promise<boolean> {
		this.log("[cloud-settings] Cloud features disabled — updateUserSettings is a no-op")
		return false
	}

	public isTaskSyncEnabled(): boolean {
		return false
	}

	public dispose(): void {
		this.removeAllListeners()
	}
}
