# Slice 8 — Medium tests, docs, calibration gate

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §6.8, §7, Slice 8.
Final slice. Depends on Slices 1–7 (all committed).

## Part A — extend `seedRuleAsset`

`server/test/medium/specs/services/memory.service.spec.ts` (helper at line 41) currently accepts
only `{ ownerId, localDateTime, city, country, isFavorite }`. Add:

```ts
type = AssetType.Image,
duration = null,
...
type?: AssetType;
duration?: number | null;
```

and pass both through to `ctx.newAsset({ ownerId, localDateTime, isFavorite, type, duration })`
(`assetInsert` in `test/medium.factory.ts` spreads overrides over its defaults, so both are accepted).

## Part B — medium tests (real DB, end-to-end generation)

Add a `describe('onMemoriesCreate — Tier 3 rules (end-to-end generation)')` block modelled on the
existing Tier 1 block (line 649). Each rule gets a **positive and a negative** case; the negative
must fail for a _different_ reason than the positive passes.

### B1. `video_moments`

- **Positive:** seed ≥3 videos (`type: AssetType.Video`, `duration` in the 3s–180s band) in the
  target month of a **past** year; run generation with `target.day === 8`; assert a memory row
  exists with `data.ruleId === 'video_moments'`, the expected `title`, and the expected asset set.
- **Negative (trigger day):** identical data, generation run for **day 7** ⇒ no `video_moments`
  memory. Proves the day gate, not the band.
- **Negative (duration band):** ≥3 videos all with `duration: 1000` (below band) on day 8 ⇒ no
  memory. Proves the band, not the day gate.

### B2. `trip_anniversary`

- **Positive:** seed a home baseline (≥90 days before the anniversary, one dominant country/city)
  **plus** an away-from-home cluster of ≥7 assets across ≥2 distinct days whose first day is exactly
  the anniversary date, **plus** ≥3 geotagged assets on the anniversary day itself in that city (so
  the cheap probe passes). Assert a memory with `data.ruleId === 'trip_anniversary'`.
- **Negative:** same fixture but the away cluster spans a **single** day (`dayCount = 1`) ⇒ no
  memory.

> Getting this fixture right is the fiddly part: the probe reads
> `getMemoryAssetsForPeriod(months=[m], day=d)` while the confirm step reads
> `getMemoryLocationClusters` over two different windows. Seed real assets that satisfy all three.

### B3. `themed`

**No live ML service.** Use the Slice-7 seam: subclass `MemoryService` and override the `protected
createThemeSearchPort()` to return a stub.

```ts
class StubbedMemoryService extends MemoryService {
  constructor(
    private stub: ThemeSearchPort,
    ...args: ConstructorParameters<typeof MemoryService>
  ) {
    super(...args);
  }
  protected override createThemeSearchPort(): ThemeSearchPort {
    return this.stub;
  }
}
```

If constructing the subclass through the medium `setup()`/`ctx` harness is awkward, the simpler
equivalent is to build the real service and override the method on the instance
(`(sut as unknown as { createThemeSearchPort: () => ThemeSearchPort }).createThemeSearchPort = () => stub`)
**before** the first generation call — the port is memoized lazily, so an override applied before
first use takes effect. Either is acceptable; state which you used.

- **Positive:** stub returns an embedding and ≥8 assets whose `localDateTime` is in the target year;
  run generation on **day 22**; assert a `themed` memory with the expected `title`.
- **Negative:** stub's `resolveEmbedding` returns `null` (smart search disabled) ⇒ no `themed`
  memory, and `searchByEmbedding` was never called.

### B4. Slot budget (spec §6.10 row 17)

Guards §3.6: with `RULE_DAILY_LIMIT = 2` already satisfied by two visible multi-day memories,
`createRuleMemories` returns early and inserts nothing. Seed two rule memories visible on the target
day, then run generation and assert no third rule memory is inserted for that day.

## Part C — docs

Slices 2/5/7 already updated `docs/docs/features/memories.md`,
`docs/docs/install/config-file.md`, and the roadmap rows per type. In this slice:

1. Verify all three roadmap rows (#6, #7, #11) read **Shipped** with the right key.
2. Add `memories.themeMaxDistance` to `docs/docs/install/config-file.md` (Slice 6 deliberately
   deferred it) — document the `0 < x < 2` active range, the `0.3` default, and that `0` disables
   the quality gate entirely.
3. In `docs/docs/features/memories.md`, note that **Themes requires smart search to be enabled**.

## Part D — calibration gate (NOT executable here)

Spec §4.2 gates merge on empirically tuning `memories.themeMaxDistance` against a real library. That
requires deploying an RC to the personal instance, which is an explicit human decision (fork policy:
always confirm before triggering release/deploy workflows). **Do not run any deploy or release
workflow.**

Instead, record the procedure as an explicit pre-merge checklist item in the PR description:

1. Deploy an RC to the personal instance.
2. For each of the 6 themes, run the themed search at `0.22 / 0.26 / 0.30 / 0.34`.
3. Record per-theme result counts; eyeball precision of the top 16.
4. Choose the highest threshold at which **no theme shows obvious false positives** in its top 16.
5. If a theme cannot be made precise at any threshold, **drop it from the catalog** rather than
   loosening the global default.

Until that runs, `0.3` is an **unvalidated placeholder**, and this must be stated plainly in the PR.

## Verification

```bash
cd server && pnpm test:medium --run test/medium/specs/services/memory.service.spec.ts
cd server && pnpm test:medium --run test/medium/specs/repositories/asset.repository.spec.ts
cd server && pnpm test --run
cd server && pnpm run check
cd server && npx eslint src/ test/ --max-warnings 0
npx prettier --check "docs/**/*.md" "i18n/en.json"
```

> `pnpm test:medium --run <path>` — NOT `pnpm test:medium -- --run <path>` (the literal `--` drops
> the path filter and runs the whole medium suite, surfacing unrelated pre-existing failures).

Medium tests need Docker; it is running.

## Commit

`test(memories): end-to-end generation coverage for tier 3 memory types`
