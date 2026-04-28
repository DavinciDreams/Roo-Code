import {
	loginWithAnthropicOAuth,
	clearAnthropicCredentials,
	loadAnthropicCredentials,
	getAnthropicCredentialsPath,
} from "@/lib/auth/anthropic-oauth.js"

export interface AnthropicLoginOptions {
	verbose?: boolean
}

export interface AnthropicAuthResult {
	success: boolean
	error?: string
}

export interface AnthropicStatusResult {
	authenticated: boolean
	expired?: boolean
	expiresAt?: Date
}

export async function anthropicLogin(options: AnthropicLoginOptions = {}): Promise<AnthropicAuthResult> {
	const result = await loginWithAnthropicOAuth({ verbose: options.verbose })

	if (result.success) {
		return { success: true }
	}

	return { success: false, error: result.error }
}

export async function anthropicLogout(): Promise<AnthropicAuthResult> {
	await clearAnthropicCredentials()
	console.log("✓ Logged out from Anthropic")
	return { success: true }
}

export async function anthropicStatus(options: { verbose?: boolean } = {}): Promise<AnthropicStatusResult> {
	const { verbose = false } = options
	const creds = await loadAnthropicCredentials()

	if (!creds) {
		console.log("✗ Not authenticated with Anthropic")
		console.log("")
		console.log("Run: roo auth anthropic login")
		return { authenticated: false }
	}

	const now = Math.floor(Date.now() / 1000)

	if (creds.expires_at && creds.expires_at < now) {
		console.log("✗ Anthropic token expired")
		console.log("")
		console.log("Run: roo auth anthropic login")
		return { authenticated: false, expired: true, expiresAt: new Date(creds.expires_at * 1000) }
	}

	console.log("✓ Authenticated with Anthropic (Claude Code Max)")

	if (creds.expires_at) {
		const remaining = creds.expires_at - now
		const days = Math.floor(remaining / 86400)
		const hours = Math.floor((remaining % 86400) / 3600)
		const label = days > 0 ? `${days} day${days !== 1 ? "s" : ""}` : `${hours} hour${hours !== 1 ? "s" : ""}`
		console.log(`  Expires in: ${label}`)
	}

	if (verbose) {
		console.log(`  Credentials: ${getAnthropicCredentialsPath()}`)
		if (creds.refresh_token) console.log("  Refresh token: present")
	}

	return {
		authenticated: true,
		expiresAt: creds.expires_at ? new Date(creds.expires_at * 1000) : undefined,
	}
}
