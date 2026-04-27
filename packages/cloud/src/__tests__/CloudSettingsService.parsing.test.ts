// pnpm test src/__tests__/CloudSettingsService.parsing.test.ts

import type { ExtensionContext } from "vscode"

import type { AuthService } from "@roo-code/types"

import { CloudSettingsService } from "../CloudSettingsService.js"

describe("CloudSettingsService - Response Parsing", () => {
	let mockContext: ExtensionContext
	let mockAuthService: AuthService
	let service: CloudSettingsService

	beforeEach(() => {
		// Mock ExtensionContext
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as ExtensionContext

		// Mock AuthService with active session
		mockAuthService = {
			getState: vi.fn().mockReturnValue("active-session"),
			hasActiveSession: vi.fn().mockReturnValue(true),
			getSessionToken: vi.fn().mockReturnValue("test-token"),
			on: vi.fn(),
			removeListener: vi.fn(),
		} as unknown as AuthService

		service = new CloudSettingsService(mockContext, mockAuthService, vi.fn())
	})

	afterEach(() => {
		service.dispose()
	})

	it("should return undefined settings when cloud features are disabled", async () => {
		await service.initialize()

		const orgSettings = service.getSettings()
		const userSettings = service.getUserSettings()

		expect(orgSettings).toBeUndefined()
		expect(userSettings).toBeUndefined()
	})

	it("should not make fetch calls when cloud features are disabled", async () => {
		const mockFetch = vi.fn()
		global.fetch = mockFetch

		await service.initialize()

		// Wait a bit to ensure no async fetch calls are made
		await new Promise((resolve) => setTimeout(resolve, 50))

		expect(mockFetch).not.toHaveBeenCalled()
	})

	it("should return undefined settings regardless of response data", async () => {
		// Even if fetch is mocked with valid data, settings should be undefined
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				organization: {
					version: 1,
					defaultSettings: {},
					allowList: { allowAll: true, providers: {} },
				},
				user: {
					features: {},
					settings: {},
					version: 1,
				},
			}),
		})

		await service.initialize()

		await new Promise((resolve) => setTimeout(resolve, 50))

		const orgSettings = service.getSettings()
		const userSettings = service.getUserSettings()

		expect(orgSettings).toBeUndefined()
		expect(userSettings).toBeUndefined()
	})
})
