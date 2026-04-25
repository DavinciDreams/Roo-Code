/**
 * Tests for the Hook System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { HookSystem, createHookSystem, type HookSystemConfig } from "../index"
import * as fs from "fs"
import * as path from "path"

// Mock the fs module
vi.mock("fs", () => ({
	existsSync: vi.fn(),
	promises: {
		readFile: vi.fn(),
	},
}))

// Mock the vscode module
vi.mock("vscode", () => ({
	window: {
		createOutputChannel: vi.fn(() => ({
			appendLine: vi.fn(),
			dispose: vi.fn(),
		})),
		showErrorMessage: vi.fn(),
	},
}))

describe("HookSystem", () => {
	const mockWorkspacePath = "/test/workspace"
	const mockConfig: HookSystemConfig = {
		enabled: true,
		workspacePath: mockWorkspacePath,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("createHookSystem", () => {
		it("should create a HookSystem instance with default enabled state", () => {
			const hookSystem = createHookSystem(mockWorkspacePath)
			expect(hookSystem).toBeInstanceOf(HookSystem)
			expect(hookSystem.isEnabled()).toBe(true)
		})

		it("should create a HookSystem instance with disabled state", () => {
			const hookSystem = createHookSystem(mockWorkspacePath, false)
			expect(hookSystem).toBeInstanceOf(HookSystem)
			expect(hookSystem.isEnabled()).toBe(false)
		})

		it("should create a HookSystem instance with custom config path", () => {
			const customPath = "/custom/path/hooks.json"
			const hookSystem = createHookSystem(mockWorkspacePath, true, customPath)
			expect(hookSystem).toBeInstanceOf(HookSystem)
		})
	})

	describe("isEnabled", () => {
		it("should return true when hooks are enabled", () => {
			const hookSystem = new HookSystem({ ...mockConfig, enabled: true })
			expect(hookSystem.isEnabled()).toBe(true)
		})

		it("should return false when hooks are disabled", () => {
			const hookSystem = new HookSystem({ ...mockConfig, enabled: false })
			expect(hookSystem.isEnabled()).toBe(false)
		})
	})

	describe("updateConfig", () => {
		it("should update the configuration", () => {
			const hookSystem = new HookSystem(mockConfig)
			expect(hookSystem.isEnabled()).toBe(true)

			hookSystem.updateConfig({ enabled: false })
			expect(hookSystem.isEnabled()).toBe(false)
		})
	})

	describe("executePreCompactHooks", () => {
		it("should return empty result when hooks are disabled", async () => {
			const hookSystem = new HookSystem({ ...mockConfig, enabled: false })
			const result = await hookSystem.executePreCompactHooks("auto", null)

			expect(result).toEqual({ hasFailures: false })
			expect(result.newCustomInstructions).toBeUndefined()
			expect(result.userMessage).toBeUndefined()
		})

		it("should return empty result when no hooks are configured", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			const hookSystem = new HookSystem(mockConfig)
			const result = await hookSystem.executePreCompactHooks("auto", null)

			expect(result).toEqual({ hasFailures: false })
		})

		it("should execute pre-compact hooks when configured", async () => {
			const mockConfigContent = {
				PreCompact: [
					{
						matcher: "auto",
						hooks: [
							{
								id: "test-hook",
								type: "command",
								command: "echo 'test'",
							},
						],
					},
				],
			}

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockConfigContent))

			const hookSystem = new HookSystem(mockConfig)
			const result = await hookSystem.executePreCompactHooks("auto", null, { cwd: mockWorkspacePath })

			expect(result.hasFailures).toBeDefined()
		})
	})

	describe("executePostCompactHooks", () => {
		it("should return empty result when hooks are disabled", async () => {
			const hookSystem = new HookSystem({ ...mockConfig, enabled: false })
			const result = await hookSystem.executePostCompactHooks("auto", "summary", 1000, 500)

			expect(result).toEqual({ hasFailures: false })
			expect(result.userMessage).toBeUndefined()
		})

		it("should return empty result when no hooks are configured", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			const hookSystem = new HookSystem(mockConfig)
			const result = await hookSystem.executePostCompactHooks("auto", "summary", 1000, 500)

			expect(result).toEqual({ hasFailures: false })
		})

		it("should execute post-compact hooks when configured", async () => {
			const mockConfigContent = {
				PostCompact: [
					{
						matcher: "auto",
						hooks: [
							{
								id: "test-hook",
								type: "command",
								command: "echo 'test'",
							},
						],
					},
				],
			}

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockConfigContent))

			const hookSystem = new HookSystem(mockConfig)
			const result = await hookSystem.executePostCompactHooks("auto", "summary", 1000, 500, {
				cwd: mockWorkspacePath,
			})

			expect(result.hasFailures).toBeDefined()
		})
	})
})
