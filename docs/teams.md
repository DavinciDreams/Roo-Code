# Teams

This document is the technical reference for the Morse Code Teams feature.

## Overview

Teams are pre-configured, phased multi-agent workflows defined in `.roo/teams/<slug>.json` inside your workspace. An orchestrator agent reads the config, advances through each named phase in order, and invokes specialist agents per phase using the `run_team_phase` tool. Use teams when a task is too large or too cross-cutting for a single agent — for example, building a full-stack feature that benefits from dedicated backend, frontend, and review agents working in a structured sequence.

---

## Quick Start

**1. Create the config file.**

```
.roo/teams/my-team.json
```

Minimal valid config:

```json
{
	"slug": "my-team",
	"name": "My Team",
	"phases": [
		{
			"name": "build",
			"agents": [
				{
					"mode": "code",
					"instruction": "Implement the following task: {{task}}"
				}
			]
		}
	]
}
```

**2. Invoke the team.**

Switch to `orchestrator` mode (or whatever mode is specified in `orchestratorMode`) and give the agent the task description. The orchestrator reads the config with `read_file`, then calls `run_team_phase` once per phase in order.

---

## Config File Schema

### `TeamConfig`

Top-level object in the `.json` file.

| Field              | Type          | Required | Default       | Description                                                                                                                                                       |
| ------------------ | ------------- | -------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`             | `string`      | Yes      | —             | Unique identifier used in `run_team_phase` calls and skill registration (e.g., `"fullstack"`). Must match the filename stem.                                      |
| `name`             | `string`      | Yes      | —             | Human-readable team name shown in listings (e.g., `"Full-Stack Dev Team"`).                                                                                       |
| `description`      | `string`      | No       | —             | Short description of what the team does. Shown in team listings.                                                                                                  |
| `phases`           | `TeamPhase[]` | Yes      | —             | Ordered list of phases. The orchestrator executes them in array order.                                                                                            |
| `conventions`      | `string`      | No       | —             | Workspace-relative path to a Markdown file containing shared conventions. The content is injected into every agent's message inside a `<team_conventions>` block. |
| `orchestratorMode` | `string`      | No       | `"architect"` | Mode slug for the orchestrating task. Informs skill/invocation setup.                                                                                             |
| `$source`          | `string`      | No       | —             | Auto-populated with the source file path at load time. Do not set this manually.                                                                                  |

### `TeamPhase`

An entry in the `phases` array.

| Field                 | Type              | Required | Default | Description                                                                                                                                              |
| --------------------- | ----------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                | `string`          | Yes      | —       | Phase identifier used when calling `run_team_phase` (e.g., `"discovery"`). Must be unique within the team.                                               |
| `label`               | `string`          | No       | `name`  | Human-readable label for UI display. Defaults to `name` if omitted.                                                                                      |
| `concurrent`          | `boolean`         | No       | `false` | When `true`, all agents in the phase start simultaneously. When `false`, agents run one at a time in array order.                                        |
| `requireApproval`     | `boolean`         | No       | `false` | When `true`, signals the orchestrator to pause and request user confirmation before the phase starts. See [Phase Approval Gates](#phase-approval-gates). |
| `abortOnChildFailure` | `boolean`         | No       | `false` | When `true` and `concurrent` is also `true`, cancels all remaining sibling agents as soon as one fails. Has no effect in sequential mode.                |
| `agents`              | `TeamAgentSpec[]` | Yes      | —       | Agents to run in this phase. Must contain at least one entry.                                                                                            |

### `TeamAgentSpec`

An entry in a phase's `agents` array.

| Field         | Type     | Required | Default | Description                                                                                                                                                                                               |
| ------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | `string` | Yes      | —       | Mode slug for the agent (e.g., `"code"`, `"architect"`).                                                                                                                                                  |
| `role`        | `string` | No       | —       | Role label shown in results (e.g., `"Backend Engineer"`). Optional; for readability and result attribution.                                                                                               |
| `instruction` | `string` | Yes      | —       | Instruction template sent to the agent. Supports template variables (see below).                                                                                                                          |
| `worktree`    | `string` | No       | —       | Git worktree isolation. `"auto"` creates a new branch and worktree automatically. Any other string is used as the branch name and supports template variables. See [Worktree Support](#worktree-support). |

---

## Template Variables

The `instruction` field (and the `worktree` field) support the following placeholders. They are substituted at execution time before the instruction is sent to the agent.

| Variable      | Expands to                                                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{task}}`    | The original user task description passed as the `task` parameter to `run_team_phase`. Pass the same value for every phase so all agents share the original intent.                                                                                              |
| `{{context}}` | The `context` parameter passed to `run_team_phase` — a JSON string of accumulated results from all prior phases. Empty or `null` for the first phase. Use this to forward discovery output to implementation agents, and implementation output to review agents. |
| `{{phase}}`   | The `name` of the currently executing phase (e.g., `"discovery"`). Useful when a generic instruction template is shared across phases.                                                                                                                           |
| `{{team}}`    | The `slug` of the team (e.g., `"fullstack"`). Most useful in the `worktree` field to create team-namespaced branch names.                                                                                                                                        |

Example using multiple variables in a single instruction:

```json
{
	"mode": "code",
	"instruction": "Phase: {{phase}}\nTask: {{task}}\n\nPrior context:\n{{context}}\n\nImplement the changes described above."
}
```

---

## Execution Modes

### Sequential (default)

When `concurrent` is `false` (or omitted), agents in the phase run one at a time in the order they appear in the `agents` array. Each agent completes before the next starts. Results are aggregated and returned together after the last agent finishes.

Sequential mode is appropriate when agents in a phase have implicit dependencies on each other's output — for example, a migration agent that must finish before an integration agent runs.

### Concurrent

When `concurrent` is `true`, all agents in the phase start simultaneously. The orchestrator receives aggregated results when every agent in the phase has finished (or one has failed, if `abortOnChildFailure` is set).

Concurrent mode reduces wall-clock time when agents are independent. The `discovery` phase in `fullstack.json` uses concurrent mode because the backend and frontend architects can analyze their respective concerns in parallel without waiting for each other.

### `abortOnChildFailure`

Applicable only when `concurrent: true`. When set to `true`, any agent failure in the phase immediately cancels all other in-progress sibling agents. This prevents wasted work — for example, if the backend implementation fails there is no point in letting the frontend implementation continue independently.

Has no effect in sequential mode because each agent already runs to completion (or failure) before the next one starts.

---

## Conventions File

The optional `conventions` field in `TeamConfig` points to a workspace-relative path of a Markdown file:

```json
{
	"conventions": ".roo/teams/conventions/fullstack.md"
}
```

The file should contain style rules, coding standards, naming conventions, or any other shared instructions that every agent in every phase should follow. The content is automatically injected into every agent's message inside a `<team_conventions>` block before the agent's own `instruction`.

Use the conventions file to avoid repeating boilerplate across agent instructions — for example, language preferences, error-handling conventions, or output format requirements.

---

## Orchestrator Loop

The orchestrator mode follows this loop when running a team. This pattern is described in the `run_team_phase` tool definition and should be treated as the canonical execution contract.

**Step 1 — Read the config.**

Call `read_file` on `.roo/teams/<slug>.json` to load the phase list and inspect `requireApproval` flags before starting any work.

**Step 2 — Iterate over phases.**

For each phase in the `phases` array, in order:

a. If `requireApproval` is `true`, call `ask_followup_question` to request user sign-off before proceeding. Wait for confirmation.

b. Call `run_team_phase` with:

- `team_slug` — the team's `slug` value
- `phase_name` — the phase's `name` value
- `task` — the original user task, unchanged, passed through every phase
- `context` — the JSON-stringified accumulated results from all prior phases (`null` for the first phase)

c. Append the phase results to the accumulated context for use in subsequent phases.

**Step 3 — Complete.**

After the last phase, call `attempt_completion` with a final summary drawn from the accumulated results.

**Constraint:** `run_team_phase` must be called alone — do not invoke it alongside other tools in the same turn.

TypeScript pseudocode for reference:

```typescript
// Orchestrator pseudocode — not executable, illustrative only
const config = JSON.parse(await readFile(`.roo/teams/${slug}.json`))
let context: string | null = null

for (const phase of config.phases) {
	if (phase.requireApproval) {
		await askFollowupQuestion(`Ready to start phase "${phase.label ?? phase.name}". Proceed?`)
	}

	const result = await runTeamPhase({
		team_slug: config.slug,
		phase_name: phase.name,
		task: originalTask,
		context,
	})

	context = JSON.stringify({ ...JSON.parse(context ?? "{}"), [phase.name]: result })
}

await attemptCompletion(summarize(context))
```

---

## Full Example

The canonical example is `.roo/teams/fullstack.json`. It defines a three-phase team for building full-stack features.

```json
{
	"slug": "fullstack",
	"name": "Full-Stack Feature Team",
	"description": "Three-phase team for building full-stack features: discovery → implementation → review",
	"orchestratorMode": "orchestrator",
	"conventions": ".roo/teams/conventions/fullstack.md",
	"phases": [
		{
			"name": "discovery",
			"label": "Discovery & Planning",
			"concurrent": true,
			"requireApproval": true,
			"agents": [
				{
					"mode": "architect",
					"role": "Backend Architect",
					"instruction": "Analyze the backend requirements for the following task and produce a detailed technical spec.\n\nTask: {{task}}\n\nDeliverables:\n- API endpoints needed (method, path, request/response shapes)\n- Database schema changes (if any)\n- Key implementation risks or unknowns\n\nOutput as structured markdown."
				},
				{
					"mode": "architect",
					"role": "Frontend Architect",
					"instruction": "Analyze the frontend requirements for the following task and produce a detailed technical spec.\n\nTask: {{task}}\n\nDeliverables:\n- Component tree and data flow\n- State management approach\n- API integration points\n- UX edge cases to handle\n\nOutput as structured markdown."
				}
			]
		},
		{
			"name": "implementation",
			"label": "Implementation",
			"concurrent": false,
			"requireApproval": false,
			"abortOnChildFailure": true,
			"agents": [
				{
					"mode": "code",
					"role": "Backend Engineer",
					"instruction": "Implement the backend changes for this task.\n\nTask: {{task}}\n\nDiscovery results:\n{{context}}\n\nWrite production-quality code. Run tests after each significant change. Do not leave TODOs.",
					"worktree": "feat/{{team}}-backend"
				},
				{
					"mode": "code",
					"role": "Frontend Engineer",
					"instruction": "Implement the frontend changes for this task.\n\nTask: {{task}}\n\nDiscovery results:\n{{context}}\n\nWrite production-quality code. Ensure the UI handles loading, error, and empty states. Do not leave TODOs.",
					"worktree": "feat/{{team}}-frontend"
				}
			]
		},
		{
			"name": "review",
			"label": "Code Review",
			"concurrent": true,
			"requireApproval": false,
			"agents": [
				{
					"mode": "code",
					"role": "Security Reviewer",
					"instruction": "Review the implementation for security issues.\n\nTask: {{task}}\n\nImplementation summary:\n{{context}}\n\nFocus on: input validation, auth/authz, injection risks, sensitive data exposure. Output a list of findings (severity: critical/high/medium/low) with suggested fixes."
				},
				{
					"mode": "code",
					"role": "QA Engineer",
					"instruction": "Review the implementation for correctness and test coverage.\n\nTask: {{task}}\n\nImplementation summary:\n{{context}}\n\nFocus on: missing test cases, edge cases not handled, regression risks. Output a list of findings with suggested test additions."
				}
			]
		}
	]
}
```

**Phase breakdown:**

| Phase | `name`           | `concurrent` | `requireApproval` | What happens                                                                                                                                                                                                                                          |
| ----- | ---------------- | ------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `discovery`      | `true`       | `true`            | The orchestrator pauses for user approval, then runs the Backend Architect and Frontend Architect in parallel. Each produces a technical spec using only `{{task}}`. No prior context is available yet.                                               |
| 2     | `implementation` | `false`      | `false`           | Runs sequentially. Backend Engineer executes first, then Frontend Engineer. `{{context}}` contains the discovery specs. Each agent works in an isolated git worktree. `abortOnChildFailure: true` means a backend failure cancels the frontend agent. |
| 3     | `review`         | `true`       | `false`           | Security Reviewer and QA Engineer run concurrently. `{{context}}` contains both the discovery specs and the implementation summaries from phase 2.                                                                                                    |

---

## Phase Approval Gates

Setting `requireApproval: true` on a phase does not cause `run_team_phase` to pause automatically. It is a declarative signal to the orchestrator that it should call `ask_followup_question` before calling `run_team_phase` for that phase.

This design keeps the approval UX under the orchestrator's control — the orchestrator can customize the approval message, include a summary of what the phase will do, or skip the gate conditionally based on accumulated context.

**Pattern:**

```json
{
  "name": "deployment",
  "label": "Deploy to Production",
  "requireApproval": true,
  "agents": [...]
}
```

The orchestrator should detect this flag during its config-reading step (before the loop starts) so it knows which phases will need a gate, rather than checking at call time.

---

## Worktree Support

The optional `worktree` field on a `TeamAgentSpec` isolates that agent's file operations in a separate git worktree, preventing concurrent agents from stepping on each other's changes.

**Values:**

| Value            | Behavior                                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| `"auto"`         | Morse Code creates a new branch and worktree automatically. Branch name is generated. |
| Any other string | Used directly as the branch name. Template variables are supported.                   |

**Template interpolation in `worktree`:**

The `worktree` field supports the same variables as `instruction`. The most common pattern uses `{{team}}` and a role-specific suffix:

```json
{
	"worktree": "feat/{{team}}-backend"
}
```

With `team.slug = "fullstack"` this expands to `feat/fullstack-backend`. Each agent on the same team gets its own isolated branch, making it straightforward to review, merge, or discard each agent's changes independently.

**When to use worktrees:**

Use `worktree` when agents in the same phase or across phases modify overlapping files concurrently. The `implementation` phase in `fullstack.json` is sequential but still uses worktrees because the backend and frontend agents may touch shared files (e.g., `package.json`, shared types) and the team convention is to keep their changes on separate branches until a human-reviewed merge.
