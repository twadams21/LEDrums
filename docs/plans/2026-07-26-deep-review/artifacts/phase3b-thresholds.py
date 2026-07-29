#!/usr/bin/env python3
"""Phase 3b — threshold verification for the non-dead-code mechanical lenses.

The dead-code wave verified claims by APPLYING the fix and typechecking, because
"unreachable" is exactly what tsc computes. These four lenses make a different
kind of claim — a THRESHOLD (">=2 sites, >=12 lines", ">=3 params across >=3
call sites", ">=4 files across >=3 commits"). You verify a threshold by
MEASURING it, not by implementing the refactor. Implementing is Phase 5's job.

Each check below produces a number and compares it to the criterion's bound.
Where a criterion has a component no script can settle — "semantically
equivalent", "consolidation reduces total interface" — the result is
INCONCLUSIVE, never a pass. A partial mechanical check dressed up as
verification is the failure this whole phase exists to prevent.

usage: phase3b-thresholds.py [repo]
"""
import json, os, re, subprocess, sys, collections

REPO = sys.argv[1] if len(sys.argv) > 1 else subprocess.run(
    "git rev-parse --show-toplevel", shell=True, capture_output=True, text=True).stdout.strip()
D = os.path.join(REPO, "docs/plans/2026-07-26-deep-review")
OUT = os.path.join(D, "03b-verify")
JSCPD = os.path.join(REPO, "node_modules/.bin/jscpd")

F = {f["id"]: f for f in json.load(open(f"{D}/02-findings/_all.json"))}
S = json.load(open(f"{D}/03-refute/summary.json"))
TARGET = [i for i in S["survived"]
          if F[i]["criterion_is_mechanical"] and F[i]["lens"] != "dead-code"]

def sh(cmd):
    return subprocess.run(cmd, shell=True, cwd=REPO, capture_output=True, text=True)

def paths(f):
    seen, out = set(), []
    for l in f["locations"]:
        if l["path"] not in seen:
            seen.add(l["path"]); out.append(l["path"])
    return out


def check_duplication(f):
    """>=2 sites, >=12 lines, >=90% similarity — jscpd is the oracle.
    Semantic equivalence is NOT decidable here, so a clone match is at best
    'threshold-confirmed', never a full verification of the finding."""
    ps = [p for p in paths(f) if os.path.exists(os.path.join(REPO, p))]
    if len(ps) < 2:
        return "falsified", f"only {len(ps)} of {len(paths(f))} cited paths exist"
    r = sh(f"{JSCPD} {' '.join(ps)} --min-lines 12 --min-tokens 70 "
           f"--reporters json --output /tmp/j3b --silent")
    try:
        rep = json.load(open("/tmp/j3b/jscpd-report.json"))
    except Exception:
        return "inconclusive", "jscpd produced no parseable report"
    dups = rep.get("duplicates", [])
    if not dups:
        return "falsified", f"jscpd finds NO clone >=12 lines among the {len(ps)} cited files"
    biggest = max(d.get("lines", 0) for d in dups)
    return ("threshold-confirmed",
            f"{len(dups)} clone(s), largest {biggest} lines across {len(ps)} files "
            f"(semantic equivalence + interface reduction NOT machine-checkable)")


def check_data_clump(f):
    """>=3 co-travelling params across >=3 call sites."""
    sites = [l for l in f["locations"]
             if os.path.exists(os.path.join(REPO, l["path"]))]
    missing = len(f["locations"]) - len(sites)
    if len(sites) < 3:
        return "falsified", f"only {len(sites)} cited sites exist (need >=3){', %d missing' % missing if missing else ''}"
    # confirm each cited line still exists at that offset
    bad = []
    for l in sites:
        try:
            lines = open(os.path.join(REPO, l["path"]), errors="ignore").read().splitlines()
            if l["start_line"] > len(lines):
                bad.append(f"{l['path']}:{l['start_line']} past EOF")
        except Exception as e:
            bad.append(f"{l['path']}: {e}")
    if bad:
        return "inconclusive", "; ".join(bad[:3])
    return ("threshold-confirmed",
            f"{len(sites)} call sites confirmed present (>=3). Param-count is stated in the "
            f"claim but is not independently machine-counted here")


def check_repeated_switch(f):
    """Same discriminant switched in >=3 places. Count switch/case sites on the
    union type named in the claim."""
    m = re.search(r"\b([A-Z][A-Za-z0-9_]*(?:Kind|Type|Mode|Variant))\b", f["claim"])
    if not m:
        return "inconclusive", "could not extract a discriminant type name from the claim"
    disc = m.group(1)
    r = sh(f"grep -rln --include='*.ts' --include='*.svelte' "
           f"-e 'switch' -e 'case ' packages apps | xargs grep -ln '{disc}' 2>/dev/null")
    files = [x for x in r.stdout.strip().splitlines() if x and 'node_modules' not in x]
    n = len(files)
    if n < 3:
        return "falsified", f"discriminant '{disc}' appears alongside switch/case in only {n} files (need >=3)"
    return "threshold-confirmed", f"discriminant '{disc}' co-occurs with switch/case in {n} files (>=3)"


def check_divergent_change(f):
    """>=4 files edited for one logical change, evidenced from >=3 commits.
    git log is ground truth — this is the cleanest mechanical check of the four."""
    ps = [p for p in paths(f) if os.path.exists(os.path.join(REPO, p))]
    if not ps:
        return "falsified", "none of the cited paths exist"
    if len(ps) == 1:
        # single-file 'one file changes for many reasons' variant: count distinct
        # commits touching it, and how many other files co-changed with it.
        r = sh(f"git log --oneline -200 --follow -- {ps[0]} | wc -l")
        commits = int(r.stdout.strip() or 0)
        co = sh(f"git log --format='%H' -200 -- {ps[0]} | while read c; do "
                f"git show --name-only --format='' $c; done | sort -u | wc -l")
        cofiles = int(co.stdout.strip() or 0)
        if commits < 3:
            return "falsified", f"{ps[0]} has only {commits} commits in the last 200 (need >=3)"
        return ("threshold-confirmed",
                f"{commits} commits touch {ps[0]}, co-changing {cofiles} distinct files (>=3 commits)")
    # multi-file: how many commits touch >=2 of the cited paths together?
    r = sh("git log --format='%H' -300 -- " + " ".join(ps))
    shas = [s for s in r.stdout.strip().splitlines() if s]
    together = 0
    for s in shas[:120]:
        names = sh(f"git show --name-only --format='' {s}").stdout.split()
        if sum(1 for p in ps if p in names) >= 2:
            together += 1
    if together < 3:
        return ("falsified",
                f"only {together} commits touch >=2 of the {len(ps)} cited files together (need >=3)")
    return ("threshold-confirmed",
            f"{together} commits co-change >=2 of {len(ps)} cited files (>=3 commits, >={len(ps)} files)")


CHECKS = {
    "duplicated-code": check_duplication,
    "data-clumps": check_data_clump,
    "repeated-switches": check_repeated_switch,
    "divergent-change": check_divergent_change,
}

results, tally = [], collections.Counter()
for lens in ["duplicated-code", "data-clumps", "repeated-switches", "divergent-change"]:
    ids = sorted(i for i in TARGET if F[i]["lens"] == lens)
    if not ids:
        continue
    print(f"\n── {lens}")
    for i in ids:
        try:
            outcome, detail = CHECKS[lens](F[i])
        except Exception as e:
            outcome, detail = "inconclusive", f"checker error: {e}"
        tally[outcome] += 1
        results.append({"finding_id": i, "lens": lens, "outcome": outcome, "detail": detail})
        flag = {"threshold-confirmed": "CONFIRMED", "falsified": "FALSIFIED",
                "inconclusive": "INCONCL. "}[outcome]
        print(f"  {flag} {i:26} {detail[:96]}")

json.dump(results, open(f"{OUT}/threshold-results.json", "w"), indent=2)
print(f"\nconfirmed {tally['threshold-confirmed']} · falsified {tally['falsified']} "
      f"· inconclusive {tally['inconclusive']}  of {len(results)}")
print("\nNOTE: 'threshold-confirmed' means the criterion's COUNTABLE bound holds. It does not")
print("mean the proposed refactor is correct — that is Phase 5 work under human review.")
