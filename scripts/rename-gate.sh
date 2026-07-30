#!/usr/bin/env bash
# rename-gate.sh — prove that a "pure accessor rename" commit is exactly that.
#
# WHY THIS EXISTS (INIT-02 S8/S12/S20). When a step retargets hundreds of test
# call sites from `store.<x>` to `store.<collaborator>.<x>`, a green suite is the
# WEAKEST evidence in the repo: retargeted tests are the cheapest thing to
# accidentally weaken, and every heuristic gate we tried is blind to it —
#   · a substring whitelist (`rg -v 'store\.arrangement\.'`) cannot see a changed
#     expected value, because the retargeted line necessarily contains the new
#     accessor, so `toBe(3)` -> `toBe(2)` on that same line passes;
#   · equal per-file numstat is preserved by ANY 1-for-1 line edit;
#   · the inverse filter is worse than useless — every REMOVED line still says
#     `store.newShow(`, matches no `store\.library\.` pattern, and so the filter
#     emits the whole minus side of the diff and gets waived at exactly the
#     commit that most needs it.
#
# So this is a PROOF, not a heuristic: apply the declared rename map mechanically
# to the PRE-IMAGE of each file and require the result to be byte-identical to
# the post-image. Anything the map does not explain — a changed assertion, a
# dropped case, a "while I was in here" tidy — shows up as diff output and fails.
# A residue is never a reason to relax the gate: it is either a missed rename
# (extend the map) or a real edit (split it into its own commit, or justify it in
# the commit body).
#
# Usage:
#   scripts/rename-gate.sh <map> <base-ref> <file>...
#   scripts/rename-gate.sh sections HEAD~1 apps/web/src/lib/trigger-lab/store.sections.test.ts
#
# perl, not sed, does the substitution: the map needs a word boundary so
# `store.activeSection` does not match inside `store.activeSectionId`, and that
# is spelled `\b` in GNU sed but `[[:<:]]`/`[[:>:]]` in the BSD sed macOS ships.
# perl is present on both and means one expression, one behaviour.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <map> <base-ref> <file>..." >&2
  exit 2
fi

map=$1
base=$2
shift 2

# Each map is a perl substitution over the accessor path. Longest member names
# come FIRST in each alternation: perl tries alternatives left to right, so
# listing `activeSection` before `activeSectionId` would leave a trailing `Id`.
case "$map" in
  sections)
    expr='s/\bstore\.(activeSectionId|sectionClipboard|activeSection|sections|addGraphToSection|removeGraphFromSection|setSectionGraphs|moveGraphPlacement|moveSection|setLook|addSongSection|renameSection|removeSection|copySection|pasteSection|duplicateSection)\b/store.arrangement.$1/g'
    ;;
  *)
    echo "rename-gate: unknown map '$map' (known: sections)" >&2
    exit 2
    ;;
esac

status=0
for file in "$@"; do
  if ! residue=$(git show "$base:$file" | perl -pe "$expr" | diff - "$file"); then
    printf 'rename-gate[%s]: RESIDUE in %s — not explained by the rename map:\n' "$map" "$file" >&2
    printf '%s\n' "$residue" >&2
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  printf 'rename-gate[%s]: clean over %d file(s) — every changed line is the declared rename.\n' "$map" "$#"
fi
exit "$status"
