import { type AuthService, type ShareVisibility, type ShareResponse } from "@roo-code/types"

import { getRooCodeApiUrl } from "./config.js"
import { CloudAPIError } from "./errors.js"

interface CloudAPIRequestOptions extends Omit<RequestInit, "headers"> {
	timeout?: number
	headers?: Record<string, string>
}

export class CloudAPI {
	private authService: AuthService
	private log: (...args: unknown[]) => void
	private baseUrl: string

	constructor(authService: AuthService, log?: (...args: unknown[]) => void) {
		this.authService = authService
		this.log = log || console.log
		this.baseUrl = getRooCodeApiUrl()
	}

	// Cloud features disabled — all HTTP methods are no-ops.

	private async request<T>(
		_endpoint: string,
		_options: CloudAPIRequestOptions & {
			parseResponse?: (data: unknown) => T
		} = {},
	): Promise<T> {
		// No-op: cloud features disabled
		throw new CloudAPIError("Cloud features are disabled in this fork", 0, undefined)
	}

	private async handleErrorResponse(_response: Response, _endpoint: string): Promise<never> {
		throw new CloudAPIError("Cloud features are disabled in this fork", 0, undefined)
	}

	async shareTask(_taskId: string, _visibility: ShareVisibility = "organization"): Promise<ShareResponse> {
		this.log("[CloudAPI] Cloud features disabled — shareTask is a no-op")
		throw new CloudAPIError("Cloud features are disabled in this fork", 0, undefined)
	}

	async bridgeConfig() {
		this.log("[CloudAPI] Cloud features disabled — bridgeConfig is a no-op")
		throw new CloudAPIError("Cloud features are disabled in this fork", 0, undefined)
	}

	async creditBalance(): Promise<number> {
		this.log("[CloudAPI] Cloud features disabled — creditBalance is a no-op")
		throw new CloudAPIError("Cloud features are disabled in this fork", 0, undefined)
	}
}
