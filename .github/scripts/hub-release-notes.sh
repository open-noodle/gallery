#!/usr/bin/env bash
# Reads a Gallery release body on stdin and prints the release notes a
# Noodle Cloud hub shows for it: plain lines for people, at most five. The
# headings of "What's in this release" when the notes were written up, else
# the Gallery changes without their conventional-commit prefix and PR number.
set -euo pipefail

body=$(tr -d '\r')

section() {
  printf '%s\n' "$body" | awk -v want="$1" '/^## /{ s = $0; next } s == want { print }'
}

notes=$(section "## What's in this release" | sed -n -E 's/^### +//p')
if [[ -z "$notes" ]]; then
  notes=$(section '## Gallery changes' | sed -n -E 's/^- +//p' |
    sed -E 's/^[a-z]+(\([^)]*\))?!?: +//; s/ +\(#[0-9]+\)$//' |
    awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')
fi
printf '%s\n' "$notes" | sed '/^[[:space:]]*$/d' | head -n 5
