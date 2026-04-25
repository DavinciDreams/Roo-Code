# Multi-Agent Orchestration

Morse Code provides four tools for orchestrating work across multiple agent tasks. This guide describes each tool, when to use it, and how to choose between them.

---

## The Four Tools

### 1. `new_task`

Spawns a single child task in a specified mode, then suspends the parent until the child completes.

**When to use:**

- You need to delegate a well-defined, self-contained subtask to a specialist mode.
- The subtask must fully complete before the parent continues.
- You need the result of the subtask to inform the next step.

**Key parameters:**

| Parameter  | Type     | Required | Description                                                   |
| ---------- | -------- | -------- | ------------------------------------------------------------- |
| `mode`     | `string` | Yes      | Mode slug for the child task (e.g., `"code"`, `"architect"`). |
| `message`  | `string` | Yes      | Instruction sent to the child agent.                          |
| `todos`    | `string` | No       | Markdown checklist of subtasks for the child. Optional.       |
| `worktree` | `string` | No       | Git worktree branch for the child. `"auto"` creates one.      |

**Minimal example:**

```json
{
	"tool": "new_task",
	"mode": "code",
	"message": "Refactor src/utils/date.ts to use the date-fns library. Run tests after."
}
```

**Limitations:**

- Strictly sequential — the parent is suspended for the entire duration of the child task.
- Only one child at a time.
- No dynamic dispatch; you must know the task before calling the tool.

---

### 2. `spawn_parallel_tasks`

Spawns two or more subtasks, either sequentially (default) or concurrently.

**When to use:**

- You have a fixed, known set of subtasks to run.
- The subtasks are independent of each other (for concurrent mode) or have a simple ordering (for sequential mode).
- You want to reduce wall-clock time by running independent work simultaneously (`concurrent: true`).

**Key parameters:**

| Parameter          | Type           | Required | Default        | Description                                                         |
| ------------------ | -------------- | -------- | -------------- | ------------------------------------------------------------------- |
| `workers`          | `WorkerSpec[]` | Yes      | —              | Pool of worker agents (name + mode).                                |
| `task_list`        | `string[]`     | Yes      | —              | Ordered list of task descriptions to distribute.                    |
| `abort_on_failure` | `boolean`      | No       | `false`        | Stop dispatching new tasks when any worker fails.                   |
| `backend`          | `string`       | No       | `"in_process"` | `"in_process"` (default) or `"cli"` (headless processes, skeleton). |

Each `WorkerSpec` has `name` (required), `mode` (required), and `color` (optional).

**Minimal example:**

```json
{
	"tool": "spawn_swarm",
	"workers": [
		{ "name": "worker-1", "mode": "code" },
		{ "name": "worker-2", "mode": "code" }
	],
	"task_list": [
		"Add input validation to src/api/users.ts",
		"Add input validation to src/api/orders.ts",
		"Add input validation to src/api/products.ts",
		"Add input validation to src/api/payments.ts"
	]
}
```

Two workers split four tasks: each takes two, running the first simultaneously, then picking up a second as they finish.

**Limitations:**

- Workers do not share state and do not communicate with each other.
- No role specialization per task — all workers use the same mode (or you define different worker specs for different task types, but the queue assignment is first-come-first-served, not role-matched).
- The `cli` backend (`morse-worker`) is a skeleton and not ready for production use.
- Coordination loop times out after 120 seconds if a worker stops responding.

See [swarm.md](./swarm.md) for the full reference.

---

## Decision Guide

Use this table to pick the right tool.

| Situation                                                       | Recommended tool                    |
| --------------------------------------------------------------- | ----------------------------------- |
| One subtask, need result before continuing                      | `new_task`                          |
| Multiple independent tasks, fixed set, run in parallel          | `spawn_parallel_tasks` (concurrent) |
| Multiple tasks with dependencies, must run in order             | `spawn_parallel_tasks` (sequential) |
| Repeatable phased workflow defined in a config file             | `run_team_phase`                    |
| Large task list, want automatic load balancing across workers   | `spawn_swarm`                       |
| Dynamic task generation where new tasks emerge during execution | `spawn_swarm`                       |
| Need named roles and per-phase conventions                      | `run_team_phase`                    |

### Flowchart

```text
Is the task list known and fixed ahead of time?
├── No → spawn_swarm
└── Yes
    │
    Is it a single task?
    ├── Yes → new_task
    └── No (2 or more tasks)
        │
        Is this a repeatable workflow with named phases and a config file?
        ├── Yes → run_team_phase
        └── No
            │
            Are the tasks independent (no ordering dependencies)?
            ├── Yes → spawn_parallel_tasks (concurrent: true)
            └── No → spawn_parallel_tasks (sequential, default)
```

---

## Common Patterns

### Discovery then implementation

Use `spawn_parallel_tasks` (concurrent) for discovery, then `new_task` for implementation:

```text
Phase 1: spawn_parallel_tasks (concurrent)
  - architect: analyze backend requirements
  - architect: analyze frontend requirements

Phase 2: new_task
  - code: implement based on discovery output
```

Or define this as a Team with two phases for repeatability.

### Large batch processing

Use `spawn_swarm` when you have many uniform tasks:

```json
{
	"tool": "spawn_swarm",
	"workers": [
		{ "name": "a", "mode": "code" },
		{ "name": "b", "mode": "code" },
		{ "name": "c", "mode": "code" }
	],
	"task_list": [
		"Write tests for module A",
		"Write tests for module B",
		"Write tests for module C",
		"Write tests for module D",
		"Write tests for module E",
		"Write tests for module F"
	]
}
```

Three workers handle six tasks — each takes two tasks.

### Structured full-stack feature

Use a Team for a repeatable workflow across projects:

```text
Phase 1 (discovery, concurrent, requires approval):
  - Backend Architect
  - Frontend Architect

Phase 2 (implementation, sequential):
  - Backend Engineer (worktree: feat/{{team}}-backend)
  - Frontend Engineer (worktree: feat/{{team}}-frontend)

Phase 3 (review, concurrent):
  - Security Reviewer
  - QA Engineer
```

See [teams.md](./teams.md) and `.roo/teams/fullstack.json` for a complete implementation.
