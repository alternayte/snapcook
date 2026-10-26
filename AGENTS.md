# AGENTS.md

## What this is

The public repo for SnapCook: a Bun workspace that holds an Expo app, a Hono API and a command-line tool, with shared code in `packages/`. The design material lives in a private repo linked at `.internal`.

## Run

- `bun install` installs every workspace.
- `just dev` starts the API and the browser preview of the app.
- `just up` starts the full stack in Docker. It needs a root env file copied from `infra/.env.example`.

## Test

- `just check` runs every check in one pass.
- `bun run format` fixes lint and format errors.
- `.githooks/pre-commit` runs `checks/leak-guard.sh` on staged changes.
- A fresh clone enables the hook with `git config core.hooksPath .githooks`.

## Stack rules

- This repo is public. Product details, pricing and spec text stay out of every tracked file.
- If `.internal/SDD.md` exists, read its 'Re-entrant build prompt' section and follow its session protocol.
- Commit messages use the form step N: <change>.
- The Bun version is pinned in `package.json`. Use that version for installs, so the lockfile stays stable.
- Lint and format use Biome, configured in `biome.json`.
- Tests outside the app use the Bun test runner.
- Types cross workspaces as declaration files. Run `bun run typecheck` after a change to an exported type.
- Every user-facing string in the app comes from `apps/mobile/lib/messages/en.ts`.

## Domain words

- official recipe: a recipe the app ships with, written and checked by the corpus pipeline. Avoid: built-in recipe, curated recipe.
- community recipe: a household recipe that its household shared to the public list. Avoid: user-submitted recipe, public recipe.
- household recipe: a recipe one household imported and owns, private unless shared; its chip label is "Mine". Avoid: custom recipe, user recipe, private recipe.
