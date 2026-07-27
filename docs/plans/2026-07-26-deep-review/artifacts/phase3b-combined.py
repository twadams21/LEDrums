#!/usr/bin/env python3
"""Apply every VERIFIED Phase 3b mutation together and prove they compose.

Individually-verified mutations can still conflict. This applies all of them to
one clean baseline worktree so typecheck and the suite run against the real
combined patch.

It ASSERTS full application before handing over. An earlier version crashed
partway on an unhandled mutation kind, left a partial tree, and the typecheck
and suite that followed came back green — green on the wrong state, which is
indistinguishable from success. Any unapplied mutation is now a hard failure.
"""
import json, os, re, subprocess, sys

REPO = subprocess.run("git rev-parse --show-toplevel", shell=True,
                      capture_output=True, text=True).stdout.strip()
D = os.path.join(REPO, "docs/plans/2026-07-26-deep-review")
WT = sys.argv[1] if len(sys.argv) > 1 else "/Users/trent/.twux/worktrees/rev3b"
BASE = "3708648"

res = {r["finding_id"]: r for r in json.load(open(f"{D}/03b-verify/results.json"))}
muts = json.load(open(f"{D}/artifacts/phase3b-mutations.json"))["mutations"]
todo = [m for m in muts if res.get(m["id"], {}).get("outcome") == "verified"]

subprocess.run(f"git reset --hard {BASE} --quiet && git clean -fd --quiet",
               shell=True, cwd=WT)

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

applied, problems = 0, []
for m in todo:
    k = m["kind"]
    if k == "delete-file":
        for f in m["files"]:
            fp = os.path.join(WT, f)
            if os.path.exists(fp):
                os.remove(fp); applied += 1
            else:
                problems.append(f"{m['id']}: MISSING {f}")
    elif k == "unexport":
        n, bad = unexport(m["file"], m["symbols"]); applied += n
        problems += [f"{m['id']}: {b}" for b in bad]
    elif k == "unexport-multi":
        for t in m["targets"]:
            n, bad = unexport(t["file"], t["symbols"]); applied += n
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
    else:
        problems.append(f"{m['id']}: UNHANDLED KIND '{k}'")   # never silently skip

print(f"mutations: {len(todo)} verified · edits applied: {applied}")
print(subprocess.run("git diff --stat | tail -1", shell=True, cwd=WT,
                     capture_output=True, text=True).stdout.strip())
if problems:
    print("\nHARD FAIL — not every mutation applied; downstream checks would be green on the wrong tree:")
    for p_ in problems:
        print("  ", p_)
    sys.exit(1)
print("all verified mutations applied cleanly")
