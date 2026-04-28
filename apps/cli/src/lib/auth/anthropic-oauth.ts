import http from "http"
import { createHash, randomBytes } from "crypto"
import net from "net"
import { exec } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const ANTHROPIC_AUTH_URL = "https://claude.com/cai/oauth/authorize"
const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const ANTHROPIC_SCOPES = "user:profile user:inference"
const LOCALHOST = "127.0.0.1"

const CREDENTIALS_FILE = path.join(os.homedir(), ".roo", "anthropic-credentials.json")

export interface AnthropicCredentials {
	access_token: string
	refresh_token?: string
	expires_at?: number
	token_type: string
}

export async function saveAnthropicCredentials(creds: AnthropicCredentials): Promise<void> {
	const dir = path.dirname(CREDENTIALS_FILE)
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export async function loadAnthropicCredentials(): Promise<AnthropicCredentials | null> {
	try {
		const data = await fs.readFile(CREDENTIALS_FILE, "utf-8")
		return JSON.parse(data) as AnthropicCredentials
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
		throw err
	}
}

export async function clearAnthropicCredentials(): Promise<void> {
	try {
		await fs.unlink(CREDENTIALS_FILE)
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
	}
}

export function getAnthropicCredentialsPath(): string {
	return CREDENTIALS_FILE
}

function isExpired(creds: AnthropicCredentials, bufferSeconds = 300): boolean {
	if (!creds.expires_at) return false
	return creds.expires_at < Math.floor(Date.now() / 1000) + bufferSeconds
}

async function doRefreshToken(refreshToken: string): Promise<AnthropicCredentials> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: ANTHROPIC_CLIENT_ID,
	})

	const response = await fetch(ANTHROPIC_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	})

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(`Token refresh failed (${response.status}): ${text}`)
	}

	const data = (await response.json()) as {
		access_token: string
		refresh_token?: string
		expires_in?: number
		token_type: string
	}

	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token ?? refreshToken,
		expires_at: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
		token_type: data.token_type,
	}
}

/**
 * Returns a valid access token, refreshing automatically if it is expired.
 * Returns null if no credentials are stored or the token cannot be refreshed.
 */
export async function getValidAnthropicToken(): Promise<string | null> {
	const creds = await loadAnthropicCredentials()
	if (!creds) return null
	if (!isExpired(creds)) return creds.access_token

	if (creds.refresh_token) {
		try {
			const refreshed = await doRefreshToken(creds.refresh_token)
			await saveAnthropicCredentials(refreshed)
			return refreshed.access_token
		} catch {
			return null
		}
	}

	return null
}

export interface AnthropicLoginOptions {
	timeout?: number
	verbose?: boolean
}

/**
 * Runs the PKCE OAuth flow for Anthropic (Claude Code Max).
 * Opens a browser to authenticate, waits for the callback, exchanges the
 * code for tokens, and persists them to ~/.roo/anthropic-credentials.json.
 */
export async function loginWithAnthropicOAuth(
	opts: AnthropicLoginOptions = {},
): Promise<{ success: true; token: string } | { success: false; error: string }> {
	const { timeout = 5 * 60 * 1000, verbose = false } = opts

	const codeVerifier = randomBytes(32).toString("base64url")
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url")
	const state = randomBytes(16).toString("hex")
	const port = await getAvailablePort()
	const redirectUri = `http://${LOCALHOST}:${port}/callback`

	if (verbose) console.log(`[Auth] Listening for callback on port ${port}`)

	const codePromise = new Promise<string>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url!, `http://${LOCALHOST}:${port}`)

			if (url.pathname !== "/callback") {
				res.writeHead(404).end()
				return
			}

			const receivedState = url.searchParams.get("state")
			const code = url.searchParams.get("code")
			const error = url.searchParams.get("error")

			const html = (msg: string) =>
				`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:2rem"><h2>${msg}</h2><p>You can close this window.</p></body></html>`

			if (error) {
				res.writeHead(200, { "Content-Type": "text/html" }).end(html("Authentication failed: " + error))
				server.close(() => reject(new Error(error)))
				return
			}

			if (receivedState !== state) {
				res.writeHead(200, { "Content-Type": "text/html" }).end(html("Invalid state parameter"))
				server.close(() => reject(new Error("Invalid state parameter")))
				return
			}

			if (!code) {
				res.writeHead(200, { "Content-Type": "text/html" }).end(html("No authorization code received"))
				server.close(() => reject(new Error("No authorization code received")))
				return
			}

			res.writeHead(200, { "Content-Type": "text/html" }).end(html("Authenticated! You can close this window."))
			server.close(() => resolve(code))
		})

		server.listen(port, LOCALHOST)

		const timeoutId = setTimeout(() => {
			server.close(() => reject(new Error("Authentication timed out")))
		}, timeout)

		server.on("close", () => clearTimeout(timeoutId))
	})

	const authUrl = new URL(ANTHROPIC_AUTH_URL)
	authUrl.searchParams.set("response_type", "code")
	authUrl.searchParams.set("client_id", ANTHROPIC_CLIENT_ID)
	authUrl.searchParams.set("redirect_uri", redirectUri)
	authUrl.searchParams.set("scope", ANTHROPIC_SCOPES)
	authUrl.searchParams.set("state", state)
	authUrl.searchParams.set("code_challenge", codeChallenge)
	authUrl.searchParams.set("code_challenge_method", "S256")

	console.log("Opening browser for Anthropic authentication...")
	console.log(`If the browser does not open, visit:\n  ${authUrl.toString()}\n`)

	try {
		await openBrowser(authUrl.toString())
	} catch {
		if (verbose) console.warn("[Auth] Could not open browser automatically")
	}

	let code: string
	try {
		code = await codePromise
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error(`✗ Authentication failed: ${message}`)
		return { success: false, error: message }
	}

	try {
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: ANTHROPIC_CLIENT_ID,
			code_verifier: codeVerifier,
		})

		const response = await fetch(ANTHROPIC_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		})

		if (!response.ok) {
			const text = await response.text().catch(() => "")
			const error = `Token exchange failed (${response.status}): ${text}`
			console.error(`✗ ${error}`)
			return { success: false, error }
		}

		const data = (await response.json()) as {
			access_token: string
			refresh_token?: string
			expires_in?: number
			token_type: string
		}

		const creds: AnthropicCredentials = {
			access_token: data.access_token,
			refresh_token: data.refresh_token,
			expires_at: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
			token_type: data.token_type,
		}

		await saveAnthropicCredentials(creds)
		console.log("✓ Authenticated with Anthropic!")
		return { success: true, token: creds.access_token }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error(`✗ Authentication failed: ${message}`)
		return { success: false, error: message }
	}
}

async function getAvailablePort(start = 49152, end = 65535): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		let port = start

		const tryPort = () => {
			server.once("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE" && port < end) {
					port++
					tryPort()
				} else {
					reject(err)
				}
			})
			server.once("listening", () => server.close(() => resolve(port)))
			server.listen(port, LOCALHOST)
		}

		tryPort()
	})
}

function openBrowser(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const cmd =
			process.platform === "darwin"
				? `open "${url}"`
				: process.platform === "win32"
					? `start "" "${url}"`
					: `xdg-open "${url}"`

		exec(cmd, (err) => (err ? reject(err) : resolve()))
	})
}
