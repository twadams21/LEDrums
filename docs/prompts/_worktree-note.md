# Worktree note (read first)

You are running in a **dedicated git worktree** on your **own branch** (already checked out — your `cwd` is the worktree). This lets you edit files that a sibling agent is also editing, in isolation.

- **Commit normally** — `git add <your files>` + `git commit`. You are already on the correct branch; do **NOT** `git checkout`/`git switch`/`git branch` to another branch, and do **NOT** merge or rebase. The **orchestrator merges your branch** into `feat/unified-shell` and resolves any cross-branch overlap.
- Your dependencies are installed in this worktree — gates (`pnpm --filter … typecheck`/`test`) run normally here.
- Everything else follows your task doc. Report back to your parent with your commit SHA(s) + files when done.
