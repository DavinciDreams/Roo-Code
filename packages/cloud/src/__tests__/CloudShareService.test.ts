/* eslint-disable @typescript-eslint/no-explicit-any */

import type { MockedFunction } from "vitest"

import type { SettingsService, AuthService } from "@roo-code/types"

import { CloudAPI } from "../CloudAPI.js"
import { CloudShareService } from "../CloudShareService.js"

vi.mock("../Config", () => ({
	getRooCodeApiUrl: () => "https://app.roocode.com",
}))

vi.mock("../utils", () => ({
	getUserAgent: () => "Roo-Code 1.0.0",
}))

describe("CloudShareService", () => {
	let shareService: CloudShareService
	let mockAuthService: AuthService
	let mockSettingsService: SettingsService
	let mockCloudAPI: CloudAPI
	let mockLog: MockedFunction<(...args: unknown[]) => void>

	beforeEach(() => {
		vi.clearAllMocks()

		mockLog = vi.fn()
		mockAuthService = {
			hasActiveSession: vi.fn(),
			getSessionToken: vi.fn(),
			isAuthenticated: vi.fn(),
		} as any

		mockSettingsService = {
			getSettings: vi.fn(),
		} as any

		mockCloudAPI = new CloudAPI(mockAuthService, mockLog)

		shareService = new CloudShareService(mockCloudAPI, mockSettingsService, mockLog)
	})

	describe("shareTask", () => {
		it("should throw error when cloud features are disabled", async () => {
			await expect(shareService.shareTask("task-123", "organization")).rejects.toThrow(
				"Cloud features are disabled in this fork",
			)
		})

		it("should throw error for public visibility", async () => {
			await expect(shareService.shareTask("task-123", "public")).rejects.toThrow(
				"Cloud features are disabled in this fork",
			)
		})

		it("should throw error with default visibility", async () => {
			await expect(shareService.shareTask("task-123")).rejects.toThrow("Cloud features are disabled in this fork")
		})

		it("should not make any fetch calls", async () => {
			const mockFetch = vi.fn()
			global.fetch = mockFetch as any

			try {
				await shareService.shareTask("task-123", "organization")
			} catch {
				// Expected to throw
			}

			expect(mockFetch).not.toHaveBeenCalled()
		})
	})

	describe("canShareTask", () => {
		it("should return false when cloud features are disabled", async () => {
			const result = await shareService.canShareTask()
			expect(result).toBe(false)
		})

		it("should return false regardless of authentication state", async () => {
			;(mockAuthService.isAuthenticated as any).mockReturnValue(true)
			const result = await shareService.canShareTask()
			expect(result).toBe(false)
		})

		it("should return false regardless of settings", async () => {
			;(mockSettingsService.getSettings as any).mockReturnValue({
				cloudSettings: {
					enableTaskSharing: true,
				},
			})
			const result = await shareService.canShareTask()
			expect(result).toBe(false)
		})
	})

	describe("canSharePublicly", () => {
		it("should return false when cloud features are disabled", async () => {
			const result = await shareService.canSharePublicly()
			expect(result).toBe(false)
		})
	})
})
