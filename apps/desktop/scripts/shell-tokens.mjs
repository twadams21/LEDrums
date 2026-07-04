// Pure token-substitution for the bootstrap shell (S08).
//
// The shell page (shell/index.template.html) declares a small set of CSS custom properties with
// throwaway placeholder values. At bundle time we replace those values with the REAL values read
// from the web app's design tokens (apps/web/src/styles/tokens.css), so the native shell can never
// drift from the design system — there is no second, hand-maintained palette to keep in sync.
//
// Kept dependency-free and pure (string in → string out) so it is unit-testable without a build.

/** The token custom-properties the bootstrap shell consumes. Every name must exist in the base
 *  `:root` of tokens.css. Order is irrelevant. */
export const SHELL_TOKEN_NAMES = ['--bg', '--text', '--text-faint', '--accent', '--live'];

/** Read a custom-property's value from a CSS string. Returns the FIRST declaration, which is the
 *  base `:root` block in tokens.css (later `[data-accent]` blocks only re-declare accent vars, and
 *  come after) — so first-match is always the canonical base value. */
export function readTokenValue(css, name) {
  const m = css.match(new RegExp(`${escapeName(name)}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** Substitute the shell's placeholder custom-property values with the token values from `tokensCss`.
 *  Only the named properties' values are rewritten; everything else in `html` is untouched. Throws
 *  if a required token is missing from `tokensCss` (a design-system rename must fail the build loud,
 *  not silently ship a stale colour). */
export function substituteShellTokens(html, tokensCss, names = SHELL_TOKEN_NAMES) {
  let out = html;
  for (const name of names) {
    const value = readTokenValue(tokensCss, name);
    if (!value) {
      throw new Error(`[prepare] shell token ${name} not found in tokens.css`);
    }
    const decl = new RegExp(`(${escapeName(name)}\\s*:\\s*)[^;]+;`);
    if (!decl.test(out)) {
      throw new Error(`[prepare] shell template is missing a ${name} declaration to substitute`);
    }
    out = out.replace(decl, `$1${value};`);
  }
  return out;
}

function escapeName(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
