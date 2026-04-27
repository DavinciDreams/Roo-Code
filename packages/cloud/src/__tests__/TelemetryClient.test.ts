/* eslint-disable @typescript-eslint/no-explicit-any */

// npx vitest run src/__tests__/TelemetryClient.test.ts

import { type TelemetryPropertiesProvider, TelemetryEventName } from "@roo-code/types"

import { CloudTelemetryClient as TelemetryClient } from "../TelemetryClient.js"

const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe("TelemetryClient", () => {
	const getPrivateProperty = <T>(instance: any, propertyName: string): T => {
		return instance[propertyName]
	}

	let mockAuthService: any
	let mockSettingsService: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock AuthService instead of using the singleton
		mockAuthService = {
			getSessionToken: vi.fn().mockReturnValue("mock-token"),
			getState: vi.fn().mockReturnValue("active-session"),
			isAuthenticated: vi.fn().mockReturnValue(true),
			hasActiveSession: vi.fn().mockReturnValue(true),
		}

		// Create a mock SettingsService
		mockSettingsService = {
			getSettings: vi.fn().mockReturnValue({
				cloudSettings: {
					recordTaskMessages: true,
				},
			}),
			getUserSettings: vi.fn().mockReturnValue({
				features: {},
				settings: {
					taskSyncEnabled: true,
				},
				version: 1,
			}),
			isTaskSyncEnabled: vi.fn().mockReturnValue(true),
		}

		mockFetch.mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		})

		vi.spyOn(console, "info").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("isEventCapturable", () => {
		it("should return true for events not in exclude list", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CREATED)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.LLM_COMPLETION)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.MODE_SWITCH)).toBe(true)
			expect(isEventCapturable(TelemetryEventName.TOOL_USED)).toBe(true)
		})

		it("should return false for events in exclude list", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			expect(isEventCapturable(TelemetryEventName.TASK_CONVERSATION_MESSAGE)).toBe(false)
		})

		it("should return true for TASK_MESSAGE events (not in exclude list)", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const isEventCapturable = getPrivateProperty<(eventName: TelemetryEventName) => boolean>(
				client,
				"isEventCapturable",
			).bind(client)

			// TASK_MESSAGE is not in the exclude list, so base class returns true
			expect(isEventCapturable(TelemetryEventName.TASK_MESSAGE)).toBe(true)
		})
	})

	describe("getEventProperties", () => {
		it("should merge provider properties with event properties", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
					vscodeVersion: "1.60.0",
					platform: "darwin",
					editorName: "vscode",
					language: "en",
					mode: "code",
				}),
			}

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: {
					customProp: "value",
					mode: "override", // This should override the provider's mode.
				},
			})

			expect(result).toEqual({
				appVersion: "1.0.0",
				vscodeVersion: "1.60.0",
				platform: "darwin",
				editorName: "vscode",
				language: "en",
				mode: "override", // Event property takes precedence.
				customProp: "value",
			})

			expect(mockProvider.getTelemetryProperties).toHaveBeenCalledTimes(1)
		})

		it("should handle errors from provider gracefully", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockRejectedValue(new Error("Provider error")),
			}

			const consoleErrorSpy = vi.spyOn(console, "error")

			client.setProvider(mockProvider)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({ customProp: "value" })
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error getting telemetry properties: Provider error"),
			)
		})

		it("should return event properties when no provider is set", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const getEventProperties = getPrivateProperty<
				(event: { event: TelemetryEventName; properties?: Record<string, any> }) => Promise<Record<string, any>>
			>(client, "getEventProperties").bind(client)

			const result = await getEventProperties({
				event: TelemetryEventName.TASK_CREATED,
				properties: { customProp: "value" },
			})

			expect(result).toEqual({ customProp: "value" })
		})
	})

	describe("capture", () => {
		it("should not send any requests (cloud features disabled)", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_CREATED,
				properties: { test: "value" },
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not send requests for TASK_MESSAGE events", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: {
					taskId: "test-task-id",
					message: { ts: 1, type: "say", say: "text", text: "test message" },
				},
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not send requests for TASK_CONVERSATION_MESSAGE events", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.capture({
				event: TelemetryEventName.TASK_CONVERSATION_MESSAGE,
				properties: { test: "value" },
			})

			expect(mockFetch).not.toHaveBeenCalled()
		})
	})

	describe("telemetry state methods", () => {
		it("should always return false for isTelemetryEnabled", () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			expect(client.isTelemetryEnabled()).toBe(false)
		})

		it("should have empty implementations for updateTelemetryState and shutdown", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)
			client.updateTelemetryState(true)
			await client.shutdown()
			// Should not throw
		})
	})

	describe("backfillMessages", () => {
		it("should not send any requests (cloud features disabled)", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not send request even when authenticated", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should not send request even with provider set", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			const mockProvider: TelemetryPropertiesProvider = {
				getTelemetryProperties: vi.fn().mockResolvedValue({
					appVersion: "1.0.0",
				}),
			}

			client.setProvider(mockProvider)

			const messages = [
				{
					ts: 1,
					type: "say" as const,
					say: "text" as const,
					text: "test message",
				},
			]

			await client.backfillMessages(messages, "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
		})

		it("should handle empty messages array without sending requests", async () => {
			const client = new TelemetryClient(mockAuthService, mockSettingsService)

			await client.backfillMessages([], "test-task-id")

			expect(mockFetch).not.toHaveBeenCalled()
		})
	})
})
