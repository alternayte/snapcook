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

# Run the API and the browser preview of the app together.
dev:
    #!/usr/bin/env bash
    trap 'kill 0' EXIT
    CORS_ORIGINS=http://localhost:8081 bun --watch apps/api/src/index.ts &
    cd apps/mobile && bunx expo start --web --port 8081
