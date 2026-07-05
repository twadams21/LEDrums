# ui-shot — one-command app screenshots

Headless captures of the running app via system Chrome (playwright-core, `channel:'chrome'` — no browser downloads). Starts `pnpm dev` automatically if the server isn't up. Output: `.ui-shots/<name>.png` (gitignored). Console/page errors during capture are printed per shot.

```bash
pnpm ui-shot --list                 # named shots (shots.json)
pnpm ui-shot trigger-graph          # one shot
pnpm ui-shot --all                  # everything
pnpm ui-shot --route "?view=patch" --select "main.workspace" --name my-shot   # ad-hoc
pnpm ui-shot --all --strict         # exit 1 on any console error (clean-console gate)
```

Add new surfaces to `shots.json`: `{ "route", "select"?, "actions"? [{click|scrollTo|wait, optional?}], "settle"? }`.
