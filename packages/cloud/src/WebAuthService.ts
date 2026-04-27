import EventEmitter from "events"

import type { ExtensionContext } from "vscode"

import type {
	CloudUserInfo,
	CloudOrganizationMembership,
	AuthService,
	AuthServiceEvents,
	AuthState,
} from "@roo-code/types"

/**
 * WebAuthService — cloud features disabled.
 *
 * All methods that would make HTTP calls to Clerk or Roo Code servers are no-ops.
 * The service starts in "logged-out" state and never transitions to an active session.
 */
export class WebAuthService extends EventEmitter<AuthServiceEvents> implements AuthService {
	private state: AuthState = "initializing"
	private log: (...args: unknown[]) => void

	constructor(_context: ExtensionContext, log?: (...args: unknown[]) => void) {
		super()
		this.log = log || console.log
		this.log("[auth] Using WebAuthService (cloud features disabled)")
	}

	/**
	 * Initialize the auth state — cloud features disabled, starts in logged-out state.
	 */
	public async initialize(): Promise<void> {
		if (this.state !== "initializing") {
			this.log("[auth] initialize() called after already initialized")
			return
		}

		// Start in logged-out state — no credentials loading, no timer, no HTTP calls.
		const previousState = this.state
		this.state = "logged-out"
		this.emit("auth-state-changed", { state: this.state, previousState })
		this.log("[auth] Cloud features disabled — initialized in logged-out state")
	}

	public broadcast(): void {
		// No-op: cloud features disabled
	}

	/**
	 * Login — cloud features disabled, no-op.
	 */
	public async login(_landingPageSlug?: string, _useProviderSignup: boolean = false): Promise<void> {
		this.log("[auth] Cloud features disabled — login is a no-op")
	}

	/**
	 * Handle auth callback — cloud features disabled, no-op.
	 */
	public async handleCallback(
		_code: string | null,
		_state: string | null,
		_organizationId?: string | null,
		_providerModel?: string | null,
	): Promise<void> {
		this.log("[auth] Cloud features disabled — handleCallback is a no-op")
	}

	/**
	 * Logout — cloud features disabled, no-op.
	 */
	public async logout(): Promise<void> {
		this.log("[auth] Cloud features disabled — logout is a no-op")
	}

	public getState(): AuthState {
		return this.state
	}

	public getSessionToken(): string | undefined {
		// Never have a session token when cloud features are disabled
		return undefined
	}

	public isAuthenticated(): boolean {
		return false
	}

	public hasActiveSession(): boolean {
		return false
	}

	public hasOrIsAcquiringActiveSession(): boolean {
		return false
	}

	public getUserInfo(): CloudUserInfo | null {
		return null
	}

	public getStoredOrganizationId(): string | null {
		return null
	}

	public async switchOrganization(_organizationId: string | null): Promise<void> {
		this.log("[auth] Cloud features disabled — switchOrganization is a no-op")
	}

	public async getOrganizationMemberships(): Promise<CloudOrganizationMembership[]> {
		return []
	}

	public dispose(): void {
		this.removeAllListeners()
	}
}
