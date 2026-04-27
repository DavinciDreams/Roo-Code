import type { ExtensionContext } from "vscode"

import type { AuthService } from "@roo-code/types"

import { CloudSettingsService } from "../CloudSettingsService.js"

describe("CloudSettingsService", () => {
	let mockContext: ExtensionContext
	let mockAuthService: AuthService
	let cloudSettingsService: CloudSettingsService
	let mockLog: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as ExtensionContext

		mockAuthService = {
			getState: vi.fn().mockReturnValue("logged-out"),
			getSessionToken: vi.fn(),
			hasActiveSession: vi.fn().mockReturnValue(false),
			on: vi.fn(),
			getStoredOrganizationId: vi.fn().mockReturnValue(null),
		} as unknown as AuthService

		mockLog = vi.fn()

		cloudSettingsService = new CloudSettingsService(mockContext, mockAuthService, mockLog)
	})

	afterEach(() => {
		cloudSettingsService.dispose()
	})

	describe("constructor", () => {
		it("should create CloudSettingsService with proper dependencies", () => {
			expect(cloudSettingsService).toBeInstanceOf(CloudSettingsService)
		})

		it("should use console.log as default logger when none provided", () => {
			const service = new CloudSettingsService(mockContext, mockAuthService)
			expect(service).toBeInstanceOf(CloudSettingsService)
			service.dispose()
		})

		it("should log that cloud features are disabled", () => {
			expect(mockLog).toHaveBeenCalledWith(
				"[cloud-settings] Cloud features disabled — CloudSettingsService is a no-op",
			)
		})
	})

	describe("initialize", () => {
		it("should be a no-op", async () => {
			await cloudSettingsService.initialize()
			expect(mockLog).toHaveBeenCalledWith("[cloud-settings] Cloud features disabled — initialize is a no-op")
		})
	})

	describe("getAllowList", () => {
		it("should return default allow all when cloud features are disabled", () => {
			const allowList = cloudSettingsService.getAllowList()
			expect(allowList).toEqual({ allowAll: true, providers: {} })
		})
	})

	describe("getSettings", () => {
		it("should return undefined when cloud features are disabled", () => {
			const settings = cloudSettingsService.getSettings()
			expect(settings).toBeUndefined()
		})

		it("should return undefined even after initialization", async () => {
			await cloudSettingsService.initialize()
			const settings = cloudSettingsService.getSettings()
			expect(settings).toBeUndefined()
		})
	})

	describe("getUserSettings", () => {
		it("should return undefined when cloud features are disabled", () => {
			const userSettings = cloudSettingsService.getUserSettings()
			expect(userSettings).toBeUndefined()
		})
	})

	describe("getUserFeatures", () => {
		it("should return empty object when cloud features are disabled", () => {
			const features = cloudSettingsService.getUserFeatures()
			expect(features).toEqual({})
		})
	})

	describe("getUserSettingsConfig", () => {
		it("should return empty object when cloud features are disabled", () => {
			const config = cloudSettingsService.getUserSettingsConfig()
			expect(config).toEqual({})
		})
	})

	describe("updateUserSettings", () => {
		it("should return false when cloud features are disabled", async () => {
			const result = await cloudSettingsService.updateUserSettings({})
			expect(result).toBe(false)
		})
	})

	describe("isTaskSyncEnabled", () => {
		it("should return false when cloud features are disabled", () => {
			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(false)
		})

		it("should always return false regardless of settings", async () => {
			await cloudSettingsService.initialize()
			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(false)
		})
	})

	describe("dispose", () => {
		it("should remove all listeners", () => {
			const removeAllListenersSpy = vi.spyOn(cloudSettingsService, "removeAllListeners")

			cloudSettingsService.dispose()

			expect(removeAllListenersSpy).toHaveBeenCalled()
		})
	})
})
