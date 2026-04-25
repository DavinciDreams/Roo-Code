# Contributing to Morse Code

Morse Code is a personal fork of [Roo Code](https://github.com/RooCodeInc/Roo-Code). It adds a multi-agent orchestration layer (Teams, Swarm, parallel tasks) and a headless CLI on top of the upstream extension. This guide covers everything you need to contribute without reading upstream documentation.

---

## Prerequisites

- **Node.js 20.19.2** — the version pinned in `.nvmrc`. If you use nvm: `nvm use`.
- **pnpm 10.8.1** — the package manager. Install with `npm install -g pnpm@10.8.1`.
- **VS Code** — required for running and debugging the extension.
- **Git** with worktree support (any recent version).

---

## Getting Started

**1. Clone the repository.**

```bash
git clone https://github.com/davincidreams/Roo-Code.git morse-code
cd morse-code
```

**2. Install dependencies.**

```bash
pnpm install
```

The `preinstall` script runs `scripts/bootstrap.mjs` automatically. Do not use `npm install` or `yarn` — the repository enforces pnpm via `only-allow`.

**3. Build all packages.**

```bash
pnpm build
```

This runs Turborepo across all workspaces. The first build takes a couple of minutes. Subsequent builds are cached.

**4. Launch in VS Code.**

Open the repository root in VS Code, then press `F5`. This starts the Extension Development Host — a separate VS Code window with the extension loaded from source. Changes to `src/` require re-running `pnpm build` (or use `pnpm bundle --watch` for incremental rebuilds during active development).

---

## Repository Layout

```text
apps/cli/         Headless "roo" binary
apps/web-evals/   Eval run management UI
packages/types/   Shared TypeScript types (@roo-code/types)
packages/core/    Shared business logic (no VS Code dependency)
src/              The VS Code extension
webview-ui/       React frontend rendered in the sidebar panel
.roo/             Project-level config: rules, skills, teams
docs/             Documentation
```

See [docs/architecture.md](docs/architecture.md) for a full layout explanation.

---

## Running Tests

Tests use [Vitest](https://vitest.dev/). **Run tests from inside the workspace that contains the `vitest` dependency**, not from the repository root.

```bash
# Extension backend tests
cd src && npx vitest run

# Run a specific test file (path relative to src/)
cd src && npx vitest run core/tools/__tests__/SpawnSwarmTool.test.ts

# CLI tests
cd apps/cli && npx vitest run

# Webview UI tests
cd webview-ui && npx vitest run

# All workspaces via Turborepo (slower, full output)
pnpm test
```

Do not run `npx vitest` from the repository root — it will fail with "vitest: command not found".

All tests must pass before a PR is merged.

---

## Linting and Type Checking

```bash
# Lint all packages
pnpm lint

# Type-check all packages
pnpm check-types

# Format all packages
pnpm format
```

Turborepo caches these results. After a clean run, unchanged packages are skipped.

Do not disable ESLint rules without explicit approval from a maintainer. Use `// eslint-disable-next-line <rule> -- <reason>` if a suppression is genuinely necessary.

---

## Code Style

The canonical style rules are in `.roo/rules/rules.md`. Key points:

- **Tailwind CSS** for new UI markup in `webview-ui/`. Do not use inline style objects. VSCode CSS variables must be added to `webview-ui/src/index.css` before using them in Tailwind classes.
- **TypeScript strict mode** (`strict: true`). Do not use `any` without a comment.
- **One tool, one file, one class** in `src/core/tools/`. Tools are stateless singletons.
- **No VS Code imports in `packages/`.** Use `packages/vscode-shim` when VS Code types are needed outside the extension host.
- **Test coverage.** Any code change must include or update tests.

---

## Changeset Workflow

This repository uses [Changesets](https://github.com/changesets/changesets) for versioning.

**Before opening a PR that changes user-facing behavior:**

```bash
pnpm changeset
```

This launches an interactive prompt asking you to:

1. Select which packages are affected (usually `roo-code` for extension changes).
2. Choose a bump type: `patch` (bug fix), `minor` (new feature), `major` (breaking change).
3. Write a short description of the change for the changelog.

Commit the generated `.changeset/*.md` file alongside your code changes.

**If your PR is a refactor, documentation change, or test-only change** that does not affect published behavior, you do not need a changeset. Add a note in your PR description explaining this.

---

## PR Process

**Branch naming:** Use `feat/<short-description>`, `fix/<short-description>`, or `chore/<short-description>`. The active development branch for the swarm system is `feat/cli-enhancements`.

**Before opening a PR:**

1. Rebase on the latest `main`: `git fetch origin && git rebase origin/main`.
2. Run `pnpm lint && pnpm check-types && pnpm test` and confirm everything passes.
3. Add a changeset if the change is user-facing.

**PR description should include:**

- What the change does (user-facing description).
- Why it is needed or what problem it solves.
- How to test it manually (steps, expected outcome).
- Screenshots or terminal output for UI or CLI changes.
- Links to any related issues or prior art.

**Review process:** PRs are reviewed by the maintainer (`davincidreams`). Address all review comments before requesting re-review. Keep PRs focused — one feature or fix per PR.

---

## Fork-Specific Features

When working on fork-specific features, read the relevant documentation first:

| Feature               | Documentation                     | Key source files                                            |
| --------------------- | --------------------------------- | ----------------------------------------------------------- |
| Swarm                 | `docs/swarm.md`                   | `src/core/swarm/`, `src/core/tools/SpawnSwarmTool.ts`       |
| Teams                 | `docs/teams.md`                   | `src/services/teams/`, `src/core/tools/RunTeamPhaseTool.ts` |
| Parallel tasks        | `docs/multi-agent.md`             | `src/core/tools/SpawnParallelTasksTool.ts`                  |
| Skills                | `docs/skills.md`                  | `src/services/skills/`, `src/core/tools/SkillTool.ts`       |
| CLI                   | `apps/cli/README.md` (if present) | `apps/cli/src/`                                             |
| Architecture overview | `docs/architecture.md`            | `src/extension.ts`, `src/core/webview/ClineProvider.ts`     |

The internal PRD for the swarm system is at `docs/prd-swarm-multi-agent.md` and describes the phased delivery plan.

---

## Building the Extension Package (VSIX)

```bash
# Build and package as a .vsix file
pnpm vsix

# Install the .vsix into the current VS Code installation
pnpm install:vsix
```

The `.vsix` output lands in the `dist/` directory.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE), the same license as this project and the upstream Roo Code repository.
