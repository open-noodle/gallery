# Web Tonal Re-skin (Core: L1–L3 + Test Backbone + Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Gallery web app to the soft periwinkle "elevated tonal" brand by introducing a single fork-owned token layer, with TDD-first contrast/completeness/scope guards and a computed-style + visual-regression + a11y net.

**Architecture:** All visual values live in one new fork-owned file `web/src/styles/gallery-theme.css`, imported by exactly one new line in upstream-owned `web/src/app.css`. The file overrides `@immich/ui` (`--immich-ui-*`) tokens, legacy `--immich-*` tokens, and Tailwind palette/radius/font/shadow via `@theme`, for both light and dark. No component markup is edited. A contrast utility + a CSS-token parser drive WCAG and completeness tests; a scope guard enforces the "fork-owned files only" invariant; Playwright provides computed-style, visual-regression, and axe coverage.

**Tech Stack:** SvelteKit + Svelte 5, Tailwind CSS 4 (CSS-first, no `tailwind.config`), `@immich/ui` (built on `bits-ui` + `tailwind-variants`), Vitest (`happy-dom`, globals), Playwright (`e2e/`, has `tsx`), `@fontsource-variable` for self-hosted fonts.

## Global Constraints

- **Scope:** `web/` only. No mobile/ML/server changes. No `@immich/ui` Button override (primary button is solid periwinkle by design).
- **The invariant:** the only upstream-owned edit is **one line** in `web/src/app.css` (`@import './styles/gallery-theme.css';`). All else lives in fork-owned `web/src/styles/*`, `web/src/lib/styles/*`, `web/scripts/*`, and `e2e/src/specs/web/*`. No component-markup recoloring in this plan.
- **Token override mechanics:** override `--immich-ui-*` and legacy `--immich-*` **unlayered** in `:root, .light { … }` / `.dark { … }` (unlayered wins the cascade over `@immich/ui`'s `@layer base`). Override Tailwind palette/radius/font/shadow in `@theme { … }` (Tailwind only reads `@theme`). Verified: `@immich/ui`'s `.dark` block redefines the neutral singletons (`--immich-ui-light` = surface, `--immich-ui-dark` = fg), so both modes set both; and `--color-primary`/`--color-light` alias the `--immich-ui-*` we override, so `bg-primary`/`text-light` follow.
- **Legacy token placement:** the legacy `--immich-*` **and** `--immich-dark-*` families are mode-agnostic in upstream `app.css` (all in one `:root` block, consumed by `dark:`-variant utilities). Define them all in the `:root, .light` block of `gallery-theme.css` — **not** inside `.dark`. Only the `--immich-ui-*` ramps split per mode.
- **Both modes always:** every `--immich-ui-*` token defined under both `:root/.light` and `.dark`.
- **Accessibility:** WCAG AA — text pairs ≥ 4.5:1, UI/graphical (focus ring, accent edges) ≥ 3:1.
- **Colors authored as 6-digit hex** in `gallery-theme.css` (the contrast tests parse hex; oklch regeneration is a documented follow-up, spec §9).
- **Green gates per task:** `pnpm test -- --run <file>` for touched vitest specs; `make e2e-web-dev -- --grep <name>` for Playwright specs; the full `make check-web` (svelte-check + tsc) and `make lint-web` must stay clean before the plan is considered done.
- **Commit after every task.** Branch `web-tonal-reskin` is already checked out.
- Spec reference: `docs/superpowers/specs/2026-06-22-web-tonal-reskin-design.md`.

---

## File Structure

- `web/src/lib/styles/contrast.ts` — pure WCAG contrast-ratio utility. **Create (Task 1).**
- `web/src/lib/styles/contrast.spec.ts` — its unit tests. **Create (Task 1).**
- `web/src/lib/styles/reskin-scope.mjs` — **pure** scope-guard logic (no node builtins), so it is safe to type-check via the spec import and to import from the CLI. **Create (Task 2).**
- `web/scripts/reskin-scope.mjs` — thin CLI wrapper: gathers `git diff` and calls the pure logic. Not a tsc entry point. **Create (Task 2).**
- `web/src/lib/styles/reskin-scope.spec.ts` — unit tests for `isInScope` (imports the pure `.mjs` same-dir). **Create (Task 2).**
- `web/src/lib/styles/theme-tokens.ts` — parser that reads `gallery-theme.css` → `{ light, dark }` token maps. **Create (Task 3).**
- `web/src/styles/gallery-theme.css` — the token layer (the whole re-skin). **Create (Task 3), extend (Tasks 4–6).**
- `web/src/app.css` — add the single `@import` line. **Modify once (Task 3).**
- `web/src/lib/styles/gallery-theme.spec.ts` — completeness + contrast assertions per level. **Create (Task 3), extend (Tasks 4–6).**
- `web/package.json` — add `@fontsource-variable/dm-sans`, `@fontsource-variable/bricolage-grotesque`. **Modify (Task 6).**
- `e2e/src/specs/web/reskin-computed.e2e-spec.ts` — deterministic, auth-free computed-style checks (gray remap applied; primary flips light↔dark). **Create (Task 7).**
- `e2e/src/specs/web/reskin-visual.e2e-spec.ts` — Playwright screenshots (light+dark, thumbnails masked) + axe scan. **Create (Task 8).**

---

## Task 1: Contrast utility (pure, WCAG)

**Files:**

- Create: `web/src/lib/styles/contrast.ts`
- Test: `web/src/lib/styles/contrast.spec.ts`

**Interfaces:**

- Produces: `contrastRatio(a: string, b: string): number` — accepts `#rgb` or `#rrggbb`, returns the WCAG ratio (1–21).

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/styles/contrast.spec.ts
import { contrastRatio } from '$lib/styles/contrast';

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
  });
  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#3f6fe0', '#3f6fe0')).toBeCloseTo(1, 5);
  });
  it('is order-independent', () => {
    expect(contrastRatio('#1b2a4e', '#cdddfb')).toBeCloseTo(contrastRatio('#cdddfb', '#1b2a4e'), 5);
  });
  it('expands 3-digit hex', () => {
    expect(Math.round(contrastRatio('#000', '#fff'))).toBe(21);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/styles/contrast.spec.ts`
Expected: FAIL — cannot resolve `$lib/styles/contrast`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/styles/contrast.ts
const channelToLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (hex: string): number => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
};

export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/styles/contrast.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/styles/contrast.ts web/src/lib/styles/contrast.spec.ts
git commit -m "test(web): add WCAG contrast-ratio utility for re-skin gates"
```

---

## Task 2: Rebase-safety scope guard

**Files:**

- Create: `web/src/lib/styles/reskin-scope.mjs` (pure logic)
- Create: `web/scripts/reskin-scope.mjs` (CLI wrapper)
- Test: `web/src/lib/styles/reskin-scope.spec.ts`

**Interfaces:**

- Produces: `isInScope(changedPaths: string[], appCssAddedLines: string[]): { ok: boolean; violations: string[] }` plus exported `ALLOWED_PREFIXES` / `ALLOWED_EXACT`. In-scope: under `web/src/styles/`, `web/src/lib/styles/`, `web/scripts/`, `web/src/lib/assets/fonts/`, plus `web/package.json` / `web/pnpm-lock.yaml`. `web/src/app.css` allowed only if its added lines are exclusively the `gallery-theme.css` `@import`. Anything else is a violation.

> **Why a pure `.mjs` under `src`:** the spec imports it same-directory (no fragile `../../../scripts` cross-dir import), it contains no node builtins so `tsc --noEmit` / svelte-check pass cleanly, and the CLI in `web/scripts/` imports the _same_ module (DRY — one source of truth). The CLI is never a tsc entry point, so its `node:child_process` usage is not type-checked.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/styles/reskin-scope.spec.ts
import { isInScope } from './reskin-scope.mjs';

describe('isInScope', () => {
  const importLine = "@import './styles/gallery-theme.css';";

  it('passes for the token file + the single app.css import', () => {
    const r = isInScope(['web/src/styles/gallery-theme.css', 'web/src/app.css'], [importLine]);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it('fails when a component is recolored', () => {
    const r = isInScope(['web/src/lib/components/foo.svelte'], []);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('web/src/lib/components/foo.svelte');
  });
  it('fails when app.css gains a non-import line', () => {
    const r = isInScope(['web/src/app.css'], [importLine, '.foo { color: red; }']);
    expect(r.ok).toBe(false);
  });
  it('allows font assets and package manifests', () => {
    const r = isInScope(['web/src/lib/assets/fonts/dm-sans.woff2', 'web/package.json'], []);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/styles/reskin-scope.spec.ts`
Expected: FAIL — module `./reskin-scope.mjs` not found.

- [ ] **Step 3: Write the pure logic module**

```js
// web/src/lib/styles/reskin-scope.mjs
// Pure scope-guard logic — NO node builtins, so it type-checks cleanly via the
// spec import and is reused by the CLI at web/scripts/reskin-scope.mjs.
export const ALLOWED_PREFIXES = ['web/src/styles/', 'web/src/lib/styles/', 'web/scripts/', 'web/src/lib/assets/fonts/'];
export const ALLOWED_EXACT = new Set(['web/package.json', 'web/pnpm-lock.yaml']);

export function isInScope(changedPaths, appCssAddedLines) {
  const violations = [];
  for (const p of changedPaths) {
    if (ALLOWED_EXACT.has(p)) continue;
    if (ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix))) continue;
    if (p === 'web/src/app.css') {
      const offending = appCssAddedLines
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !/^@import\s+['"]\.\/styles\/gallery-theme\.css['"];$/.test(l));
      if (offending.length > 0) violations.push(`web/src/app.css (non-import additions: ${offending.join(' | ')})`);
      continue;
    }
    violations.push(p);
  }
  return { ok: violations.length === 0, violations };
}
```

- [ ] **Step 4: Write the CLI wrapper**

```js
// web/scripts/reskin-scope.mjs
// CLI: compares the working branch against a base ref (default: main) and
// enforces the fork-owned-files-only invariant. Run: node scripts/reskin-scope.mjs [base]
import { execSync } from 'node:child_process';
import { isInScope } from '../src/lib/styles/reskin-scope.mjs';

const base = process.argv[2] ?? 'main';
const changed = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);
const appCssAdded = execSync(`git diff ${base}...HEAD -- web/src/app.css`, { encoding: 'utf8' })
  .split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  .map((l) => l.slice(1));

const { ok, violations } = isInScope(changed, appCssAdded);
if (!ok) {
  console.error('Re-skin scope violations (component-markup recoloring not allowed):');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('Re-skin scope OK: only fork-owned files + the single app.css import changed.');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/styles/reskin-scope.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/styles/reskin-scope.mjs web/scripts/reskin-scope.mjs web/src/lib/styles/reskin-scope.spec.ts
git commit -m "test(web): add re-skin scope guard enforcing fork-owned-files-only invariant"
```

---

## Task 3: Token-layer skeleton + the single app.css import + parser + completeness scaffold

**Files:**

- Create: `web/src/styles/gallery-theme.css`
- Create: `web/src/lib/styles/theme-tokens.ts`
- Create: `web/src/lib/styles/gallery-theme.spec.ts`
- Modify: `web/src/app.css` (one line, after the `@immich/ui` theme import on line 2)

**Interfaces:**

- Produces: `readThemeTokens(): { light: Record<string,string>; dark: Record<string,string> }` — parses the `:root, .light { … }` and `.dark { … }` blocks of `gallery-theme.css`, returning `--token` → value (trimmed, trailing `;`/comment stripped).

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/styles/gallery-theme.spec.ts
import { readThemeTokens } from '$lib/styles/theme-tokens';

describe('gallery-theme.css', () => {
  const t = readThemeTokens();

  it('defines a light and a dark token block', () => {
    expect(Object.keys(t.light).length).toBeGreaterThan(0);
    expect(Object.keys(t.dark).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: FAIL — `$lib/styles/theme-tokens` missing (and the css file does not exist yet).

- [ ] **Step 3: Create the parser**

```ts
// web/src/lib/styles/theme-tokens.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run from the web/ package dir (all plan commands `cd web` first).
const CSS_PATH = resolve(process.cwd(), 'src/styles/gallery-theme.css');

const extractBlock = (css: string, selectorPattern: RegExp): string => {
  const m = css.match(selectorPattern);
  return m ? m[1] : '';
};

const parseVars = (block: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
};

export const readThemeTokens = (): { light: Record<string, string>; dark: Record<string, string> } => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const light = parseVars(extractBlock(css, /:root,\s*\.light\s*\{([\s\S]*?)\n\}/));
  const dark = parseVars(extractBlock(css, /(?:^|\n)\.dark\s*\{([\s\S]*?)\n\}/));
  return { light, dark };
};
```

- [ ] **Step 4: Create the token file skeleton**

```css
/* web/src/styles/gallery-theme.css
 * Gallery fork-owned theme layer. Imported by web/src/app.css AFTER the
 * @immich/ui theme so these overrides win the cascade. See
 * docs/superpowers/specs/2026-06-22-web-tonal-reskin-design.md.
 * Token VALUE overrides are unlayered (beat @immich/ui's @layer base);
 * Tailwind palette/radius/font/shadow live in @theme.
 * Legacy --immich-* AND --immich-dark-* are mode-agnostic → defined here in
 * the :root,.light block (matching upstream app.css), NOT in .dark.
 */

:root,
.light {
  /* extended per level (Tasks 4–6) */
  --gallery-theme: light;
}

.dark {
  /* only --immich-ui-* ramps differ per mode (Tasks 4–5) */
  --gallery-theme: dark;
}
```

- [ ] **Step 5: Wire the single app.css import**

Modify `web/src/app.css` — insert immediately after line 2 (`@import '@immich/ui/theme/default.css';`):

```css
@import './styles/gallery-theme.css';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add web/src/styles/gallery-theme.css web/src/lib/styles/theme-tokens.ts web/src/lib/styles/gallery-theme.spec.ts web/src/app.css
git commit -m "feat(web): add gallery-theme token layer skeleton + single app.css import"
```

---

## Task 4: L1 — Accent recolor (periwinkle primary ramp)

**Files:**

- Modify: `web/src/styles/gallery-theme.css`
- Modify: `web/src/lib/styles/gallery-theme.spec.ts`

**Interfaces:**

- Consumes: `readThemeTokens`, `contrastRatio`.
- Produces: `--immich-ui-primary-50..950` (light + dark) plus the mode-agnostic legacy `--immich-primary` / `--immich-dark-primary` (both in the `:root,.light` block).

- [ ] **Step 1: Write the failing tests** (append to `gallery-theme.spec.ts`)

```ts
import { contrastRatio } from '$lib/styles/contrast';

describe('L1 accent', () => {
  const t = readThemeTokens();
  const PRIMARY = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => `--immich-ui-primary-${s}`);

  it('defines the full primary ramp in both modes', () => {
    for (const name of PRIMARY) {
      expect(t.light[name], `light ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.dark[name], `dark ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('defines legacy primary aliases (mode-agnostic, in light block)', () => {
    expect(t.light['--immich-primary']).toBeDefined();
    expect(t.light['--immich-dark-primary']).toBeDefined();
  });
  it('tonal text pair meets AA (on-container navy on container, light)', () => {
    expect(
      contrastRatio(t.light['--immich-ui-primary-950'], t.light['--immich-ui-primary-200']),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it('solid accent reads on light surface (UI >= 3:1)', () => {
    expect(contrastRatio(t.light['--immich-ui-primary-600'], '#ffffff')).toBeGreaterThanOrEqual(3);
  });
  // NOTE: the dark-mode tonal active state uses `bg-primary/10` (opacity over
  // surface), which solid-token contrast math can't model — it is covered by the
  // axe scan in Task 8, intentionally not by a fast unit test here.
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: FAIL — primary tokens undefined.

- [ ] **Step 3: Add the primary ramp** to `gallery-theme.css`

Inside `:root, .light { … }` add (note both legacy aliases live here):

```css
--immich-ui-primary-50: #f4f7fe;
--immich-ui-primary-100: #e6edfd;
--immich-ui-primary-200: #cdddfb; /* primary container */
--immich-ui-primary-300: #aec7f8;
--immich-ui-primary-400: #84a4f1;
--immich-ui-primary-500: #5b82ea;
--immich-ui-primary-600: #3f6fe0; /* solid accent: button fill, focus, links */
--immich-ui-primary-700: #3257c6;
--immich-ui-primary-800: #2c469f;
--immich-ui-primary-900: #283f7d;
--immich-ui-primary-950: #1b2a4e; /* on-primary-container */
--immich-primary: 63 111 224; /* #3f6fe0 — legacy rgb triplet */
--immich-dark-primary: 126 166 242; /* #7ea6f2 — mode-agnostic, used by dark: utilities */
```

Inside `.dark { … }` add **only** the `--immich-ui-*` dark ramp (inverted: 950 lightest, matching `@immich/ui`'s dark convention):

```css
--immich-ui-primary-950: #f4f7fe;
--immich-ui-primary-900: #e6edfd;
--immich-ui-primary-800: #cdddfb;
--immich-ui-primary-700: #aec7f8;
--immich-ui-primary-600: #84a4f1;
--immich-ui-primary-500: #7ea6f2; /* accent on dark */
--immich-ui-primary-400: #5b82ea;
--immich-ui-primary-300: #3f6fe0;
--immich-ui-primary-200: #2c469f;
--immich-ui-primary-100: #283f7d;
--immich-ui-primary-50: #1b2a4e;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: PASS. If a contrast assertion is red, nudge the offending shade darker/lighter until green (the intended tuning loop; spec §9).

- [ ] **Step 5: Commit**

```bash
git add web/src/styles/gallery-theme.css web/src/lib/styles/gallery-theme.spec.ts
git commit -m "feat(web): L1 — periwinkle primary ramp recolors the app via tokens"
```

---

## Task 5: L2 — Neutrals + radius + shadows

**Files:**

- Modify: `web/src/styles/gallery-theme.css`
- Modify: `web/src/lib/styles/gallery-theme.spec.ts`

**Interfaces:**

- Consumes: `readThemeTokens`, `contrastRatio`.
- Produces: per-mode `--immich-ui-light/dark/muted/gray/default-border`; mode-agnostic legacy `--immich-bg/fg` + `--immich-dark-bg/fg/gray` (all in the `:root,.light` block); a `@theme` block remapping `--color-gray-50..950` + `--radius-*` + `--shadow-*`.

> In `@immich/ui`, `--immich-ui-light` is the surface/background and `--immich-ui-dark` is the foreground text **within a mode** (confirmed: `.dark` flips them) — so the `dark`(fg) vs `light`(bg) pairing below is correct in both modes. The `@theme` block lives at the END of the file; Tailwind reads `@theme` from imported CSS, so remapping `--color-gray-*` retints all `*-gray-*` utilities. (That the remap actually _applies_ is verified by the computed-style test in Task 7.)

- [ ] **Step 1: Write the failing tests** (append)

```ts
describe('L2 neutrals', () => {
  const t = readThemeTokens();
  it('defines neutral anchors in both modes', () => {
    for (const name of ['--immich-ui-light', '--immich-ui-dark', '--immich-ui-muted', '--immich-ui-default-border']) {
      expect(t.light[name], `light ${name}`).toBeDefined();
      expect(t.dark[name], `dark ${name}`).toBeDefined();
    }
  });
  it('defines legacy bg tokens (mode-agnostic, in light block)', () => {
    expect(t.light['--immich-bg']).toBeDefined();
    expect(t.light['--immich-dark-bg']).toBeDefined();
  });
  it('body text meets AA on surface (light + dark)', () => {
    expect(contrastRatio(t.light['--immich-ui-dark'], t.light['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.dark['--immich-ui-dark'], t.dark['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
  });
  it('muted text meets AA on surface (light + dark)', () => {
    expect(contrastRatio(t.light['--immich-ui-muted'], t.light['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.dark['--immich-ui-muted'], t.dark['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: FAIL — neutral tokens undefined.

- [ ] **Step 3: Add neutrals** to the `:root, .light { … }` block (note all legacy `--immich-dark-*` are here, mode-agnostic):

```css
--immich-ui-light: #ffffff; /* surface/bg */
--immich-ui-dark: #1a1f29; /* fg text */
--immich-ui-muted: #5a6573;
--immich-ui-gray: #eef2fb; /* subtle surface */
--immich-ui-default-border: #e3e8f2;
--immich-bg: 255 255 255;
--immich-fg: 26 31 41; /* #1a1f29 */
--immich-dark-bg: 12 16 20; /* #0c1014 */
--immich-dark-fg: 232 237 244; /* #e8edf4 */
--immich-dark-gray: 29 38 50; /* #1d2632 */
```

…and to the `.dark { … }` block (only the per-mode `--immich-ui-*` neutrals):

```css
--immich-ui-light: #14191f; /* surface/bg (dark) */
--immich-ui-dark: #e8edf4; /* fg text (dark) */
--immich-ui-muted: #9aa6b0;
--immich-ui-gray: #1d2632;
--immich-ui-default-border: #28313d;
```

- [ ] **Step 4: Add the `@theme` block** at the end of `gallery-theme.css`:

```css
@theme {
  /* cool paper/ink gray ramp — retints all *-gray-* utilities */
  --color-gray-50: #f7f9fc;
  --color-gray-100: #eef2fb;
  --color-gray-200: #e3e8f2;
  --color-gray-300: #cfd6e3;
  --color-gray-400: #9aa6b8;
  --color-gray-500: #6b7688;
  --color-gray-600: #505b6b;
  --color-gray-700: #3a4350;
  --color-gray-800: #232a34;
  --color-gray-900: #161b22;
  --color-gray-950: #0c1014;

  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.375rem;
  --radius-2xl: 1.75rem;
  --radius-3xl: 2.25rem;

  --shadow-sm: 0 1px 2px rgb(26 31 41 / 0.07);
  --shadow-md: 0 10px 30px rgb(40 55 95 / 0.1);
  --shadow-lg: 0 18px 44px rgb(40 55 95 / 0.14);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: PASS (tune any red contrast shade until green).

- [ ] **Step 6: Commit**

```bash
git add web/src/styles/gallery-theme.css web/src/lib/styles/gallery-theme.spec.ts
git commit -m "feat(web): L2 — cool paper/ink neutrals, marketing radius scale, soft shadows"
```

---

## Task 6: L3 — Typography (DM Sans + Bricolage Grotesque)

**Files:**

- Modify: `web/package.json` (add deps)
- Modify: `web/src/styles/gallery-theme.css`
- Modify: `web/src/lib/styles/gallery-theme.spec.ts`

**Interfaces:**

- Produces: `@fontsource-variable` imports + `--font-sans`/`--font-display`/`--font-mono` in `@theme` + an `@layer base` heading rule applying `--font-display`.

> Mono stays `'GoogleSansCode'` (its `@font-face` already lives in `app.css`) to preserve the single-app.css-edit invariant. This is a deliberate deviation from spec §3's JetBrains Mono suggestion — adding JetBrains would mean another dep with no visible payoff (mono is rare in the UI). The unused prior (sans) `@font-face` also stays in `app.css`; `--font-sans` is simply overridden here, so no `app.css` edit is needed for fonts.

- [ ] **Step 1: Add the font packages**

Run: `cd web && pnpm add @fontsource-variable/dm-sans @fontsource-variable/bricolage-grotesque`
Expected: both added to `web/package.json` dependencies; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing tests** (append)

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('L3 typography', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/gallery-theme.css'), 'utf8');
  it('imports the self-hosted variable fonts', () => {
    expect(css).toMatch(/@import\s+['"]@fontsource-variable\/dm-sans['"]/);
    expect(css).toMatch(/@import\s+['"]@fontsource-variable\/bricolage-grotesque['"]/);
  });
  it('sets sans + display font tokens', () => {
    expect(css).toMatch(/--font-sans:\s*['"]DM Sans Variable['"]/);
    expect(css).toMatch(/--font-display:\s*['"]Bricolage Grotesque Variable['"]/);
  });
  it('applies the display font to headings', () => {
    expect(css).toMatch(/h1,\s*h2,\s*h3[\s\S]*font-family:\s*var\(--font-display\)/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: FAIL — font imports/tokens absent.

- [ ] **Step 4: Add font imports at the TOP of `gallery-theme.css`** (before the `:root` block; CSS `@import` must precede other rules):

```css
@import '@fontsource-variable/dm-sans';
@import '@fontsource-variable/bricolage-grotesque';
```

- [ ] **Step 5: Add font tokens to the existing `@theme` block** (overrides app.css's prior `--font-sans`):

```css
--font-sans: 'DM Sans Variable', ui-sans-serif, system-ui, sans-serif;
--font-display: 'Bricolage Grotesque Variable', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'GoogleSansCode', ui-monospace, monospace;
```

- [ ] **Step 6: Add the heading rule** at the end of `gallery-theme.css`:

```css
@layer base {
  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }
}
```

- [ ] **Step 7: Run to verify pass**

Run: `cd web && pnpm test -- --run src/lib/styles/gallery-theme.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src/styles/gallery-theme.css web/src/lib/styles/gallery-theme.spec.ts
git commit -m "feat(web): L3 — DM Sans body + Bricolage Grotesque headings (self-hosted)"
```

---

## Task 7: L6a — Deterministic computed-style checks (gray remap + dark flip)

**Files:**

- Create: `e2e/src/specs/web/reskin-computed.e2e-spec.ts`

**Interfaces:**

- Consumes: the running web stack on `http://localhost:2283` (via `make dev`). **No auth/seed needed** — `app.css` is global, so tokens + utilities resolve on the login page; dark mode is forced by toggling the `.dark` class our tokens key off.

> This is the fast, deterministic half of hardening: it proves the two things the vitest specs can't — that the Tailwind `@theme` gray remap actually applies, and that the `.dark` ramp engages — without depending on auth, seeded photos, or pixel baselines.

- [ ] **Step 1: Write the spec**

```ts
// e2e/src/specs/web/reskin-computed.e2e-spec.ts
import { expect, test } from '@playwright/test';

const toRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  return `rgb(${Number.parseInt(h.slice(0, 2), 16)}, ${Number.parseInt(h.slice(2, 4), 16)}, ${Number.parseInt(h.slice(4, 6), 16)})`;
};

test.describe('re-skin computed styles', () => {
  test('gray utilities are remapped to the cool ramp', async ({ page }) => {
    await page.goto('/');
    const bg = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'bg-gray-100';
      document.body.append(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    });
    expect(bg).toBe(toRgb('#eef2fb'));
  });

  test('primary accent flips between light and dark', async ({ page }) => {
    await page.goto('/');
    const readAccent = () =>
      page.evaluate(() => {
        const el = document.createElement('span');
        el.style.color = 'var(--immich-ui-primary-500)';
        document.body.append(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      });
    const light = await readAccent();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const dark = await readAccent();

    expect(light).toBe(toRgb('#5b82ea'));
    expect(dark).toBe(toRgb('#7ea6f2'));
    expect(light).not.toBe(dark);
  });
});
```

- [ ] **Step 2: Run to verify it passes** (against a running `make dev` stack)

Run: `make e2e-web-dev -- --grep "re-skin computed styles"`
Expected: PASS (2 tests) in light and after the forced `.dark` toggle.

> If the gray test fails, the `@theme` remap from an imported file did not apply — fall back to defining the gray ramp in `app.css`'s `@theme` via the single-import file being imported earlier, or confirm the import order. This test is exactly the early-warning the spec called for.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/reskin-computed.e2e-spec.ts
git commit -m "test(web): computed-style guard — gray remap applies, primary flips light/dark"
```

---

## Task 8: L6b — Visual regression + axe (light & dark) + final gates

**Files:**

- Create: `e2e/src/specs/web/reskin-visual.e2e-spec.ts`
- Modify: `e2e/package.json` (add `@axe-core/playwright` if missing)

**Interfaces:**

- Consumes: a running web stack on `http://localhost:2283`; the e2e `utils` helper (`initSdk`, `resetDatabase`, `adminSetup`, `createAsset`, `setAuthCookies`) — the same pattern as `e2e/src/specs/web/timeline-grouping.e2e-spec.ts`.

> Baselines are **generated on the CI/Docker runner** so OS font rendering is deterministic — do not commit baselines produced on a local mac. Photo thumbnails (`<img>`) are **masked** so screenshots are stable against asset churn; we are testing the chrome (sidebar, buttons, chips, dialogs), not photo content. Dark mode is forced via the `.dark` class.

- [ ] **Step 1: Add the axe dependency if missing**

Run: `cd e2e && (grep -q '@axe-core/playwright' package.json || pnpm add -D @axe-core/playwright)`
Expected: `@axe-core/playwright` present in `e2e/package.json`.

- [ ] **Step 2: Write the spec**

```ts
// e2e/src/specs/web/reskin-visual.e2e-spec.ts
import type { LoginResponseDto } from '@immich/sdk';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

const SCREENS = ['/photos', '/albums', '/search'];

test.describe('re-skin visual + a11y', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    for (let year = 2024; year >= 2022; year--) {
      await utils.createAsset(admin.accessToken, {
        fileCreatedAt: `${year}-06-15T10:00:00.000Z`,
        fileModifiedAt: `${year}-06-15T10:00:00.000Z`,
      });
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of SCREENS) {
      test(`${theme} · ${path}`, async ({ context, page }) => {
        await utils.setAuthCookies(context, admin.accessToken);
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        if (theme === 'dark') {
          await page.evaluate(() => document.documentElement.classList.add('dark'));
        }
        await expect(page).toHaveScreenshot(`${path.replaceAll('/', '_')}-${theme}.png`, {
          animations: 'disabled',
          mask: [page.locator('img')], // photo thumbnails — content is non-deterministic
          maxDiffPixelRatio: 0.01,
        });
        const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
        const contrast = results.violations.filter((v) => v.id === 'color-contrast');
        expect(contrast, JSON.stringify(contrast, null, 2)).toEqual([]);
      });
    }
  }
});
```

- [ ] **Step 3: Generate baselines on the deterministic runner**

Run: `make e2e-web-dev -- --grep "re-skin visual" --update-snapshots`
Expected: baseline PNGs written under `e2e/src/specs/web/reskin-visual.e2e-spec.ts-snapshots/`.

- [ ] **Step 4: Re-run to verify green**

Run: `make e2e-web-dev -- --grep "re-skin visual"`
Expected: PASS — screenshots match; zero `color-contrast` violations in light and dark.

- [ ] **Step 5: Run the scope guard for the whole branch**

Run: `cd web && node scripts/reskin-scope.mjs main`
Expected: `Re-skin scope OK: only fork-owned files + the single app.css import changed.`

- [ ] **Step 6: Full check + lint gate**

Run: `make check-web && make lint-web`
Expected: both clean (svelte-check + tsc + eslint zero-warnings).

- [ ] **Step 7: Commit**

```bash
git add e2e/src/specs/web/reskin-visual.e2e-spec.ts e2e/package.json e2e/pnpm-lock.yaml e2e/src/specs/web/reskin-visual.e2e-spec.ts-snapshots
git commit -m "test(web): visual-regression + axe net for the tonal re-skin (light & dark)"
```

---

## Phase 2 (separate plan, after L1–L3 ships) — Tonal selection & container polish

Not in this plan: the elevated-tonal **selection** badge/outline and any remaining non-tonal **container** states (old spec L4/L5). Rationale: the L1 recolor already turns the existing `bg-primary/10 text-immich-primary` active-nav pattern into a periwinkle tonal container for free, and the primary button is intentionally solid. What still wants the elevated-tonal treatment must be identified by a **live audit of `web/src/lib/components/assets/thumbnail/thumbnail.svelte` and the chip components after L1–L3 is running** — writing exact selectors before that audit would be guesswork. Plan Phase 2 once the core is live: enumerate the remaining solid-primary selection/active states, decide per-component whether a fork-owned `gallery-overrides.css` rule on a stable class hook suffices, and extend the contrast + visual-regression suites to cover the selection-over-photo stress cases.

## Self-Review notes

- **Spec coverage:** §4 Unit A → Tasks 3–6; Unit B (fonts) → Task 6; Unit D (single import) → Task 3; §5 tests ①contrast → Tasks 1/4/5, ②completeness → Tasks 3–6, ④scope guard → Task 2, ⑤computed-style + visual-regression + axe → Tasks 7/8. §5 ③ Button-override test is intentionally dropped (solid-button decision). §6 L1→Task 4, L2→Task 5, L3→Task 6, L6→Tasks 7 (L6a) + 8 (L6b); L4/L5/L7 → Phase 2.
- **Types consistent:** `contrastRatio(a,b)`, `isInScope(changedPaths, appCssAddedLines)`, `readThemeTokens()`, `toRgb(hex)` used identically across tasks; legacy `--immich-dark-*` asserted from the `light` map everywhere (matches their `:root,.light` placement).
- **No placeholders:** every CSS value and test body is concrete; the only deferred items are the spec-§9 open items (seed-regenerated ramp, oklch) and the explicitly-scoped Phase 2.
- **Review fixes folded in (2026-06-22):** scope guard is a pure `.mjs` under `src` (no cross-dir tsc risk, DRY CLI); legacy `--immich-dark-*` moved to the `:root,.light` block; Task 7/8 split into deterministic computed-style vs visual+axe; dark mode forced via `.dark` class (not `colorScheme`); e2e auth/seed wired via `utils`; thumbnails masked; mono-font deviation documented.
