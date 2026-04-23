import type { MarketplaceItem, MarketplaceItemType } from "@roo-code/types"

/**
 * RemoteConfigLoader — cloud features disabled.
 *
 * All methods that would fetch from app.roocode.com return empty arrays.
 * No HTTP requests are made to upstream servers.
 */
export class RemoteConfigLoader {
	private cache: Map<string, { data: MarketplaceItem[]; timestamp: number }> = new Map()
	private cacheDuration = 5 * 60 * 1000 // 5 minutes

	constructor() {
		// Cloud features disabled — no API base URL needed
	}

	async loadAllItems(_hideMarketplaceMcps = false): Promise<MarketplaceItem[]> {
		// Cloud features disabled — return empty array, no HTTP calls
		return []
	}

	private async fetchModes(): Promise<MarketplaceItem[]> {
		// Cloud features disabled — return empty array
		return []
	}

	private async fetchMcps(): Promise<MarketplaceItem[]> {
		// Cloud features disabled — return empty array
		return []
	}

	async getItem(id: string, type: MarketplaceItemType): Promise<MarketplaceItem | null> {
		// Cloud features disabled — no items available
		return null
	}

	private getFromCache(key: string): MarketplaceItem[] | null {
		const cached = this.cache.get(key)
		if (!cached) return null

		const now = Date.now()
		if (now - cached.timestamp > this.cacheDuration) {
			this.cache.delete(key)
			return null
		}

		return cached.data
	}

	private setCache(key: string, data: MarketplaceItem[]): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		})
	}

	clearCache(): void {
		this.cache.clear()
	}
}
