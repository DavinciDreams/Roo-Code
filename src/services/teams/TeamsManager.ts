import * as fs from "fs/promises"
import * as path from "path"

import type { TeamConfig } from "@roo-code/types"
import type { ClineProvider } from "../../core/webview/ClineProvider"

export class TeamsManager {
	private teams: Map<string, TeamConfig> = new Map()
	private providerRef: WeakRef<ClineProvider>

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
	}

	async initialize(): Promise<void> {
		await this.discoverTeams()
	}

	/**
	 * Scan .roo/teams/*.json in the current workspace and cache all valid TeamConfig objects.
	 * Non-fatal: missing directory or malformed files are silently skipped.
	 */
	async discoverTeams(): Promise<void> {
		this.teams.clear()
		const provider = this.providerRef.deref()
		if (!provider) return

		const teamsDir = path.join(provider.cwd, ".roo", "teams")

		let entries: import("fs").Dirent[]
		try {
			entries = await fs.readdir(teamsDir, { withFileTypes: true, encoding: "utf-8" })
		} catch {
			// Directory doesn't exist — normal for projects without teams
			return
		}

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue
			const filePath = path.join(teamsDir, entry.name)
			try {
				const raw = await fs.readFile(filePath, "utf-8")
				const config = JSON.parse(raw) as TeamConfig
				if (typeof config.slug === "string" && config.slug && Array.isArray(config.phases)) {
					config.$source = filePath
					this.teams.set(config.slug, config)
				}
			} catch {
				// Malformed JSON or missing required fields — skip silently
			}
		}
	}

	getTeamConfig(slug: string): TeamConfig | undefined {
		return this.teams.get(slug)
	}

	listTeams(): TeamConfig[] {
		return Array.from(this.teams.values())
	}

	/** Reload all team configs from disk (e.g., after a file-system change). */
	async refresh(): Promise<void> {
		await this.discoverTeams()
	}
}
