#!/usr/bin/env bash
# phase3b.sh — mechanical verification of dead-code survivors.
#
# For each finding: reset the worktree to the pinned baseline, apply the smallest
# mutation its proposed_fix describes, and run a WORKSPACE-WIDE typecheck. If the
# symbol is genuinely unreferenced the tree still compiles (VERIFIED). If anything
# reaches it, tsc fails and the finding is FALSIFIED — non-model evidence either way.
#
# ISOLATION
# Experiments run SEQUENTIALLY in one dedicated worktree, reset between each. The
# hazard Phase 3b exists to avoid is two experiments sharing a checkout so each
# attributes a green result to its own change when it actually tested the combined
# patch. Sequential-plus-reset removes that without needing 38 worktrees: every
# experiment starts from the same clean baseline sha.
#
# WHY TYPECHECK AND NOT THE FULL SUITE
# `pnpm typecheck` is recursive across the workspace and resolves every
# cross-package reference in 22s. For a dead-code claim that is the decisive
# check: static reachability is exactly what tsc computes. The test suite adds
# evidence only about DYNAMIC access, which the refuters already grepped for, so
# it runs once at the end over the accumulated set rather than 14 times.
#
# usage: phase3b.sh [worktree]
set -uo pipefail

REPO="$(git rev-parse --show-toplevel)"
D="$REPO/docs/plans/2026-07-26-deep-review"
WT="${1:-/Users/trent/.twux/worktrees/rev3b}"
BASE="3708648"
OUT="$D/03b-verify"
mkdir -p "$OUT"

[ -d "$WT" ] || { echo "no worktree at $WT" >&2; exit 2; }
cd "$WT" || exit 2

# Control. A red baseline makes every experiment meaningless, so refuse to start.
echo "== control: baseline typecheck =="
git reset --hard "$BASE" --quiet && git clean -fd --quiet
if ! pnpm typecheck > "$OUT/_baseline.log" 2>&1; then
  echo "BASELINE IS RED — aborting. See $OUT/_baseline.log" >&2; exit 3
fi
echo "   baseline green at $(git rev-parse --short HEAD)"

python3 - "$D/artifacts/phase3b-mutations.json" "$WT" "$OUT" "$BASE" <<'PY'
import json, subprocess, sys, os, re

spec, WT, OUT, BASE = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
muts = json.load(open(spec))["mutations"]
results = []

def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, cwd=WT, capture_output=True, text=True, **kw)

def reset():
    sh(f"git reset --hard {BASE} --quiet && git clean -fd --quiet")

for m in muts:
    mid = m["id"]
    reset()
    applied, notes = [], []

    if m["kind"] == "delete-file":
        for f in m["files"]:
            p = os.path.join(WT, f)
            if os.path.exists(p):
                os.remove(p); applied.append(f"rm {f}")
            else:
                notes.append(f"MISSING {f}")
    elif m["kind"] == "unexport-multi":
        for t in m["targets"]:
            p = os.path.join(WT, t["file"])
            if not os.path.exists(p):
                notes.append(f"MISSING {t['file']}"); continue
            src = open(p).read()
            for sym in t["symbols"]:
                pat = re.compile(
                    rf"^export\s+((?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+{re.escape(sym)}\b)",
                    re.M)
                new, n = pat.subn(r"\1", src)
                if n: src = new; applied.append(f"unexport {sym}")
                else: notes.append(f"NO MATCH {sym} in {t['file'].split('/')[-1]}")
            open(p, "w").write(src)
    else:  # unexport
        f = m["file"]; p = os.path.join(WT, f)
        if not os.path.exists(p):
            notes.append(f"MISSING {f}")
        else:
            src = open(p).read()
            for sym in m["symbols"]:
                # match `export const|let|function|class|type|interface <sym>` at line start
                pat = re.compile(
                    rf"^export\s+((?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+{re.escape(sym)}\b)",
                    re.M)
                new, n = pat.subn(r"\1", src)
                if n:
                    src = new; applied.append(f"unexport {sym} (x{n})")
                else:
                    notes.append(f"NO MATCH {sym}")
            open(p, "w").write(src)

    changed = sh("git diff --stat").stdout.strip().splitlines()[-1:] or ["<no diff>"]
    tc = sh("pnpm typecheck")
    ok = tc.returncode == 0
    open(os.path.join(OUT, f"{mid}.log"), "w").write(tc.stdout[-6000:] + "\n---STDERR---\n" + tc.stderr[-3000:])

    verdict = "verified" if ok and applied else ("falsified" if applied else "inconclusive")
    results.append({
        "finding_id": mid, "outcome": verdict, "typecheck_exit": tc.returncode,
        "applied": applied, "notes": notes, "diff": changed[0].strip(),
    })
    flag = {"verified": "VERIFIED ", "falsified": "FALSIFIED", "inconclusive": "INCONCL. "}[verdict]
    print(f"  {flag} {mid:18} {changed[0].strip()[:52]}  {'; '.join(notes)[:60]}")

reset()
# Name the results file after the spec. A filtered re-run (e.g. one finding)
# previously overwrote the full results.json, and the downstream combined step
# then applied a single mutation while reporting success.
rname = "results.json" if os.path.basename(spec) == "phase3b-mutations.json" else \
        "results-" + os.path.basename(spec).replace(".json", "") + ".json"
json.dump(results, open(os.path.join(OUT, rname), "w"), indent=2)
v = sum(1 for r in results if r["outcome"] == "verified")
f_ = sum(1 for r in results if r["outcome"] == "falsified")
i = sum(1 for r in results if r["outcome"] == "inconclusive")
print(f"\nverified {v} · falsified {f_} · inconclusive {i}  of {len(results)}")
PY
echo "== worktree reset to baseline =="
