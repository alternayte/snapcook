# AGENTS.md

## What this is

The public repo for SnapCook. It holds no application code yet, and the design material lives in a private repo linked at `.internal`.

## Run

No run command exists yet.

## Test

No test command or gate exists yet.
`.githooks/pre-commit` rejects staged private paths and runs gitleaks when it is installed.
A fresh clone enables the hook with `git config core.hooksPath .githooks`.

## Stack rules

- This repo is public. Product details, pricing and spec text stay out of every tracked file.
- If `.internal/SDD.md` exists, read its 'Re-entrant build prompt' section and follow its session protocol.
- Commit messages use the form step N: <change>.

## Domain words

None yet.
