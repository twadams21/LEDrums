The main improvement is to make `ui-shot` resolve **semantic targets**, not registered screenshot names or hand-written CSS.

Right now the interface is shallow:

```bash
pnpm ui-shot --route "?view=trigger" --select ".node-editor"
```

The agent must know the route, the class, and often the click path to make the element visible.

I’d reshape it around three pieces.

**1. Add a Generic Target Resolver**
Support multiple locator types behind one `--target` interface:

```bash
pnpm ui-shot --view trigger --target "Node editor"
pnpm ui-shot --view trigger --target "role:region[name='Trigger graph canvas']"
pnpm ui-shot --view trigger --target "dialog:Change effect"
pnpm ui-shot --view patch --target "node:controller"
pnpm ui-shot --target "text:Mix"
```

Resolution order could be:

1. `[data-shot="..."]`
2. `[data-ui="..."]`
3. accessible role + name via Playwright `getByRole`
4. `aria-label`
5. visible text
6. title
7. fallback CSS selector

That means future UI elements become screenshot-able if they are accessible and visible. No `shots.json` registration needed.

**2. Add Discovery**
Give agents a way to ask the app what can be captured:

```bash
pnpm ui-shot --discover --view trigger
pnpm ui-shot --discover --route "?view=sections"
```

Output a searchable list like:

```
region    Node editor              --target "Node editor"
region    Trigger graph canvas     --target "Trigger graph canvas"
button    Add Scope                --target "button:Add Scope"
dialog    Change effect            --target "dialog:Change effect"
node      Mix                      --target "node:Mix"
```

This could be built from the accessibility tree plus DOM landmarks. A companion `.ui-shots/discover-trigger.html` overlay would also help: draw boxes around every capturable region with its generated target string.

**3. Replace Bespoke Click Scripts With State Fixtures**
The hard part is not cropping an element. It is getting the app into the state where the element exists.

Instead of adding more click choreography to `shots.json`, add a dev-only app control seam:

```js
window.__LEDRUMS_SHOT__ = {
  reset(),
  setView('trigger'),
  openGraph('snare'),
  addNode('scope'),
  addNode('mix'),
  selectNode('scope'),
  openGallery(),
  openSettings()
}
```

Then `ui-shot` supports:

```bash
pnpm ui-shot --state "view:trigger,add:scope,select:scope" --target "Node editor" --name scope-inspector
pnpm ui-shot --state "view:trigger,add:mix" --target "Mix" --name mix-node
```

This keeps the module deep: callers learn a tiny interface, while the script owns the messy Playwright/app-state details.

I would keep `shots.json`, but demote it to named presets:

```json
{
  "gen3-scope-inspector": {
    "state": "view:trigger,add:scope,select:scope",
    "target": "Node editor"
  }
}
```

So agents can still run:

```bash
pnpm ui-shot gen3-scope-inspector
```

But they are no longer forced to register every new component just to crop it.

The pragmatic target architecture:

```
CLI
  ↓
Shot request
  { view?, route?, state?, target?, name?, viewport? }
  ↓
State driver
  deterministic app setup, no fragile click chains
  ↓
Target resolver
  data-shot → data-ui → role/name → aria-label → text/title → CSS
  ↓
Capture validator
  bbox exists, non-zero size, non-blank pixels, clean console
```

The key rule I’d add to the design system is not “register every component.” It’s: every meaningful UI surface must have an accessible name, and reusable primitives may optionally emit `data-ui` from their existing props. Then `ui-shot` can support future elements by convention instead of maintenance.
