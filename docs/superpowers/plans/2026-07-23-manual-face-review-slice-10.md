# Slice 10 — Entire-cluster move + manual help modal

Spec: §6.4. Branch: `feat/face-manual-review`. Depends on slices 8-9.

## Part A — Move entire cluster

The server's `entireCluster` enumerates the whole cluster **server-side**, which is precisely why it
is the right tool for a server-paged page: selection can only ever cover loaded faces, so
whole-cluster work must not go through selection at all.

Unlike guided — where `entireCluster` rides the scan's suspected owner — manual has no suspected
owner, so it **requires an explicit destination via `PersonPicker`**.

### RED

1. the control opens `PersonPicker` (with the person's `ownerId`)
2. cancelling the picker posts nothing
3. choosing a destination posts `entireCluster: { destinationPersonId }` and **no per-face buckets** —
   the server rejects (400) combining them, so this must be exclusive
4. the control is available regardless of selection state (it is not a selection action)
5. it carries a confirmation — it moves faces the admin has never seen (that is the point, and also
   the risk)
6. success refreshes the page state

### GREEN

Wire to the same `resolveFaces` SDK call with only `entireCluster` populated.

## Part B — Manual actions help modal

Guided's `ActionsHelpModal` documents six actions and is covered by a test asserting it **names all
six**. Manual's action set is different (no `owner`, no `stay`; plus `keep` and `Unmark`), so it gets
its own modal. **Do not modify the guided modal or its spec.**

### RED

1. the manual modal names exactly this mode's actions: Keep (default), Move to person, Lock, Unknown
   person, Not a face, Unmark
2. it explains that **Keep writes nothing** — the single most confusing thing about this page for
   someone arriving from guided, where every face is always stamped
3. it explains that **Not a face is the irreversible one** and sits next to Unknown, which means the
   opposite
4. each action's swatch matches the tile's `STATE_COLOR`/`STATE_ICON`, so an explanation ties back to
   the button and the tile it describes (the guided modal's stated rationale — keep it true here)
5. `keep` shows **no** colour swatch — it is signalled by absence (§6.4)
6. the guided `ActionsHelpModal.spec.ts` still passes untouched

## Verify

`cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/` · `pnpm check:typescript` ·
`pnpm check:svelte` · `pnpm lint`

## Commit

`feat(web): add entire-cluster move and the manual actions help modal`
