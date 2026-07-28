#!/usr/bin/env python3
"""Phase 5 batch 1: apply the 12 land-now dead-code mutations in place.

Adapted from phase3b-combined.py, but:
  - operates directly on the CURRENT worktree (feat/ota-discord-announce),
    no reset/clean — the caller has already verified every touched file is
    byte-identical to baseline 3708648 via `git diff <base>..HEAD --stat`.
  - restricted to exactly the 12 LAND_NOW finding ids below. dead-code-0001
    (HOLD, product question re: patch clipboard/diff UI) and dead-code-0002
    (separate decision re: kit mirror) are excluded — this script does not
    even load their mutation defs into `todo`.
  - asserts total edits applied == EXPECTED_TOTAL (declared ahead of time by
    counting symbols/names across the 12 findings' mutation defs). Any
    mismatch, any unmatched symbol, or any unhandled mutation kind aborts
    with a nonzero exit and NO partial writes left unexplained — this
    mirrors the "never silently skip" contract from phase3b-combined.py: a
    prior run of that script crashed midway on an unhandled kind and left a
    partial tree that still typechecked green (green on the wrong state).
"""
import json, os, re, subprocess, sys

REPO = subprocess.run("git rev-parse --show-toplevel", shell=True,
                       capture_output=True, text=True).stdout.strip()
D = os.path.join(REPO, "docs/plans/2026-07-26-deep-review")
WT = REPO
BASE = "3708648"

LAND_NOW = {
    "dead-code-0003", "dead-code-0004", "dead-code-0005", "dead-code-0006",
    "dead-code-0007", "dead-code-0009", "dead-code-0010", "dead-code-0011",
    "dead-code-0012", "dead-code-0013", "dead-code-0014", "dead-code-0015",
}
# Declared ahead of application by counting symbols/names in phase3b-mutations.json
# for exactly the 12 ids above: 9+1+1+2+2+1+7+1+1+1+5+1 = 32.
EXPECTED_TOTAL = 32

spec = json.load(open(f"{D}/artifacts/phase3b-mutations.json"))
muts = spec["mutations"]

held = set(spec.get("_excluded", {}))
assert "dead-code-0001" in held and "dead-code-0001" not in LAND_NOW, \
    "dead-code-0001 must stay excluded — aborting"

todo = [m for m in muts if m["id"] in LAND_NOW]
missing_ids = LAND_NOW - {m["id"] for m in todo}
if missing_ids:
    print(f"ABORT: findings not found in mutation spec: {sorted(missing_ids)}")
    sys.exit(1)
if len(todo) != len(LAND_NOW):
    print(f"ABORT: expected {len(LAND_NOW)} findings, matched {len(todo)}")
    sys.exit(1)


def unexport(path, syms):
    p = os.path.join(WT, path)
    if not os.path.exists(p):
        return 0, [f"MISSING {path}"]
    s, n, bad = open(p).read(), 0, []
    for sym in syms:
        s, c = re.subn(
            rf"^export\s+((?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+{re.escape(sym)}\b)",
            r"\1", s, flags=re.M)
        n += c
        if not c:
            bad.append(f"NO MATCH {sym} in {path}")
    open(p, "w").write(s)
    return n, bad


applied, problems, files_touched = 0, [], set()
for m in todo:
    k = m["kind"]
    if k == "delete-file":
        # Not expected in LAND_NOW (dead-code-0001 is the only delete-file
        # mutation and it's excluded) — treat as unhandled here on purpose,
        # so an accidental inclusion of a delete-file finding hard-fails
        # instead of silently deleting something.
        problems.append(f"{m['id']}: UNEXPECTED KIND 'delete-file' in LAND_NOW batch")
    elif k == "unexport":
        n, bad = unexport(m["file"], m["symbols"])
        applied += n
        files_touched.add(m["file"])
        problems += [f"{m['id']}: {b}" for b in bad]
    elif k == "unexport-multi":
        for t in m["targets"]:
            n, bad = unexport(t["file"], t["symbols"])
            applied += n
            files_touched.add(t["file"])
            problems += [f"{m['id']}: {b}" for b in bad]
    elif k == "delete-names-from-export-type":
        p = os.path.join(WT, m["file"])
        if not os.path.exists(p):
            problems.append(f"{m['id']}: MISSING {m['file']}")
        else:
            s = open(p).read()
            for nm in m["names"]:
                s, c = re.subn(rf"^\s*{re.escape(nm)},?\s*$\n", "", s, flags=re.M)
                applied += c
                if not c:
                    problems.append(f"{m['id']}: NO MATCH {nm}")
            open(p, "w").write(s)
        files_touched.add(m["file"])
    else:
        problems.append(f"{m['id']}: UNHANDLED KIND '{k}'")  # never silently skip

print(f"mutations: {len(todo)} findings · edits applied: {applied} · files touched: {len(files_touched)}")
print(subprocess.run("git diff --stat | tail -1", shell=True, cwd=WT,
                      capture_output=True, text=True).stdout.strip())

if problems:
    print("\nHARD FAIL — not every mutation applied as declared:")
    for p_ in problems:
        print("  ", p_)
    sys.exit(1)

if applied != EXPECTED_TOTAL:
    print(f"\nHARD FAIL — applied {applied} edits, expected exactly {EXPECTED_TOTAL}")
    sys.exit(1)

print(f"all {len(todo)} findings applied cleanly — {applied}/{EXPECTED_TOTAL} edits, as declared")
