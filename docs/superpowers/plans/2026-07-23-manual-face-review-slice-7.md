# Slice 7 — Manual review view-model (pure)

Spec: §6.4, §6.5. Branch: `feat/face-manual-review`.

This is the **highest-risk slice on the branch**. It is a pure module, so it can carry the bulk of the
logic coverage cheaply — and it is where the guided model's two latent defects must not be repeated.

## File

`web/src/routes/admin/face-cleanup/people/[personId]/manual-review.svelte.ts`

Model it on the guided `[personId]/review.svelte.ts` for style, but **do not** import its
`FlaggedFace`, its state list, or its `createReviewModel`.

## The two defects this model exists to avoid

1. **No neutral state.** Guided's `FaceState` is six _terminal_ states and every face initialises to
   `'owner'`, so an untouched review submits a move for every face. Manual's default is `keep`, which
   must produce **no bucket entry at all**.
2. **`$derived` rebuild wipes state.** Guided does `vm = $derived(createReviewModel(flaggedFaces))`, so
   appending a page rebuilds the model and discards staged decisions. This model **owns its list** and
   exposes `appendFaces`.

## API

```ts
export type ManualFaceState = 'keep' | 'move' | 'lock' | 'unknown' | 'detach';

export interface ManualFace {
  assetFaceId: string; // NOTE: no suspectedOwnerId — there is no scan
}

export interface ManualResolveRequest {
  personId: string;
  moveToPerson: { destinationPersonId: string; faceIds: string[]; lock: boolean }[];
  stay: []; // ALWAYS empty — manual never emits stay (§3.2)
  lock: string[];
  detach: string[];
  unknown: string[];
}

export function createManualReviewModel(personId: string): {
  faces: ManualFace[];
  total: number;
  appendFaces(faces: ManualFace[], total: number): void;
  stateOf(id: string): ManualFaceState;
  destinationOf(id: string): string | null;
  isSelected(id: string): boolean;
  selectedCount: number;
  loadedCount: number;
  toggle(id: string, shiftKey?: boolean): void;
  selectAllLoaded(): void;
  clearSelection(): void;
  applyToSelection(state: ManualFaceState, destination?: { personId: string; lock: boolean }): void;
  unmarkSelection(): void; // -> 'keep'
  reset(): void; // all -> 'keep', clear selection
  tally: Record<Exclude<ManualFaceState, 'keep'>, number>;
  hasStagedWork: boolean;
  buildResolveRequest(): ManualResolveRequest | null; // null when nothing staged
};
```

Reuse guided's `STATE_COLOR` / `STATE_ICON` for the four non-`keep` states by importing them, so one
glyph means one thing across both pages. `keep` has **no** colour and **no** icon — it is signalled by
absence (§6.4).

## Step 1 — RED: `manual-review.spec.ts`

Pure unit tests, no DOM. Cases:

**Defaults**

1. every face starts in `keep`
2. `tally` is all zeros and `hasStagedWork` is false on a fresh model
3. `buildResolveRequest()` returns **`null`** when everything is `keep` (the caller disables Apply on
   null — an all-keep POST would be an empty resolve, which the server 400s)

**Bucket construction** 4. `lock`/`unknown`/`detach` selections become their id lists 5. `move` groups by
`(destinationPersonId, lock)` — two faces to the same destination produce ONE group; two destinations
produce two groups 6. the `lock` flag threads onto the move group 7. **`stay` is always `[]`** — assert
explicitly on every request shape produced in this file 8. **`keep` faces never appear in any bucket**
— seed a mix and assert the kept ids are absent from all five arrays 9. a face cannot occupy two
buckets (last write wins; assert the id appears exactly once across the whole request)

**Pagination stability — the reason this model exists** 10. `appendFaces` preserves existing states:
mark some faces, append a page, assert the marks survive 11. `appendFaces` preserves **selection** too 12. `appendFaces` does not duplicate a face already present (idempotent on id) 13. `total` updates from
the server value while `loadedCount` reflects what is actually loaded

**Selection** 14. `toggle` selects/deselects; shift-range selects the span **over loaded faces only** 15. `selectAllLoaded` selects exactly the loaded faces, not `total` 16. `applyToSelection` marks only
selected faces 17. `unmarkSelection` returns selected faces to `keep`, removing them from buckets 18.
`reset` returns everything to `keep` and clears selection

**Guided contrast (regression guard)** 19. assert `ManualFaceState` has no `'owner'` and no `'stay'`
member — a compile-level/type test plus a runtime assertion that `buildResolveRequest` never emits
either.

Run: `cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/people/\[personId\]/manual-review.spec.ts`

## Step 2 — GREEN

Implement with Svelte 5 runes (`$state`/`$derived`) mirroring how `review.svelte.ts` is written, but
with the model owning `faces` rather than receiving it as a `$derived` input.

`buildResolveRequest` returns `null` — not an empty request — when nothing is staged, so the disabled
Apply is impossible to bypass.

## Step 3 — Verify

`cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/` · `pnpm check:typescript` ·
`pnpm check:svelte` · `pnpm lint`

## Commit

`feat(web): add the manual face-review view-model`

Body: note the `keep` default and that the model owns its face list so paging cannot wipe staged
decisions — the two defects that made reusing the guided model impossible.

## Out of scope

No page, no rendering, no network. Slice 8 consumes this.
