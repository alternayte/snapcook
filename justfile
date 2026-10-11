# The gate: a change is done when this is green.
check:
    checks/leak-guard.sh --tracked
    bun run lint
    bun run typecheck
    bun run test

# Bring up the whole stack with Docker Compose.
up *args:
    docker compose -f infra/docker-compose.yml up --build {{args}}

# Run the end-to-end UI flows.
e2e *args:
    maestro test apps/mobile/.maestro {{args}}

# Run an evaluation through the corpus CLI, for example `just eval detect`.
eval *args:
    bun apps/corpus/src/cli.ts eval {{args}}
