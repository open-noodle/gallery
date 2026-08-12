# Slice 9 — Manual bulk actions + Apply

Spec: §6.4. Branch: `feat/face-manual-review`. Depends on slices 7 (model) and 8 (page + grid).

## Goal

The footer dock: five bulk actions, the staged-work tally, and Apply.

## Actions

| Action     | Effect                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| Move to…   | opens `PersonPicker` (needs `ownerId`), sets `move` + destination (+ lock flag) |
| Lock       | sets `lock`                                                                     |
| Unknown    | sets `unknown`                                                                  |
| Not a face | sets `detach` — destructive confirm on Apply                                    |
| **Unmark** | returns selection to `keep`                                                     |

**`stay` and `owner` are NOT offered** — both require a suspected owner (§3.2, §6.4).

`PersonPicker` is reused as-is: it requires an `ownerId` prop (from slice 3's metadata endpoint) and
already handles search, "create new person", and the lock checkbox. Do not fork it.

## Step 1 — RED (extend `people/[personId]/page.spec.ts`)

1. each of the five actions applies to exactly the current selection and leaves other faces `keep`
2. **Unmark** returns marked faces to `keep` and removes them from the request — the manual-only
   affordance; guided has no equivalent because every face there is already stamped
3. **the dock is absent / Apply is disabled while everything is `keep`** — `buildResolveRequest()`
   returns `null`, and an all-keep POST would be an empty resolve the server 400s. Assert Apply
   cannot be activated.
4. **the tally** reports staged work per bucket (`3 move · 2 lock · 7 not a face`)
5. **Move to…** passes the person's `ownerId` (from the metadata endpoint) to `PersonPicker`, and the
   chosen destination + lock flag land in the request
6. **Apply posts the exact request** the model built — assert the full payload shape, and assert
   **`stay: []`** explicitly (the single most important payload assertion on this page)
7. **detach requires the destructive confirm**; declining it does NOT post
8. **409 is surfaced** (a scan started mid-review) with a non-destructive message and staged work is
   NOT discarded — losing the work to a conflict is exactly what the chooser's disabled-manual card
   is meant to prevent, and if it happens anyway the page must not compound it
9. **result reporting** — counts from the response are shown
10. **the guided page is untouched** — its specs must still pass unchanged

Run: `cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/`

## Step 2 — GREEN

Dock modelled on the guided page's footer dock shell, with the manual action set. Reuse the guided
destructive-confirm flow for detach.

On success: refresh the cluster (the page's face list changed) and reset the model.

## Step 3 — Verify

`pnpm exec vitest --run src/routes/admin/face-cleanup/` · `pnpm check:typescript` · `pnpm check:svelte` ·
`pnpm lint`

## Commit

`feat(web): add manual review bulk actions and apply`

## Out of scope

Entire-cluster move and the help modal (slice 10).
