# Swarm

This document is the technical reference for the Morse Code Swarm system.

## Overview

Swarm is a dynamic, work-queue-based multi-agent execution system. You define a pool of workers and a list of tasks; the swarm distributes tasks across workers as each finishes its current assignment. Workers run concurrently inside the VS Code extension host (the default) or as headless child processes (the `cli` backend). Use swarm when:

- The number of tasks is not known ahead of time, or tasks arrive dynamically.
- You want workers to self-select from a shared queue rather than be assigned fixed roles.
- You need true concurrent execution with wall-clock time close to `max(task times)` rather than the sum.

If your workflow has a fixed set of named phases with specific agents per phase, use [Teams](./teams.md) (`run_team_phase`) instead. If you need exactly two to five parallel subtasks with no dynamic dispatch, `spawn_parallel_tasks` is simpler. If you need a single sequential subtask and want to wait for it, use `new_task`.

---

## Quick Start

```json
{
	"tool": "spawn_swarm",
	"workers": [
		{ "name": "alpha", "mode": "code" },
		{ "name": "beta", "mode": "code" },
		{ "name": "gamma", "mode": "code" }
	],
	"task_list": [
		"Implement the authentication service",
		"Implement the payment service",
		"Implement the notification service",
		"Implement the audit logging service",
		"Write integration tests for all services"
	]
}
```

The leader agent calls `spawn_swarm`. The three workers start immediately, each picking up one task from `task_list`. As each worker finishes, it receives the next unclaimed task until the queue is empty. Workers then shut down cleanly.

---

## The `spawn_swarm` Tool

### Parameters

| Parameter          | Type                      | Required | Default        | Description                                                                                                                                               |
| ------------------ | ------------------------- | -------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers`          | `WorkerSpec[]`            | Yes      | —              | Pool of workers to spawn. Each worker runs as an independent agent instance. Must contain at least one entry.                                             |
| `task_list`        | `string[]`                | Yes      | —              | Ordered list of task descriptions to distribute across workers. Must contain at least one entry.                                                          |
| `abort_on_failure` | `boolean`                 | No       | `false`        | When `true`, stops dispatching new tasks as soon as any worker sends a failure result to the coordination loop. Already-running tasks complete naturally. |
| `backend`          | `"in_process"` \| `"cli"` | No       | `"in_process"` | Execution backend. See [Backends](#backends) below.                                                                                                       |

### `WorkerSpec` fields

| Field   | Type     | Required | Description                                                                                                |
| ------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `name`  | `string` | Yes      | Unique name for this worker within the swarm (e.g., `"researcher"`, `"coder-1"`). Used for identification. |
| `mode`  | `string` | Yes      | Mode slug the worker runs in (e.g., `"code"`, `"architect"`).                                              |
| `color` | `string` | No       | Display color hint for the UI. Assigned automatically round-robin if omitted.                              |

### Validation

- `workers` must have at least one entry; otherwise the tool returns an error immediately.
- `task_list` must have at least one entry.
- If `task_list` is shorter than `workers`, only `task_list.length` workers start with initial tasks. Workers without an initial task do not start.

---

## How the Coordination Loop Works

This section explains the swarm lifecycle in plain English.

**1. Session creation.** When `spawn_swarm` runs, it creates a mailbox for the session. The mailbox is an in-memory message queue (for `in_process`) or a file-backed queue (for `cli`) that workers and the leader use to communicate.

**2. Initial task distribution.** The first task from `task_list` goes to the first worker, the second task to the second worker, and so on. If there are more workers than tasks, only the first `task_list.length` workers start.

**3. Concurrent execution.** Workers run simultaneously. Each worker calls its LLM, executes tools, and completes its assigned task. The leader's coordination loop runs concurrently with the workers — it does not block waiting for one worker at a time.

**4. Idle notification.** When a worker finishes its task, it sends an `idle_notification` message to the leader's mailbox queue. The message includes the worker's ID and a summary of what it completed.

**5. Task dispatch.** The coordination loop reads each `idle_notification`. If tasks remain in the queue, it sends a `task_assignment` message to the idle worker, which picks up the next task and resumes. If the queue is empty, it sends a `shutdown_request` to the worker, which then terminates cleanly.

**6. Completion.** The loop continues until all workers have received a `shutdown_request` and exited. The leader then aggregates results and returns them.

**Timeout safety.** The coordination loop waits up to 120 seconds for each `idle_notification`. If no message arrives within that window, the loop exits early. Workers also have their own independent timeouts.

---

## Backends

### In-process (default)

Workers run as `Task` instances inside the VS Code extension host, sharing the same Node.js process. Communication uses an `InMemoryMailbox` — a plain in-memory message queue with no file I/O and zero latency.

This is the default and requires no additional setup. It is suitable for most use cases. Because the VS Code extension host is single-threaded, concurrency is cooperative: workers yield naturally at `await` points (LLM API calls, file I/O). Long CPU-bound work in one worker can delay others, but LLM interactions are overwhelmingly I/O-bound so this is rarely a problem in practice.

### CLI (`morse-worker`)

When `backend: "cli"` is specified, each worker is spawned as a separate `morse-worker` child process. Workers communicate with the leader via a `FileMailbox` — JSON files on disk at `~/.roo/swarm/<sessionId>/` with file-locking to prevent concurrent corruption.

The CLI backend provides full OS-level isolation: separate heaps, and the ability to point workers at different git worktrees. It requires the `morse-worker` binary to be built and available.

**Status:** The `morse-worker` binary (`src/workers/morse-worker.ts`) is a skeleton as of the current release. Full headless task execution requires decoupling `Task` from VS Code dependencies. Use `in_process` for production work until the CLI backend is complete.

**Mailbox location:** `~/.roo/swarm/<sessionId>/<agentId>.json`

---

## Leader Permission Bridge

When a worker needs to use a tool that requires user approval (such as writing a file or executing a shell command), it cannot directly show a VS Code dialog — it is running as a child task without UI focus.

The leader permission bridge solves this. It is a module-level singleton registered by `ClineProvider` when the extension activates. Workers call `submitWorkerPermissionRequest()` to inject a permission request into the leader's approval queue. The leader's VS Code window shows a modal dialog identifying the requesting worker by name and color:

```
Worker approval request from alpha (blue)
Tool: write_to_file

<file path and diff>
```

The user clicks Allow or Deny. The result is sent back to the worker, which proceeds or aborts accordingly.

If no handler is registered (for example, because the leader has been disposed), the bridge fails closed: all permission requests return `false` (deny). This prevents unattended workers from making changes without oversight.

**Only in-process workers use the bridge.** CLI workers running as separate processes use their file mailbox to send `permission_request` and receive `permission_response` messages instead.

---

## Agent Identity and Colors

Each worker is assigned a stable identity (`AgentIdentity`) when the swarm session starts:

- `agentId` — `"<name>@<sessionId>"`, unique within the session.
- `agentName` — the `name` from the worker spec.
- `color` — one of `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`, assigned round-robin by the `SwarmRegistry`.

Colors appear in permission dialogs and in the Output Channel's swarm activity log so you can distinguish which worker is doing what.

The `SwarmRegistry` lives on `ClineProvider` (one per workspace). Sessions are created when `spawn_swarm` starts and destroyed when all workers have finished.

---

## Full Example

The following example runs a swarm to implement a five-service backend with three concurrent workers.

```json
{
	"tool": "spawn_swarm",
	"workers": [
		{ "name": "engineer-1", "mode": "code", "color": "blue" },
		{ "name": "engineer-2", "mode": "code", "color": "green" },
		{ "name": "engineer-3", "mode": "code", "color": "yellow" }
	],
	"task_list": [
		"Implement src/services/auth.ts: JWT authentication with refresh tokens. Follow existing patterns in src/services/. Run tests after.",
		"Implement src/services/payments.ts: Stripe integration with webhook handling. Follow existing patterns. Run tests after.",
		"Implement src/services/notifications.ts: Email + push notification dispatch. Follow existing patterns. Run tests after.",
		"Implement src/services/audit.ts: Append-only audit log with query API. Follow existing patterns. Run tests after.",
		"Write integration tests in src/tests/services.integration.ts covering all four services. Use the existing test harness in src/tests/helpers/."
	],
	"abort_on_failure": false,
	"backend": "in_process"
}
```

**What happens:**

1. `engineer-1` picks up the `auth.ts` task, `engineer-2` picks up `payments.ts`, `engineer-3` picks up `notifications.ts`. All three run simultaneously.
2. When `engineer-1` finishes `auth.ts`, it sends an idle notification. The coordination loop dispatches `audit.ts` to it.
3. When `engineer-2` finishes `payments.ts`, it receives `integration tests`.
4. When `engineer-3` finishes `notifications.ts`, the queue is empty — it receives a shutdown request and exits.
5. `engineer-1` and `engineer-2` finish their second tasks, both receive shutdown requests, and exit.
6. The leader receives aggregated results from all five tasks.

With `abort_on_failure: false`, a failure in any one task does not stop the others.

---

## Comparison with Other Orchestration Tools

| Concern                            | `new_task` | `spawn_parallel_tasks` | `run_team_phase` | `spawn_swarm` |
| ---------------------------------- | ---------- | ---------------------- | ---------------- | ------------- |
| Single sequential subtask          | Yes        | No                     | No               | No            |
| Fixed set of parallel subtasks     | No         | Yes                    | Yes              | Possible      |
| Dynamic task queue                 | No         | No                     | No               | Yes           |
| Phased workflows with named agents | No         | No                     | Yes              | No            |
| Worker pool with self-selecting    | No         | No                     | No               | Yes           |
| Cross-process isolation            | No         | No                     | No               | Yes (cli)     |

See [multi-agent.md](./multi-agent.md) for a full decision guide.

---

## Limitations and Gotchas

**VS Code extension host is single-threaded.** Concurrency in the `in_process` backend is cooperative. Workers that block synchronously (rare in practice) delay other workers.

**`morse-worker` CLI backend is a skeleton.** Do not use `backend: "cli"` in production until the binary is complete. The tool will silently proceed but workers will not execute tasks.

**Coordination loop timeout.** If a worker hangs and never sends an `idle_notification`, the coordination loop waits 120 seconds and then exits. The hanging worker continues running but receives no further tasks. It will self-terminate when its own turn timeout fires.

**No shared state between workers.** Workers do not share memory, file handles, or git branches by default. If two workers modify the same file concurrently, they will conflict. Use separate git worktrees or design tasks to touch disjoint parts of the codebase.

**`abort_on_failure` stops dispatch, not running workers.** When a failure triggers `abort_on_failure`, the coordination loop stops sending new tasks. Workers already mid-task are not interrupted — they run to completion (or failure) on their own.

**Minimum two items not required.** Unlike `spawn_parallel_tasks`, `spawn_swarm` accepts a single-item `task_list`. A swarm with one task and one worker is valid, though `new_task` is simpler for that use case.

**Session IDs.** The swarm session ID equals the leader task's `taskId`. This means each `spawn_swarm` call creates exactly one session, and sessions do not persist across VS Code restarts.
