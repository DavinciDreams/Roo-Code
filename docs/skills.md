# Skills

This document is the reference for the Morse Code Skills system.

## Overview

Skills are reusable, named bundles of AI agent instructions. A skill lives in a `SKILL.md` file inside a `.roo/skills/<name>/` directory. When an agent invokes a skill by name, the extension reads that file, presents it to the user for approval, and returns the skill's instructions as context to the agent's conversation.

Skills solve the problem of repeated boilerplate in agent prompts. Instead of pasting the same background context, conventions, or step-by-step procedures into every task message, you define them once as a skill and invoke them by name.

---

## What Skills Are Not

**Skills are not custom modes.** A custom mode changes the agent's system prompt for an entire conversation. A skill injects additional instructions into a single tool call within a conversation. Use modes to define a specialist agent persona; use skills to provide reusable context or procedures on demand.

**Skills are not Teams.** Teams define a multi-agent workflow with named phases. Skills are single-agent instruction sets. A team agent could invoke a skill as part of its work, but the skill itself is not a workflow.

---

## The `SKILL.md` File Format

A skill is a directory containing a single `SKILL.md` file. The directory name is the skill's name.

```
.roo/skills/my-skill/
└── SKILL.md
```

`SKILL.md` uses YAML frontmatter followed by Markdown body content.

### Frontmatter fields

| Field         | Type       | Required | Description                                                                                                                           |
| ------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`   | Yes      | The skill name. Must exactly match the parent directory name. Used for lookup and validation.                                         |
| `description` | `string`   | Yes      | One-sentence description shown in skill listings and error messages. Must be 1–1024 characters after trimming.                        |
| `modeSlugs`   | `string[]` | No       | List of mode slugs this skill is available in (e.g., `["code", "architect"]`). Omit or leave empty to make it available in all modes. |

**Name validation rules:**

- Must match the parent directory name exactly.
- Must follow the agentskills.io naming spec: lowercase alphanumeric characters and hyphens, no leading or trailing hyphens.
- Maximum length enforced by the shared `SKILL_NAME_MAX_LENGTH` constant.

### Body

The Markdown body (everything after the closing `---` of the frontmatter) is the skill's instructions. This content is returned verbatim to the agent when the skill is invoked (after user approval). Write it as if you were writing instructions for a human — clear, direct, and complete.

### Minimal example

````markdown
---
name: api-conventions
description: Provides our REST API naming and error-handling conventions for implementation tasks.
---

# API Conventions

## Endpoint Naming

- Use kebab-case for URL paths: `/user-profiles`, not `/userProfiles`.
- Version all public endpoints: `/v1/user-profiles`.
- Use plural nouns for collections: `/v1/orders`, not `/v1/order`.

## Error Responses

All errors return JSON with this shape:

```json
{
	"error": {
		"code": "VALIDATION_ERROR",
		"message": "Human-readable message",
		"details": {}
	}
}
```
````

HTTP status codes:

- 400 for validation errors
- 401 for missing or invalid auth
- 403 for insufficient permissions
- 404 for not found
- 500 for unexpected server errors

````

### Mode-restricted example

```markdown
---
name: security-checklist
description: Security review checklist for code review tasks.
modeSlugs:
  - code
  - architect
---

# Security Review Checklist

Before approving any implementation:

1. Input validation on all user-supplied data
2. Parameterized queries — no string concatenation in SQL
3. Auth checks before data access, not after
4. No secrets in logs or error messages
5. Rate limiting on public endpoints
````

---

## Discovery: Where Skills Are Loaded From

`SkillsManager` scans multiple directories on startup and whenever any `SKILL.md` file changes (via VS Code file watchers). The directories are scanned in priority order — later directories override earlier ones when two skills share the same name.

### Directory priority (lowest to highest)

1. `~/.agents/skills/` — global generic skills
2. `~/.agents/skills-<mode>/` — global mode-specific skills (one directory per mode slug)
3. `<workspace>/.agents/skills/` — project generic skills
4. `<workspace>/.agents/skills-<mode>/` — project mode-specific skills
5. `~/.roo/skills/` — global `.roo` generic skills
6. `~/.roo/skills-<mode>/` — global `.roo` mode-specific skills
7. `<workspace>/.roo/skills/` — project `.roo` generic skills (highest priority)
8. `<workspace>/.roo/skills-<mode>/` — project `.roo` mode-specific skills (highest priority)

`~` is the user's home directory. `<workspace>` is the folder open in VS Code.

### Override rules

When two skills share the same name, the one with higher priority wins:

1. **Source level:** project skills always override global skills of the same name.
2. **Within the same source:** mode-specific skills override generic skills of the same name.
3. **Within the same source and specificity:** the first discovered skill wins (no further override).

This means you can ship a global skill as a baseline and override it per-project without modifying the global file.

### Symlink support

The skills directory itself, or any individual skill subdirectory, may be a symlink. `SkillsManager` resolves symlinks with `fs.realpath` before scanning. The skill's name comes from the symlink name (the directory entry), not from the resolved target.

---

## How to Author a Skill

**Step 1: Choose a location.**

For skills you want available in all projects, use `~/.roo/skills/`. For skills specific to one project, use `<workspace>/.roo/skills/`.

**Step 2: Create the directory.**

The directory name becomes the skill name. Choose a name that is lowercase, hyphenated, and self-describing.

```bash
mkdir -p .roo/skills/my-skill
```

**Step 3: Write `SKILL.md`.**

```bash
touch .roo/skills/my-skill/SKILL.md
```

Open the file and write:

```markdown
---
name: my-skill
description: One sentence describing what this skill provides.
---

Your instructions here.
```

The name in frontmatter must match the directory name exactly.

**Step 4: Optionally restrict to specific modes.**

If the skill only makes sense in certain modes, add `modeSlugs`:

```markdown
---
name: my-skill
description: One sentence describing what this skill provides.
modeSlugs:
    - code
---
```

**Step 5: Verify discovery.**

The extension picks up new skills automatically via file watchers. In the extension's output channel, you can confirm the skill was loaded. If the skill does not appear when invoked, check:

- The directory name matches the `name` field exactly.
- The `SKILL.md` file exists directly inside the named directory (not nested further).
- The `description` is 1–1024 characters and non-empty.

---

## The `skill` Tool

An agent invokes a skill using the `skill` tool.

### Parameters

| Parameter | Type     | Required | Description                                                                    |
| --------- | -------- | -------- | ------------------------------------------------------------------------------ |
| `skill`   | `string` | Yes      | The name of the skill to invoke. Must match a discovered skill directory name. |
| `args`    | `string` | No       | Optional arguments forwarded verbatim to the skill's rendered output.          |

### What happens when a skill is invoked

1. The agent calls `skill` with the skill name.
2. `SkillTool` looks up the skill via `SkillsManager.getSkillContent()`, resolving against the current mode.
3. If the skill does not exist for the current mode, the tool returns an error listing the available skills.
4. If the skill exists, the tool calls `askApproval` — the user sees the skill name and a summary of what it will inject.
5. On approval, the skill's `SKILL.md` body is returned as the tool result and appended to the conversation. The agent can then follow the instructions in the skill.
6. On denial, the tool exits without modifying the conversation.

### Example agent invocation

```json
{
	"tool": "skill",
	"skill": "api-conventions"
}
```

### Example with args

```json
{
	"tool": "skill",
	"skill": "security-checklist",
	"args": "focus on authentication flows"
}
```

The `args` string is passed to the skill renderer and included in the returned content so the agent can see what context was requested.

---

## Skills vs. Custom Modes vs. Teams

| Question                                   | Use skills | Use custom modes    | Use Teams      |
| ------------------------------------------ | ---------- | ------------------- | -------------- |
| Reuse instructions across many tasks?      | Yes        | Yes (system prompt) | No             |
| Instructions injected on demand, mid-task? | Yes        | No                  | No             |
| Define a specialist agent persona?         | No         | Yes                 | Partial        |
| Coordinate multiple agents in sequence?    | No         | No                  | Yes            |
| Dynamic task queue across agents?          | No         | No                  | No (use Swarm) |

**Rule of thumb:** If you find yourself copying the same background context into multiple task messages, extract it into a skill. If you want the agent to always behave a certain way (tools allowed, system prompt style), define a custom mode. If you need multiple agents working in phases, use Teams.

---

## Managing Skills via the UI

The Morse Code extension provides a skills management UI in the settings panel. From there you can:

- View all discovered skills, their source (global/project), and their mode restrictions.
- Create a new skill (the extension generates the directory and template `SKILL.md`).
- Delete a skill (removes the entire skill directory).
- Move a skill between modes (updates the `modeSlugs` field in frontmatter).

Creating a skill via the UI is equivalent to manually creating the directory and `SKILL.md` file.
