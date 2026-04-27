# Morse Code Cloud Backend — Implementation Plan

**Status:** Planned — future feature branch (`feature/morse-cloud-backend`)

The extension's cloud package (`packages/cloud/`) was disabled in the standalone fork (PR #4).
This document sketches what's needed to re-enable it against a Morse Code backend.

---

## Prerequisites

| Item                                | Status                                          |
| ----------------------------------- | ----------------------------------------------- |
| Clerk account                       | ✓ Done                                          |
| `CLERK_BASE_URL` in .env            | ✓ Done (`closing-mantis-16.clerk.accounts.dev`) |
| Restore stubbed cloud code from git | Pending                                         |
| Morse Code backend deployed         | Pending                                         |
| Sign-in landing page                | Pending                                         |

---

## Step 1 — Restore stubbed cloud code

Three files were gutted in PR #4 and need to be restored from git history:

```bash
git show 2fc779842^:packages/cloud/src/WebAuthService.ts > packages/cloud/src/WebAuthService.ts
git show 2fc779842^:packages/cloud/src/TelemetryClient.ts > packages/cloud/src/TelemetryClient.ts
git show 2fc779842^:packages/cloud/src/retry-queue/RetryQueue.ts > packages/cloud/src/retry-queue/RetryQueue.ts
```

Then update `packages/cloud/src/config.ts` to point at the Morse Code backend:

```ts
export const PRODUCTION_CLERK_BASE_URL = "https://closing-mantis-16.clerk.accounts.dev"
export const PRODUCTION_ROO_CODE_API_URL = "https://api.morse-code.com"
```

---

## Step 2 — Backend API (9 endpoints)

The extension calls two base URLs — Clerk (auth) and the Morse Code API (everything else).

### Clerk handles automatically (no backend code needed)

| Method | Path                              | Purpose                     |
| ------ | --------------------------------- | --------------------------- |
| `POST` | `/v1/client/sign_ins`             | Exchange ticket → sessionId |
| `POST` | `/v1/client/sessions/{id}/tokens` | sessionId → JWT             |
| `GET`  | `/v1/me`                          | Current user info           |
| `GET`  | `/v1/me/organization_memberships` | Org list                    |
| `POST` | `/v1/client/sessions/{id}/remove` | Logout                      |

### Morse Code API to build

#### Auth flow glue

```
GET /extension/sign-in?state={csrf}
```

Landing page that starts the Clerk OAuth flow and redirects back to the extension
with `vscode://morse-code/auth?code={ticket}&state={csrf}`.

#### Settings

```
GET  /api/extension-settings
Authorization: Bearer {jwt}
→ { organization: OrganizationSettings, user: UserSettingsData }

PATCH /api/user-settings
Authorization: Bearer {jwt}
Body: { settings: Partial<UserSettingsConfig>, version?: number }
→ UserSettingsData
```

`OrganizationSettings` shape (from `packages/types/src/`):

```ts
{
  version: number
  cloudSettings: { taskSyncEnabled: boolean }
  defaultSettings: GlobalSettings
  allowList: string[]           // allowed shell commands
  features: Record<string, boolean>
  hiddenMcps: string[]
}
```

#### Telemetry

```
POST /api/events
Authorization: Bearer {jwt}
Body: { type: TelemetryEventName, properties: Record<string, unknown> }

POST /api/events/backfill
Authorization: Bearer {jwt}
Body: FormData { taskId, properties (JSON string), file (JSON array of ClineMessage[]) }
```

Return `429` with `Retry-After` header to rate-limit — the client will pause and retry automatically.

#### Task sharing

```
POST /api/extension/share
Authorization: Bearer {jwt}
Body: { taskId: string, visibility: "organization" | "public" }
→ { success: boolean, shareUrl?: string, isNewShare?: boolean, manageUrl?: string }
```

Return `404` if `taskId` is unknown — the extension will automatically backfill the message
history via `/api/events/backfill` and retry.

#### Optional / lower priority

```
GET /api/extension/credit-balance
→ { balance: number }

GET /api/extension/bridge/config
→ { userId: string, socketBridgeUrl: string, token: string }
```

---

## Step 3 — JWT verification

All `/api/*` routes must verify the Clerk JWT. Use the Clerk backend SDK:

```ts
import { createClerkClient } from "@clerk/backend"

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

async function verifyToken(req) {
	const token = req.headers.authorization?.replace("Bearer ", "")
	const payload = await clerk.verifyToken(token)
	return { userId: payload.sub, orgId: payload.org_id }
}
```

---

## Step 4 — Sign-in landing page

The simplest approach is a single Next.js route (or Express endpoint):

```
/extension/sign-in?state={csrf}&landingPageSlug={slug}
```

1. Start Clerk sign-in with `strategy: "oauth_google"` (or show a sign-in form)
2. On success, get the one-time ticket from Clerk
3. Redirect to `vscode://morse-code/auth?code={ticket}&state={csrf}`

The extension's `handleCallback()` takes it from there.

---

## Tech stack recommendation

| Layer          | Recommendation                                            |
| -------------- | --------------------------------------------------------- |
| Runtime        | Node.js (Bun or Express) — Clerk SDK is Node-first        |
| Auth           | Clerk (already have account)                              |
| Database       | Postgres (for settings, task shares, telemetry)           |
| Hosting        | Fly.io / Railway / Vercel (easy Postgres integration)     |
| Telemetry sink | Write to DB initially; swap for ClickHouse later at scale |

---

## Environment variables summary

```bash
# Extension (.env at repo root)
CLERK_BASE_URL=https://closing-mantis-16.clerk.accounts.dev
ROO_CODE_API_URL=https://api.morse-code.com

# Backend server
CLERK_SECRET_KEY=sk_test_...
DATABASE_URL=postgres://...
```
