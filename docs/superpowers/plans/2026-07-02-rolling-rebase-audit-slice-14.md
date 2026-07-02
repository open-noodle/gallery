# Slice 14 (finding LOW[9]) — WorkflowSummary close-button i18n

## Problem

`web/src/routes/(user)/workflows/[workflowId]/WorkflowSummary.svelte` has a hardcoded
English close-button label:

```svelte
<IconButton
  icon={mdiClose}
  size="small"
  variant="ghost"
  color="secondary"
  title="Close summary"
  aria-label="Close summary"
  onclick={() => (isOpen = false)}
/>
```

This is a fork i18n hunk that got dropped when upstream moved/renamed the workflows
route (fork's `main` has it under `web/src/routes/(user)/utilities/workflows/[workflowId]/`,
this branch has it at `web/src/routes/(user)/workflows/[workflowId]/`). On `main`, both
`title` and `aria-label` use `$t('workflow_close_summary')`.

The key `workflow_close_summary` ("Close summary") already exists in this branch's
`i18n/en.json` (line 2962) — it is not orphaned, just not wired up in this one spot.

## Fix

Replace the two hardcoded `"Close summary"` string literals with
`{$t('workflow_close_summary')}`, matching `main` exactly. No en.json change needed —
the key is already present and matches main's copy verbatim.

## Test strategy

Component-rendering this file requires pulling in `pluginManager` (a `$state` singleton
that talks to `authManager`/`eventManager` at module-construction time) plus `@immich/ui`
primitives — heavier to mock reliably than the fix warrants. There's existing repo
precedent (`web/src/lib/managers/navigation-items.spec.ts`,
`web/src/lib/managers/selection-command-page-boundaries.spec.ts`) for a lightweight
source-scanning guard test using `node:fs` `readFileSync` directly on the `.svelte`
source. Use that pattern instead: co-located
`WorkflowSummary.i18n.spec.ts` that reads the `.svelte` source text and asserts:

1. It does NOT contain the hardcoded literal `"Close summary"` (title/aria-label
   attribute form).
2. It DOES contain `$t('workflow_close_summary')` for the close button.

## Steps

1. RED: write the guard spec, run scoped, confirm it fails against the current hardcoded
   source.
2. GREEN: edit `WorkflowSummary.svelte` to use `$t('workflow_close_summary')` for both
   `title` and `aria-label` on the close `IconButton`. Re-run scoped test → passes.
3. Confirm key exists in `i18n/en.json` (it does, no edit needed).
