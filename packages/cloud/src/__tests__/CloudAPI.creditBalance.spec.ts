import { describe, it, expect, vi, beforeEach } from "vitest"
import { CloudAPI } from "../CloudAPI.js"
import { CloudAPIError } from "../errors.js"
import type { AuthService } from "@roo-code/types"

// Mock the config module
vi.mock("../config.js", () => ({
	getRooCodeApiUrl: () => "https://api.test.com",
}))

// Mock the utils module
vi.mock("../utils.js", () => ({
	getUserAgent: () => "test-user-agent",
}))

describe("CloudAPI.creditBalance", () => {
	let mockAuthService: {
		getSessionToken: ReturnType<typeof vi.fn>
	}
	let cloudAPI: CloudAPI

	beforeEach(() => {
		mockAuthService = {
			getSessionToken: vi.fn(),
		}
		cloudAPI = new CloudAPI(mockAuthService as unknown as AuthService)

		// Reset fetch mock
		global.fetch = vi.fn()
	})

	it("should throw CloudAPIError when cloud features are disabled", async () => {
		await expect(cloudAPI.creditBalance()).rejects.toThrow(CloudAPIError)
		await expect(cloudAPI.creditBalance()).rejects.toThrow("Cloud features are disabled in this fork")
	})

	it("should throw CloudAPIError regardless of session token", async () => {
		mockAuthService.getSessionToken.mockReturnValue("test-session-token")
		await expect(cloudAPI.creditBalance()).rejects.toThrow(CloudAPIError)
	})

	it("should not make any fetch calls", async () => {
		const fetchSpy = vi.fn()
		global.fetch = fetchSpy

		try {
			await cloudAPI.creditBalance()
		} catch {
			// Expected to throw
		}

		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("should throw CloudAPIError when session token is missing", async () => {
		mockAuthService.getSessionToken.mockReturnValue(undefined)
		await expect(cloudAPI.creditBalance()).rejects.toThrow(CloudAPIError)
	})

	it("should throw CloudAPIError on network errors", async () => {
		mockAuthService.getSessionToken.mockReturnValue("test-session-token")
		global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
		await expect(cloudAPI.creditBalance()).rejects.toThrow(CloudAPIError)
	})
})
