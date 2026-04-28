# Architecture Overview

This document is an orientation guide for new contributors. It describes the monorepo layout, how the core extension is structured, and how the fork-specific orchestration layer (Teams, Swarm, parallel tasks, Skills) fits on top of the base system.

---

## Monorepo Layout

The repository is a pnpm workspace managed with Turborepo. The root `package.json` defines workspace-level scripts (`build`, `test`, `lint`, `check-types`) that delegate to each package via Turborepo.

```
Roo-Code/
├── apps/
│   ├── cli/              # Headless terminal interface (the "roo" binary)
│   ├── vscode-e2e/       # End-to-end tests that run inside VS Code
│   ├── vscode-nightly/   # Nightly build variant
│   ├── web-evals/        # Next.js web UI for managing eval runs
│   └── web-roo-code/     # Public marketing / docs website
│
├── packages/
│   ├── types/            # Shared TypeScript types exported as @roo-code/types
│   ├── core/             # Shared business logic (worktree service, tool registry)
│   ├── cloud/            # Roo Code Cloud API client
│   ├── telemetry/        # PostHog telemetry wrapper
│   ├── ipc/              # Inter-process communication helpers
│   ├── evals/            # Eval infrastructure: CLI, DB schema, Docker configs
│   ├── build/            # Shared build configuration
│   ├── config-eslint/    # Shared ESLint configuration
│   ├── config-typescript/# Shared TypeScript configuration
│   └── vscode-shim/      # Shims for using VS Code APIs outside the extension host
│
├── src/                  # The VS Code extension (the main product)
│   ├── extension.ts      # Extension entry point
│   ├── activate/         # Command and code-action registration
│   ├── api/              # LLM provider adapters
│   ├── core/             # Task execution, tools, prompts, webview bridge
│   │   ├── task/         # Task — the unit of agent execution
│   │   ├── tools/        # All tool implementations (BaseTool subclasses)
│   │   ├── webview/      # ClineProvider — the VS Code webview host
│   │   ├── swarm/        # Swarm registry, mailbox, permission bridge
│   │   └── prompts/      # System prompt assembly and tool schemas
│   ├── services/         # Long-lived singletons (MCP, skills, teams, checkpoints)
│   ├── integrations/     # Terminal, editor diff view, workspace tracking
│   └── utils/            # Path, git, telemetry helpers
│
├── webview-ui/           # React frontend rendered inside the VS Code panel
├── .roo/                 # Project-level Morse Code config (rules, skills, teams)
└── docs/                 # Documentation (you are here)
```

### Key packages explained

**`packages/types`** — The single source of truth for shared interfaces: `HistoryItem`, `TeamConfig`, `SwarmSession`, `TeammateMessage`, tool parameter types, event names, and the `RooCodeAPI` interface. Everything that crosses a package boundary lives here.

**`packages/core`** — Business logic that is shared between the extension and the CLI without VS Code dependencies. Contains the worktree service and the custom tool registry. Anything that needs to run headlessly belongs here rather than in `src/`.

**`apps/cli`** — A Node.js CLI (`roo` binary) that drives the extension programmatically. It loads the bundled extension via its API, starts tasks, streams output, and handles interactive or `--print` mode. See [CLI Architecture](#cli-architecture) below.

---

## Core Extension Architecture

The VS Code extension has three primary layers stacked on each other:

```
┌─────────────────────────────────────────────────────┐
│  webview-ui  (React, Tailwind)                      │
│  User-facing chat panel                             │
└─────────────────┬───────────────────────────────────┘
                  │  postMessage / onDidReceiveMessage
┌─────────────────▼───────────────────────────────────┐
│  ClineProvider  (src/core/webview/ClineProvider.ts) │
│  VS Code webview host, task registry, settings      │
└─────────────────┬───────────────────────────────────┘
                  │  creates / owns
┌─────────────────▼───────────────────────────────────┐
│  Task  (src/core/task/Task.ts)                      │
│  One agent conversation: LLM loop, tool dispatch    │
└─────────────────┬───────────────────────────────────┘
                  │  execute()
┌─────────────────▼───────────────────────────────────┐
│  BaseTool subclasses  (src/core/tools/)             │
│  Each tool: one file, one class, one responsibility │
└─────────────────────────────────────────────────────┘
```

### `extension.ts` — Entry point

`src/extension.ts` is the VS Code `activate()` function. It:

1. Loads optional environment variables from `.env`.
2. Creates the output channel and logger.
3. Instantiates `ClineProvider` and registers it as a webview view provider for the sidebar panel.
4. Registers VS Code commands, code actions, and terminal actions via `registerCommands`, `registerCodeActions`, `registerTerminalActions`.
5. Initializes the telemetry service, cloud service, MCP server manager, and code index manager.

### `ClineProvider` — The webview host

`ClineProvider` is the center of the extension. It:

- Owns the `tasks: Map<string, Task>` — all currently running agent tasks, keyed by `taskId`. The map replaced the original `clineStack: Task[]` LIFO structure to allow true concurrent execution.
- Tracks `focusedTaskId` (which task the VS Code UI is showing) and `leaderTaskId` (the root task of the current swarm session, if any).
- Handles the webview message bus: all messages from the React frontend arrive via `webviewMessageHandler`, and all messages to the frontend are sent via `postMessageToWebview`.
- Owns long-lived singletons: `SkillsManager`, `TeamsManager`, `SwarmRegistry`, `MailboxManager`.
- Registers the leader permission handler so worker tasks can request tool approval through the VS Code UI.
- Implements `spawnConcurrentChildren()` — the shared primitive used by `spawn_parallel_tasks` (concurrent mode), `run_team_phase`, and `spawn_swarm` to fan out multiple child tasks simultaneously.

### `Task` — The unit of execution

`Task` represents one agent conversation. It owns:

- The conversation history (`clineMessages: ClineMessage[]`).
- The API handler for the LLM provider.
- The abort controllers: one for the whole task lifecycle, one for the current LLM turn.
- The `recursivelyMakeClineRequests()` loop: sends the conversation to the LLM, parses tool use blocks from the response, calls each tool, appends results, and repeats until the agent calls `attempt_completion`.

A `Task` has a `WeakRef<ClineProvider>` so tools can reach back to the provider (for example, to spawn child tasks or check settings) without creating a hard reference cycle.

### `BaseTool` — Tool base class

All tools extend `BaseTool<TName extends ToolName>`. The base class handles:

- **Partial message handling** (`handlePartial`): called during streaming before the full tool call arrives. Tools override this to show progressive UI updates.
- **Parameter parsing**: extracts typed `nativeArgs` from the tool use block. XML-based tool calls are no longer supported.
- **`execute(params, task, callbacks)`**: the core method each tool implements.

Callbacks passed to `execute`:

| Callback         | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `askApproval`    | Show the tool-approval dialog to the user    |
| `handleError`    | Record an error and push an error result     |
| `pushToolResult` | Append the tool's output to the conversation |

---

## Webview Message Bus

The React frontend (`webview-ui/`) and the extension backend (`ClineProvider`) communicate exclusively via VS Code's webview message passing API. There is no shared memory.

**Frontend to backend:** The webview calls `vscode.postMessage({ type: "...", ...payload })`. Messages arrive in `ClineProvider`'s `webviewMessageHandler`, which dispatches on `message.type`.

**Backend to frontend:** `ClineProvider` calls `this.postMessageToWebview({ type: "...", ...payload })`. The React side listens with `window.addEventListener("message", handler)`.

Message types are defined in `src/shared/WebviewMessage.ts` (frontend-to-backend, `WebviewMessage`) and `packages/types/src/ExtensionMessage.ts` (backend-to-frontend, `ExtensionMessage`).

The webview is a full React app built with Vite. In development it loads from the Vite dev server; in production it is bundled into the extension package.

---

## Orchestration Layer

The fork adds a multi-agent orchestration layer on top of the base task system. All four orchestration tools are `BaseTool` subclasses that use `spawnConcurrentChildren()` or `delegateParentAndOpenChild()` on `ClineProvider`.

```
Agent calls spawn_swarm / run_team_phase / spawn_parallel_tasks / new_task
                        │
                        ▼
              Tool.execute(params, task, callbacks)
                        │
                        ▼
         task.providerRef.deref() → ClineProvider
                        │
           ┌────────────┴──────────────────────────┐
           │ spawnConcurrentChildren()              │ delegateParentAndOpenChild()
           │ (concurrent fan-out)                  │ (sequential delegation)
           ▼                                        ▼
   tasks Map: new Task instances            tasks Map: child Task
   run simultaneously                       parent suspended
```

### `new_task`

Calls `delegateParentAndOpenChild()` with no `parallelQueue`. The parent task suspends and the single child task runs to completion. When the child finishes, the parent resumes. This is the simplest orchestration primitive.

### `spawn_parallel_tasks`

- Sequential mode (default): uses `delegateParentAndOpenChild()` with a `parallelQueue`. The first child runs, resumes the parent, which then drains the queue one child at a time.
- Concurrent mode (`concurrent: true`): calls `spawnConcurrentChildren()` — all children start simultaneously and the parent waits for all to complete.

### `run_team_phase`

Reads a team config from `.roo/teams/<slug>.json` via `TeamsManager`. For each agent in the named phase, it calls `spawnConcurrentChildren()` (if `concurrent: true`) or runs them sequentially. Supports `abortOnChildFailure` for concurrent phases.

### `spawn_swarm`

Calls `spawnConcurrentChildren()` for the initial batch of workers, then runs a coordination loop that reads `idle_notification` messages from the `MailboxManager` and dispatches new tasks or `shutdown_request` messages to workers. See [swarm.md](./swarm.md) for full details.

### `SwarmRegistry`

One instance lives on `ClineProvider`. It tracks all active swarm sessions and assigns stable `AgentIdentity` records (name + color) to each worker. Sessions are keyed by the leader's `taskId`.

### `MailboxManager`

One instance lives on `ClineProvider`. It creates and manages one `IMailboxService` per swarm session:

- `InMemoryMailbox` — zero-latency in-process queue for `in_process` backend.
- `FileMailbox` — JSON files on disk for `cli` backend, with file-locking.

### `TeamsManager`

Scans `.roo/teams/*.json` on startup and when files change. Caches parsed `TeamConfig` objects by slug. Used by `run_team_phase` to look up phase definitions.

### `SkillsManager`

Scans multiple skill directories on startup and when files change. See [skills.md](./skills.md) for the full discovery algorithm.

---

## CLI Architecture

`apps/cli/` is the headless terminal interface. It does not run the extension natively — it loads the pre-built extension bundle and communicates with it via the `RooCodeAPI`.

```
roo (CLI binary)
     │
     ▼
extension-host.ts     — loads dist/extension.js, calls activate()
     │
     ▼
RooCodeAPI            — startNewTask(), sendMessage(), pressPrimaryButton()
     │
     ▼
ClineProvider         — same code path as VS Code UI, no VS Code UI involved
     │
     ▼
Task → LLM → tools    — identical execution to interactive mode
```

The CLI uses a `TypedEventEmitter` (backed by Node.js `EventEmitter`) to stream structured events (token deltas, tool calls, completions) from the extension host back to the CLI process. The TUI (`apps/cli/src/ui/`) renders these events as a terminal interface using React/Ink.

Slash commands (e.g., `/mode`, `/model`, `/clear`) are handled by `ask-dispatcher.ts` before being forwarded to the extension, allowing the CLI to intercept and transform user input.

The swarm TUI renderer (`apps/cli/src/ui/`) includes specific rendering for swarm worker status, showing active workers and their current tasks in the terminal.

---

## Component Relationship Diagram

```
VS Code Extension Host
├── extension.ts (activate)
│   └── ClineProvider
│       ├── tasks: Map<taskId, Task>        ← concurrent agent map
│       ├── SwarmRegistry                   ← agent identity + colors
│       ├── MailboxManager                  ← cross-agent messaging
│       ├── SkillsManager                   ← skill discovery
│       ├── TeamsManager                    ← team config cache
│       └── LeaderPermissionBridge          ← worker → UI approval
│
│       Task (one per agent conversation)
│       ├── ApiHandler                      ← LLM provider adapter
│       ├── clineMessages[]                 ← conversation history
│       └── tool dispatch
│           ├── NewTaskTool
│           ├── SpawnParallelTasksTool
│           ├── RunTeamPhaseTool
│           ├── SpawnSwarmTool
│           ├── SkillTool
│           └── ... (40+ other tools)
│
Webview (React)
└── postMessage ↔ ClineProvider.webviewMessageHandler

CLI (apps/cli/)
└── RooCodeAPI → ClineProvider (same code, no VS Code UI)
```

---

## Adding a New Tool

1. Create `src/core/tools/MyTool.ts` extending `BaseTool<"my_tool">`.
2. Implement `execute(params, task, callbacks)`.
3. Add the tool schema to `src/core/prompts/tools/native-tools/my_tool.ts`.
4. Register the tool in `src/core/tools/index.ts` (or the relevant tool registry entry point).
5. Add parameter types to `packages/types/src/` if the tool crosses package boundaries.
6. Write tests in `src/core/tools/__tests__/MyTool.test.ts`. Run with `cd src && npx vitest run core/tools/__tests__/MyTool.test.ts`.

---

## Key Conventions

**TypeScript strict mode.** All packages use `strict: true`. Do not use `any` without a comment explaining why.

**No VS Code imports in `packages/`.** Packages must not import from `vscode`. Use `packages/vscode-shim` for types and shims when needed outside the extension host.

**Tools are stateless across calls.** Tool instances are singletons (e.g., `export const spawnSwarmTool = new SpawnSwarmTool()`). All per-call state must live in local variables inside `execute()`, not on `this`.

**`WeakRef` for provider access.** Tools access `ClineProvider` via `task.providerRef.deref()`. Always null-check the result — the provider may have been disposed.

**Changeset for releases.** Run `pnpm changeset` before opening a PR that changes user-facing behavior. See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.
