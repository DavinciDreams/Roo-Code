# PRD: Swarm / True Multi-Agent Execution in Morse Code

**Status:** In progress — P1, PT, P2, P3, P4, P5 shipped  
**Author:** davincidreams  
**Branch:** `feat/swarm-prd`  
**Created:** 2026-04-25  
**Last updated:** 2026-04-25

---

## 1. Problem Statement

~~Morse Code today runs tasks **strictly sequentially**.~~ **Phase 1 shipped** — `clineStack` has
been replaced with `tasks: Map<string, Task>` and true concurrent fan-out is available via
`spawn_parallel_tasks` with `concurrent: true`. The remaining problem is the higher phases:
agent identity, cross-agent communication, permission bridging, and external process backends.

The original problem for context:

> When `spawn_parallel_tasks` was used, children executed one at a time via a queued delegation
> chain (`parallelQueue` on `HistoryItem`). The root cause was the `clineStack: Task[]` LIFO
> invariant in `ClineProvider`, which enforced "only one task open at a time" and disposed the
> parent before the child started. A 4-task "parallel" job took 4× the wall-clock time of the
> longest subtask.

The goal of this PRD is to close the gap with claude-code's **swarm/teammate** architecture and
deliver genuine multi-instance, multi-agent execution inside Morse Code.

---

## 2. Goals

| #   | Goal                         | Success metric                                            |
| --- | ---------------------------- | --------------------------------------------------------- |
| G1  | True in-process concurrency  | N tasks run simultaneously, wall time ≈ max(subtask time) |
| G2  | Swarm identity model         | Each agent has stable ID, name, color; visible in UI      |
| G3  | Agent-to-agent communication | Leader can send tasks/messages to named workers           |
| G4  | Permission delegation        | Worker tool-use approvals surfaced in leader's VS Code UI |
| G5  | External process backend     | Spawn headless CLI workers or new VS Code windows         |
| G6  | Fault isolation              | One failing worker does not kill the swarm                |

**Non-goals (this version):**

- Distributed execution across machines
- Custom agent personas / system-prompt authoring UI
- Persistent cross-session team identities (teams dissolve when the session ends)

---

## 3. Background: How claude-code Solves This

Reference implementation: `C:\Users\lisam\laud code\claude-code\src\utils\swarm\`

### 3.1 Concurrent task map

claude-code stores all running agents in a flat `AppState.tasks: Record<taskId, TaskState>` map.
There is no stack, no single-open invariant. Any number of `InProcessTeammateTask` objects can
be `status: "running"` simultaneously.

### 3.2 AsyncLocalStorage context isolation

Each in-process teammate runs inside `runWithTeammateContext(context, fn)` which uses Node.js
`AsyncLocalStorage`. Every async operation on any call stack descending from that invocation
sees the same `TeammateContext` — no cross-agent state bleed.

```typescript
// teammateContext.ts
const teammateContextStorage = new AsyncLocalStorage<TeammateContext>()

export function runWithTeammateContext<T>(ctx: TeammateContext, fn: () => T): T {
	return teammateContextStorage.run(ctx, fn)
}
```

Note: Morse Code `Task` instances are already class-isolated (each holds its own messages, API
client, history). `AsyncLocalStorage` is needed primarily for utility functions that look up
"current context" without being passed an explicit reference.

### 3.3 Two-level abort

Each teammate has:

- `abortController` — kills the whole agent lifecycle
- `currentWorkAbortController` — aborts only the current LLM turn (like pressing Escape),
  leaving the agent alive and idle

### 3.4 Idle loop + mailbox polling

After finishing a turn, a worker does **not** complete. It enters an idle loop that polls a
file-based mailbox (`~/.claude/teams/{team}/inboxes/{agent}.json`) every 500 ms for:

- A new task message from the leader
- A shutdown request
- A permission response

### 3.5 File-based mailboxes with locking

```
~/.claude/teams/<teamName>/inboxes/<agentName>.json
```

Writes use `proper-lockfile` with retry logic to prevent concurrent corruption. Message types:
`idle_notification`, `shutdown_request`, `task_assignment`, `permission_request`,
`permission_response`.

### 3.6 Permission bridge

A module-level singleton (`leaderPermissionBridge.ts`) lets in-process workers inject a
`WorkerPermissionRequest` directly into the leader's `ToolUseConfirm` queue — the same dialog
the human uses — with a colored worker badge showing which agent is asking.

### 3.7 Backend registry

```
detectAndGetBackend():
  priority 1: already inside tmux → TmuxBackend (native splits)
  priority 2: iTerm2 with it2 CLI → ITermBackend (native splits)
  priority 3: any tmux available → TmuxBackend (external session)
  priority 4: headless / no terminal → InProcessBackend
```

---

## 4. Proposed Architecture

### 4.1 Phase 1 — Concurrent task map (foundation)

**The single highest-impact change.** Remove the `clineStack: Task[]` LIFO invariant.

```typescript
// ClineProvider.ts — replace line 140
// FROM:
private clineStack: Task[] = []

// TO:
private tasks: Map<string, Task> = new Map()
private focusedTaskId?: string   // which task the VS Code UI is showing
private leaderTaskId?: string    // root leader of the current swarm session
```

Changes cascade through:

- `getCurrentTask()` → returns `tasks.get(focusedTaskId)` (UI focus)
- `addClineToStack()` → `registerTask(task)` — adds to map, emits `TaskFocused`
- `removeClineFromStack()` → `unregisterTask(taskId)` — removes from map; if
  leader is unregistered, tears down swarm
- `delegateParentAndOpenChild()` — **stops disposing parent**; instead sets
  `focusedTaskId` to child, parent remains `status: "delegated"` but alive in map
- `createTask()` — no longer enforces single-open invariant for swarm spawns

Estimated scope: ~400 LOC in `ClineProvider.ts` + updates to `webviewMessageHandler.ts`,
event emitters, and any call site that assumes `clineStack.length <= 1`.

### 4.2 Phase 2 — Swarm identity and registry

New file: `src/core/swarm/SwarmRegistry.ts`

```typescript
export type AgentColorName = "red" | "blue" | "green" | "yellow" | "purple" | "orange" | "pink" | "cyan"

export interface AgentIdentity {
  agentId: string          // "<name>@<team>"
  agentName: string
  teamName: string
  color: AgentColorName
  isLeader: boolean
  taskId: string           // linked Morse Code task ID
}

export interface SwarmSession {
  sessionId: string
  leaderTaskId: string
  teammates: Map<string, AgentIdentity>   // keyed by agentId
  taskList: string[]                      // unclaimed tasks (worker-pull model)
}

export class SwarmRegistry {
  private sessions: Map<string, SwarmSession> = new Map()
  private colorIndex = 0
  private readonly COLORS: AgentColorName[] = [
    "red","blue","green","yellow","purple","orange","pink","cyan"
  ]

  createSession(leaderTaskId: string): SwarmSession { … }
  assignColor(agentId: string): AgentColorName { … }  // round-robin
  registerTeammate(sessionId: string, identity: AgentIdentity): void { … }
  unregisterTeammate(sessionId: string, agentId: string): void { … }
  getSession(sessionId: string): SwarmSession | undefined { … }
  destroySession(sessionId: string): void { … }
}
```

The registry lives on `ClineProvider` (one per workspace). The `AgentIdentity` is stored in
`HistoryItem` (extend schema) so it survives process restart.

### 4.3 Phase 3 — Mailbox communication

New file: `src/core/swarm/MailboxService.ts`

Two implementations behind one interface:

```typescript
export interface IMailboxService {
	send(to: string, msg: TeammateMessage): Promise<void>
	read(agentName: string): Promise<TeammateMessage[]>
	markRead(agentName: string, idx: number): Promise<void>
}
```

- **`InMemoryMailbox`** — for in-process workers; uses a `Map<agentName, TeammateMessage[]>`
  with async mutex instead of file locks. Zero latency.
- **`FileMailbox`** — for cross-process/cross-window workers; stores at
  `~/.roo/teams/<team>/inboxes/<agent>.json` with `proper-lockfile`.

Message types to implement first:

| Type                  | Direction       | Purpose                      |
| --------------------- | --------------- | ---------------------------- |
| `task_assignment`     | leader → worker | Assign a new task            |
| `idle_notification`   | worker → leader | "I finished, ready for more" |
| `shutdown_request`    | leader → worker | "Stop after current turn"    |
| `permission_request`  | worker → leader | Request tool-use approval    |
| `permission_response` | leader → worker | Approval/rejection result    |

### 4.4 Phase 4 — Idle worker loop

Extend `Task.ts` with a `runSwarmWorkerLoop()` method. After each LLM turn completes, instead of
marking the task done, the worker:

1. Sends `idle_notification` to leader with summary.
2. Polls mailbox every 500 ms waiting for `task_assignment` or `shutdown_request`.
3. On `task_assignment`: adds user message to conversation, re-enters
   `recursivelyMakeClineRequests`.
4. On `shutdown_request`: marks task completed after current turn.
5. On leader abort signal: hard-stops immediately.

This mirrors `waitForNextPromptOrShutdown` in `inProcessRunner.ts:689`.

Two-level abort (mirrors claude-code):

```typescript
class Task {
	readonly lifecycleAbortController = new AbortController() // kills whole worker
	// currentRequestAbortController already exists — rename to turnAbortController
	// (aborts only the ongoing LLM stream, worker stays alive)
}
```

### 4.5 Phase 5 — Permission bridge

New file: `src/core/swarm/LeaderPermissionBridge.ts`

```typescript
export type WorkerPermissionRequest = {
	requestId: string
	workerTaskId: string
	agentName: string
	color: AgentColorName
	toolName: string
	toolUseId: string
	input: Record<string, unknown>
	description: string
	onAllow(updatedInput?: Record<string, unknown>): void
	onReject(reason?: string): void
}

// Module-level singleton — workers inject, leader UI reads
let pendingRequests: WorkerPermissionRequest[] = []
let notifyLeader: (() => void) | null = null

export function registerLeaderNotifier(fn: () => void): void {
	notifyLeader = fn
}
export function submitPermissionRequest(req: WorkerPermissionRequest): void {
	pendingRequests.push(req)
	notifyLeader?.()
}
export function consumePendingRequests(): WorkerPermissionRequest[] {
	const copy = [...pendingRequests]
	pendingRequests = []
	return copy
}
```

The VS Code UI renders pending worker permission requests as either:

- An inline badge in the existing tool-approval ask UI (preferred), or
- A VS Code `showInformationMessage` with Allow/Reject buttons (fallback)

### 4.6 Phase 6 — External process backend

For full OS-level isolation (separate heaps, separate git worktrees):

**Option A — Headless CLI worker** (lighter, recommended first):

```bash
morse-worker \
  --agent-id researcher@my-team \
  --team-name my-team \
  --parent-session $SESSION_ID \
  --worktree ~/.roo/worktrees/project-a1b2c3d4 \
  --mailbox-dir ~/.roo/teams/my-team/inboxes \
  --model claude-sonnet-4-6
```

The worker process reads its first task from its mailbox file and uses `FileMailbox` for
bidirectional communication. Mirrors claude-code's `PaneBackendExecutor.spawn()`.

**Option B — New VS Code window** (full extension, heavier):

```typescript
vscode.commands.executeCommand("vscode.openFolder", worktreeUri, {
	forceNewWindow: true,
})
// + write initial task to mailbox before window opens
```

**Backend registry** (mirrors claude-code `registry.ts`):

```typescript
export interface IWorkerBackend {
	spawn(config: WorkerSpawnConfig): Promise<WorkerSpawnResult>
	terminate(workerId: string): Promise<void>
	isActive(workerId: string): Promise<boolean>
}

// Priority order:
// 1. InProcessBackend  — default; no extra dependencies
// 2. CliWorkerBackend  — opt-in; requires morse-worker binary
// 3. VsCodeWindowBackend — opt-in; spawns new VS Code window
```

---

## 5. Data Model Changes

### 5.1 HistoryItem extensions

```typescript
// packages/types/src/history.ts — additions
agentId?: string              // "<name>@<team>" if this task is a swarm worker
agentName?: string
agentColor?: string
teamName?: string
swarmSessionId?: string
isSwarmLeader?: boolean
isIdle?: boolean              // worker is alive but waiting for next task
```

### 5.2 New types package exports

```typescript
// packages/types/src/swarm.ts (new file)
export type AgentColorName = "red" | "blue" | "green" | "yellow" | "purple" | "orange" | "pink" | "cyan"

export interface AgentIdentity { … }
export interface SwarmSession { … }
export interface TeammateMessage { … }
export type TeammateMessageType =
  | "task_assignment"
  | "idle_notification"
  | "shutdown_request"
  | "permission_request"
  | "permission_response"
```

### 5.3 New event names

```typescript
// packages/types/src/events.ts — additions to RooCodeEventName
SwarmSessionStarted = "swarmSessionStarted"
SwarmSessionEnded = "swarmSessionEnded"
WorkerSpawned = "workerSpawned"
WorkerIdle = "workerIdle"
WorkerShutdown = "workerShutdown"
PermissionRequested = "permissionRequested" // worker→leader
PermissionResolved = "permissionResolved" // leader→worker
```

---

## 6. API surface (spawn_parallel_tasks evolution)

Today `spawn_parallel_tasks` runs tasks sequentially. Once Phase 1+2 land, it gains a
`concurrent: true` flag:

```json
{
	"tool": "spawn_parallel_tasks",
	"tasks": [
		{ "mode": "code", "message": "implement auth service", "worktree": "auto" },
		{ "mode": "code", "message": "implement payment service", "worktree": "auto" },
		{ "mode": "code", "message": "implement notification service", "worktree": "auto" }
	],
	"concurrent": true,
	"abortOnChildFailure": false
}
```

When `concurrent: true`, all tasks start immediately against the task map (Phase 1). The parent
registers `onIdle` callbacks on each child and resumes only when all have called
`idle_notification` with a completed status.

A new `spawn_swarm` tool (Phase 3+) allows richer worker control:

```json
{
	"tool": "spawn_swarm",
	"teamName": "feature-v2",
	"workers": [
		{ "name": "researcher", "mode": "architect", "color": "blue" },
		{ "name": "coder-1", "mode": "code", "color": "green" },
		{ "name": "reviewer", "mode": "code", "color": "yellow" }
	],
	"taskList": [
		"Research existing auth implementations",
		"Implement JWT refresh token flow",
		"Review and test the JWT implementation"
	]
}
```

Workers pull tasks from the `taskList` atomically; the leader monitors idle notifications and
can push new tasks dynamically.

---

## 7. UI Changes

### 7.1 Active workers panel

A new collapsible section in the Chat sidebar shows all running workers with their color dot,
current status (running / idle), and latest tool in use. Mirrors how SubtaskRow renders
child tasks today.

### 7.2 Worker permission badge

When a worker requests tool approval, the existing tool-ask dialog renders a colored badge
(`[researcher · blue]`) above the file diff / bash command block.

### 7.3 Swarm activity log

The Output Channel gains a `Morse Code Swarm` channel that logs all cross-agent messages,
idle transitions, and permission events in real time.

---

## 7b. Teams System (Shipped)

The Teams system provides a lightweight, config-driven multi-agent workflow layer that sits on
top of the Phase 1 concurrent task map. It is inspired by the
[Atlas-Agent-Teams](https://github.com/Logos-Liber/Atlas-Agent-Teams) CLI plugin.

### How it works

1. A team is defined in `.roo/teams/<slug>.json`. The file describes an ordered list of phases;
   each phase runs one or more specialist agents (each in a Roo-Code mode).
2. An orchestrator agent (any mode with `run_team_phase` available) reads the config with
   `read_file`, then calls `run_team_phase` once per phase in order.
3. The tool handles concurrent vs sequential dispatch, conventions injection, and template
   interpolation — the orchestrator only needs to pass `task` and accumulated `context`.

### Key components

| File                                                    | Role                                                  |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `packages/types/src/team.ts`                            | `TeamConfig`, `TeamPhase`, `TeamAgentSpec` interfaces |
| `src/services/teams/TeamsManager.ts`                    | Scans `.roo/teams/*.json`; caches configs by slug     |
| `src/core/tools/RunTeamPhaseTool.ts`                    | Tool implementation                                   |
| `src/core/prompts/tools/native-tools/run_team_phase.ts` | LLM tool schema                                       |
| `.roo/teams/fullstack.json`                             | Sample 3-phase full-stack team                        |

### Config format (summary)

```json
{
	"slug": "my-team",
	"name": "My Team",
	"orchestratorMode": "orchestrator",
	"conventions": ".roo/teams/conventions/my-team.md",
	"phases": [
		{
			"name": "discovery",
			"concurrent": true,
			"requireApproval": true,
			"agents": [
				{
					"mode": "architect",
					"role": "Backend Architect",
					"instruction": "Analyze backend requirements for: {{task}}\n\nPrior context: {{context}}"
				}
			]
		}
	]
}
```

Template variables available in `instruction` and `worktree` fields: `{{task}}`, `{{context}}`,
`{{phase}}`, `{{team}}`.

See [`docs/teams.md`](./teams.md) for the full reference.

---

## 8. Phased Delivery

| Phase | Name                | Key deliverables                                                                                                       | Status      | Estimated effort  |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------- |
| P1    | Concurrent task map | Replace `clineStack` with `tasks: Map`; remove single-open invariant; `concurrent: true` on `spawn_parallel_tasks`     | **Shipped** | Large (1–2 weeks) |
| PT    | Teams system        | `run_team_phase` tool; `TeamsManager`; `.roo/teams/*.json` config format; conventions injection; `abortOnChildFailure` | **Shipped** | Medium (2–3 days) |
| P2    | Swarm identity      | `SwarmRegistry`, `AgentIdentity`, color assignment; UI color dots                                                      | Planned     | Medium (3–5 days) |
| P3    | In-process mailbox  | `InMemoryMailbox`, idle loop in `Task`, `idle_notification` / `task_assignment` messages                               | Planned     | Medium (3–5 days) |
| P4    | Permission bridge   | `LeaderPermissionBridge`, worker badge in tool-ask UI                                                                  | Planned     | Medium (3–5 days) |
| P5    | File mailbox        | `FileMailbox` with lockfile; cross-process swarm works                                                                 | Planned     | Small (2–3 days)  |
| P6    | External backends   | `CliWorkerBackend`; `morse-worker` entry point; `spawn_swarm` tool                                                     | Planned     | Large (1–2 weeks) |

---

## 9. Risks and Mitigations

| Risk                                                                     | Impact | Mitigation                                                                                                     |
| ------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| Removing single-open invariant breaks webview state assumptions          | High   | Audit all `getCurrentTask()` call sites; add `getFocusedTask()` as new name to make call sites obvious         |
| Concurrent tasks racing on `taskHistoryStore` writes                     | Medium | Serialize writes via async mutex (one per taskId); reads are safe (immutable snapshots)                        |
| VS Code extension host is single-threaded — "concurrency" is cooperative | Medium | Tasks yield naturally at `await` points; long CPU-bound turns block others. Acceptable for I/O-bound LLM tasks |
| File mailbox lock contention with many workers                           | Low    | In-process workers use `InMemoryMailbox`; file mailbox only for cross-process                                  |
| External CLI worker binary distribution                                  | Medium | Ship as optional; document manual install; in-process is always available                                      |

---

## 10. Prior Art / References

- **claude-code swarm source:** `C:\Users\lisam\laud code\claude-code\src\utils\swarm\`
    - `inProcessRunner.ts` — idle loop, permission bridge
    - `teammateContext.ts` — AsyncLocalStorage pattern
    - `backends/registry.ts` — pluggable backend selection
    - `teammateMailbox.ts` — file-based mailbox with lockfile
    - `leaderPermissionBridge.ts` — module-level permission injection
- **Current Morse Code parallel implementation:**
    - `src/core/webview/ClineProvider.ts` — `delegateParentAndOpenChild`, `reopenParentFromDelegation`
    - `src/core/tools/SpawnParallelTasksTool.ts`
    - `packages/types/src/history.ts` — `parallelQueue`, `parallelResults`
- **Previous improvements (merged in `morse-code-standalone`):**
    - Worktree orphan detection
    - `abortOnChildFailure` flag
    - `getParallelTaskStatus()` introspection API
    - Telemetry for worktree/parallel events
