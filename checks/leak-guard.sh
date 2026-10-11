#!/usr/bin/env bash
# check: leak-guard
# born: 2026-10-11
# failure: this repo is public and sits next to private design material that a stray `git add` could publish
# rule: no staged or tracked path matches the private-path pattern, and gitleaks finds no secret
set -euo pipefail

pattern='^\.internal|PROGRESS\.md|PRD\.md|SDD\.md|DECISIONS\.md|golden/|refs/|\.env$|settings\.local\.json'

case "${1:-}" in
  --staged) paths="$(git diff --cached --name-only --diff-filter=ACMR)" ;;
  --tracked) paths="$(git ls-files)" ;;
  *) echo "usage: checks/leak-guard.sh --staged|--tracked" >&2; exit 2 ;;
esac

blocked="$(printf '%s\n' "$paths" | grep -E "$pattern" || true)"
if [ -n "$blocked" ]; then
  echo "leak-guard: private path in the public repo:" >&2
  printf '%s\n' "$blocked" | sed 's/^/  /' >&2
  exit 1
fi

if command -v gitleaks >/dev/null 2>&1; then
  if [ "$1" = "--staged" ]; then
    gitleaks protect --staged --redact --no-banner
  else
    gitleaks detect --redact --no-banner
  fi
fi
