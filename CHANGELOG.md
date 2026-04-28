# Morse Code Changelog

This project was forked from [Roo Code](https://github.com/RooCodeInc/Roo-Code).

For the upstream changelog history, see the [Roo Code repository](https://github.com/RooCodeInc/Roo-Code/blob/main/CHANGELOG.md).

---

## [Unreleased]

### Added

- **Swarm multi-agent system** — new `spawn_swarm` tool distributes a task list across a pool of named worker agents. Workers run concurrently inside the VS Code extension host (`in_process` backend) or as headless child processes (`cli` backend). A coordination loop reads idle notifications from a mailbox and dispatches queued tasks until the list is exhausted, then shuts each worker down cleanly.
- **File-backed mailbox** (`FileMailbox`) — cross-process swarm workers communicate via JSON queue files in `~/.roo/swarm/<sessionId>/` with advisory file locking, enabling coordination between separate OS processes.
- **In-memory mailbox** (`InMemoryMailbox`) — zero-latency in-process message queue for workers running inside the extension host.
- **Worker backend abstraction** — a `IWorkerBackend` interface and registry decouple the swarm tool from the execution environment. `CliWorkerBackend` spawns `morse-worker` child processes; `InProcessBackend` delegates to the existing `spawnConcurrentChildren` API.
- **Leader permission bridge** — when an in-process worker needs to show a user-approval dialog (e.g. write a file or run a shell command), it routes the request to the leader task's VS Code window. The bridge fails closed (deny) when no handler is registered.
- **Agent identity and color assignment** — each swarm worker receives a stable `agentId`, `agentName`, and a display color assigned round-robin from a palette. Colors appear in permission dialogs and the output channel.
- **SwarmRegistry** — tracks active sessions and their worker identities on `ClineProvider`, one registry per workspace.
- **Teams system** — new `run_team_phase` tool and `TeamsManager` load phased multi-agent workflows from `.roo/teams/<slug>.json`. Each phase can run agents sequentially or concurrently, gate on user approval, and inject shared conventions from a Markdown file. Template variables (`{{task}}`, `{{context}}`, `{{phase}}`, `{{team}}`) are substituted at execution time.
- **Skills system** — `SkillTool` and `SkillsManager` load reusable `SKILL.md` instruction bundles from `.roo/skills/<name>/` directories. Skills support frontmatter fields (`name`, `description`, `modeSlugs`) and are injected into a conversation on demand after user approval.
- **CLI TUI swarm renderer** — the `roo` CLI now renders a live swarm status panel (worker list, task counters, elapsed time) using Ink. The panel updates in place while workers run.
- **Expanded CLI slash commands** — the interactive CLI REPL now supports `/swarm`, `/team`, `/workers`, `/tasks`, and `/status` slash commands in addition to the existing command set.
- **`morse-worker` build wiring** — the CLI package build now compiles `src/workers/morse-worker.ts` as a separate entry point so the binary is available alongside the extension bundle.
- **Anthropic OAuth for Claude Code Max** — the extension can authenticate with Anthropic using OAuth (Claude Code Max subscription). The `ANTHROPIC_AUTH_TOKEN` environment variable is also honoured as a fallback credential for headless or CI environments.
- **Parallel task introspection** — the parent task exposes running child tasks via a `tasks` Map, replacing the previous `clineStack`. Orphan detection and telemetry track child task lifecycle events.
- **Worktree support in `new_task`** — an optional `worktree` parameter on `new_task` (and the teams `TeamAgentSpec`) isolates the child agent's file operations in a separate git worktree branch.

### Changed

- `ClineProvider` now maintains a `MailboxManager` and `SwarmRegistry` instance for the lifetime of the workspace, instead of creating transient coordination state per task.
- Worker concurrency is cooperative inside the VS Code extension host (single-threaded Node.js process); true OS-level isolation requires the `cli` backend.

### Known Limitations

- The `morse-worker` CLI backend (`backend: "cli"` on `spawn_swarm`) is a skeleton. Full headless task execution requires further decoupling of `Task` from VS Code APIs. Use `in_process` for production workloads.
- The coordination loop times out after 120 seconds if a worker stops sending idle notifications.
