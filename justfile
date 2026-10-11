# The gate: a change is done when this is green.
check: test-db
    checks/leak-guard.sh --tracked
    bun run lint
    bun run typecheck
    bun run test

# Bring up the whole stack with Docker Compose.
up *args:
    docker compose --env-file .env -f infra/docker-compose.yml up --build {{args}}

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

# Start the throwaway Postgres that the tests use. Its data lives in memory.
test-db:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "$(docker ps -q -f name='^snapcook-test-db$')" ]; then
      docker run -d --rm --name snapcook-test-db -e POSTGRES_PASSWORD=test \
        -p 127.0.0.1:54330:5432 --tmpfs /var/lib/postgresql/data pgvector/pgvector:pg17 >/dev/null
    fi
    until docker exec snapcook-test-db psql -U postgres -h 127.0.0.1 -c 'select 1' >/dev/null 2>&1; do
      sleep 0.5
    done
