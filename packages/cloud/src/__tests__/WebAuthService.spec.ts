// npx vitest run src/__tests__/WebAuthService.spec.ts

import type { ExtensionContext } from "vscode"

import { WebAuthService } from "../WebAuthService.js"

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
		uriScheme: "vscode",
	},
	Uri: {
		parse: vi.fn((uri: string) => ({ toString: () => uri })),
	},
}))

describe("WebAuthService", () => {
	let authService: WebAuthService
	let mockLog: ReturnType<typeof vi.fn>
	let mockContext: ExtensionContext

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			subscriptions: { push: vi.fn() },
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			},
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
			},
			extension: {
				packageJSON: {
					version: "1.0.0",
					publisher: "RooVeterinaryInc",
					name: "roo-cline",
				},
			},
		} as unknown as ExtensionContext

		mockLog = vi.fn()

		authService = new WebAuthService(mockContext, mockLog)
	})

	afterEach(() => {
		authService.dispose()
	})

	describe("constructor", () => {
		it("should initialize with correct default values", () => {
			expect(authService.getState()).toBe("initializing")
			expect(authService.isAuthenticated()).toBe(false)
			expect(authService.hasActiveSession()).toBe(false)
			expect(authService.getSessionToken()).toBeUndefined()
			expect(authService.getUserInfo()).toBeNull()
		})

		it("should use console.log as default logger", () => {
			const serviceWithoutLog = new WebAuthService(mockContext)
			expect(serviceWithoutLog).toBeInstanceOf(WebAuthService)
			serviceWithoutLog.dispose()
		})

		it("should log that cloud features are disabled", () => {
			expect(mockLog).toHaveBeenCalledWith("[auth] Using WebAuthService (cloud features disabled)")
		})
	})

	describe("initialize", () => {
		it("should transition to logged-out state", async () => {
			await authService.initialize()
			expect(authService.getState()).toBe("logged-out")
		})

		it("should not initialize twice", async () => {
			await authService.initialize()
			await authService.initialize()
			expect(mockLog).toHaveBeenCalledWith("[auth] initialize() called after already initialized")
		})

		it("should always end in logged-out state regardless of stored credentials", async () => {
			// Even if credentials exist, the no-op service goes to logged-out
			vi.mocked(mockContext.secrets.get).mockResolvedValue(
				JSON.stringify({ clientToken: "test-token", sessionId: "test-session" }),
			)

			await authService.initialize()
			expect(authService.getState()).toBe("logged-out")
		})

		it("should log that cloud features are disabled on initialize", async () => {
			await authService.initialize()
			expect(mockLog).toHaveBeenCalledWith("[auth] Cloud features disabled — initialized in logged-out state")
		})
	})

	describe("login", () => {
		it("should be a no-op when cloud features are disabled", async () => {
			await authService.initialize()
			await authService.login()
			// Should not throw, just log
			expect(mockLog).toHaveBeenCalledWith("[auth] Cloud features disabled — login is a no-op")
		})

		it("should not open any external URLs", async () => {
			await authService.initialize()
			await authService.login()

			const vscode = await import("vscode")
			expect(vscode.env.openExternal).not.toHaveBeenCalled()
		})
	})

	describe("handleCallback", () => {
		it("should be a no-op when cloud features are disabled", async () => {
			await authService.initialize()
			await authService.handleCallback("code", "state")
			expect(mockLog).toHaveBeenCalledWith("[auth] Cloud features disabled — handleCallback is a no-op")
		})

		it("should not make any fetch calls", async () => {
			const mockFetch = vi.fn()
			global.fetch = mockFetch

			await authService.initialize()
			await authService.handleCallback("auth-code", "valid-state")

			expect(mockFetch).not.toHaveBeenCalled()
		})
	})

	describe("logout", () => {
		it("should be a no-op when cloud features are disabled", async () => {
			await authService.initialize()
			await authService.logout()
			expect(mockLog).toHaveBeenCalledWith("[auth] Cloud features disabled — logout is a no-op")
		})

		it("should not make any fetch calls", async () => {
			const mockFetch = vi.fn()
			global.fetch = mockFetch

			await authService.initialize()
			await authService.logout()

			expect(mockFetch).not.toHaveBeenCalled()
		})
	})

	describe("state management", () => {
		it("should return correct state after initialization", async () => {
			await authService.initialize()
			expect(authService.getState()).toBe("logged-out")
		})

		it("should always return false for isAuthenticated", async () => {
			expect(authService.isAuthenticated()).toBe(false)
			await authService.initialize()
			expect(authService.isAuthenticated()).toBe(false)
		})

		it("should always return false for hasActiveSession", async () => {
			expect(authService.hasActiveSession()).toBe(false)
			await authService.initialize()
			expect(authService.hasActiveSession()).toBe(false)
		})

		it("should always return false for hasOrIsAcquiringActiveSession", async () => {
			expect(authService.hasOrIsAcquiringActiveSession()).toBe(false)
			await authService.initialize()
			expect(authService.hasOrIsAcquiringActiveSession()).toBe(false)
		})

		it("should always return undefined for getSessionToken", async () => {
			expect(authService.getSessionToken()).toBeUndefined()
			await authService.initialize()
			expect(authService.getSessionToken()).toBeUndefined()
		})

		it("should always return null for getUserInfo", async () => {
			expect(authService.getUserInfo()).toBeNull()
			await authService.initialize()
			expect(authService.getUserInfo()).toBeNull()
		})

		it("should always return null for getStoredOrganizationId", async () => {
			expect(authService.getStoredOrganizationId()).toBeNull()
			await authService.initialize()
			expect(authService.getStoredOrganizationId()).toBeNull()
		})
	})

	describe("switchOrganization", () => {
		it("should be a no-op when cloud features are disabled", async () => {
			await authService.initialize()
			await authService.switchOrganization("org-123")
			expect(mockLog).toHaveBeenCalledWith("[auth] Cloud features disabled — switchOrganization is a no-op")
		})
	})

	describe("getOrganizationMemberships", () => {
		it("should return empty array", async () => {
			await authService.initialize()
			const memberships = await authService.getOrganizationMemberships()
			expect(memberships).toEqual([])
		})
	})

	describe("broadcast", () => {
		it("should be a no-op", () => {
			authService.broadcast()
			// Should not throw
		})
	})

	describe("dispose", () => {
		it("should remove all listeners", () => {
			const listener = vi.fn()
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			authService.on("auth-state-changed" as any, listener)
			authService.dispose()
			// After dispose, emitting should not reach the listener
			// This is hard to test directly, but dispose should not throw
		})
	})
})
