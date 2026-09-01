#!/usr/bin/env bash
# Create the starter issue backlog on GitHub.
#
#   gh auth login
#   ./scripts/seed-issues.sh                 # dry run, prints what it would do
#   ./scripts/seed-issues.sh --apply         # actually creates the issues
#
# Issues carry a `complexity:*` label. When the repository is approved for a
# Wave program, add that program's label to the issues you want contributors to
# pick up — do not label everything at once, and only label work you can review
# inside the wave.

set -euo pipefail

APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$ROOT/scripts/issues.json"

if ! command -v gh >/dev/null && [[ "${1:-}" == "--apply" ]]; then echo "gh CLI is required: https://cli.github.com"; exit 1; fi
command -v jq >/dev/null || { echo "jq is required"; exit 1; }

LABELS=(
  "storage:0E8A16:Persistence and adapters"
  "stellar:1D76DB:Network, contracts, executors"
  "api:5319E7:REST surface"
  "webhooks:B60205:Outbound delivery"
  "ledger:FBCA04:Double-entry accounting"
  "ops:BFD4F2:Running it in production"
  "docs:0075CA:Documentation"
  "testing:D4C5F9:Test suite"
  "tooling:C2E0C6:Build and CI"
  "sdk:006B75:Client libraries"
  "examples:C5DEF5:Sample integrations"
  "correctness:E11D21:Can produce a wrong amount"
  "security:B60205:Security sensitive"
  "complexity:trivial:C2E0C6:Small, well bounded"
  "complexity:medium:FEF2C0:A day or so"
  "complexity:high:F9D0C4:Needs design judgement"
)

create_labels() {
  for entry in "${LABELS[@]}"; do
    name="${entry%:*:*}"; rest="${entry#"$name":}"; colour="${rest%%:*}"; desc="${rest#*:}"
    if $APPLY; then
      gh label create "$name" --color "$colour" --description "$desc" --force >/dev/null
      echo "label  $name"
    else
      echo "[dry-run] label $name ($colour)"
    fi
  done
}

create_issues() {
  local count
  count="$(jq 'length' "$FILE")"
  for ((i = 0; i < count; i++)); do
    local title body labels complexity
    title="$(jq -r ".[$i].title" "$FILE")"
    body="$(jq -r ".[$i].body" "$FILE")"
    complexity="$(jq -r ".[$i].complexity | ascii_downcase" "$FILE")"
    labels="$(jq -r ".[$i].labels | join(\",\")" "$FILE"),complexity:$complexity"

    if $APPLY; then
      gh issue create --title "$title" --body "$body" --label "$labels" >/dev/null
      echo "issue  $title"
    else
      echo "[dry-run] issue  [$complexity] $title  ($labels)"
    fi
  done
  echo
  if $APPLY; then echo "$count issues created."; else echo "$count issues would be created."; fi
}

create_labels
create_issues

$APPLY || echo $'\nNothing was created. Re-run with --apply.'
