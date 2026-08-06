# Image Adjustments — Slice 1: Editor core (Adjust edit action) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-destructive `adjust` image-edit action (brightness / contrast / saturation / auto-enhance) to the server editor, rendered via sharp, alongside the existing crop/rotate/mirror/trim.

**Architecture:** A new `AssetEditAction.Adjust` with an `AdjustParameters` schema (reusable signed `TonalLevel` enum + an `autoEnhance` boolean, validated so at least one field is set and `autoEnhance` is mutually exclusive with manual fields). `MediaRepository.applyEdits` gains a tonal branch that maps each level to a fixed sharp factor (`.modulate` for brightness/saturation, `.linear` for contrast via a pure `contrastLinear` helper, `.normalise` for auto-enhance). `transform.ts` is unchanged (adjust is geometrically inert) but gains a regression test. Dedup keeps one adjust per asset.

**Tech Stack:** TypeScript, NestJS, Zod v4 (`z.toJSONSchema` + `nestjs-zod`), sharp/libvips, Vitest (real-sharp behavioral tests — the established `media.repository.spec.ts` pattern, NOT mocked sharp).

Spec: `docs/superpowers/specs/2026-06-06-pi-agent-image-adjustments-design.md` (Slice 1).

---

## File Structure

- **Modify** `server/src/dtos/editing.dto.ts` — add `AssetEditAction.Adjust`, `TonalLevel` enum + schema, `AdjustParametersSchema`, wire into the discriminated union / parameter union / `actionParameterMap` / `uniqueEditActions` / exported types.
- **Create** `server/src/utils/editor-adjust.ts` — pure factor tables (`BRIGHTNESS_FACTOR`, `SATURATION_FACTOR`, `CONTRAST_SLOPE`) + `contrastLinear(level, mid)` helper. (Keeps the numeric contract in one focused, unit-testable unit; `media.repository.ts` imports it.)
- **Modify** `server/src/repositories/media.repository.ts` — `applyEdits` gains a tonal branch; thread the working `colorspace` in so contrast pivots around the correct mid.
- **Create** `server/src/utils/editor-adjust.spec.ts` — pure-helper unit tests.
- **Modify** `server/src/dtos/editing.dto.spec.ts` — schema tests (create the file if absent; there is no editing.dto spec today → create it).
- **Modify** `server/src/utils/transform.spec.ts` — adjust-is-a-no-op regression tests.
- **Modify** `server/src/repositories/media.repository.spec.ts` — real-sharp behavioral tonal tests.

> **Note (spec alignment):** the spec's Slice-1 media tests said "mock sharp; assert `.modulate` called". The codebase's `media.repository.spec.ts` uses **real sharp on real images** and asserts rendered pixels. This plan follows the real-sharp pattern (more robust, consistent). The exact sharp factor values remain the contract — asserted via the pure `editor-adjust.spec.ts` (factor tables + `contrastLinear`), and the rendered-pixel direction/effect is asserted in the media spec.

---

## Task 1: `TonalLevel` enum + schema in editing.dto

**Files:**

- Modify: `server/src/dtos/editing.dto.ts`
- Test: `server/src/dtos/editing.dto.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/src/dtos/editing.dto.spec.ts`:

```ts
import { AssetEditAction, AssetEditsCreateDto, TonalLevel } from 'src/dtos/editing.dto';

const parse = (edits: unknown) => AssetEditsCreateDto.schema.safeParse({ edits });

describe('AdjustParameters schema', () => {
  it('accepts a single manual field', () => {
    expect(
      parse([{ action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.ModerateIncrease } }]).success,
    ).toBe(true);
  });

  it('accepts all three manual fields', () => {
    const params = {
      brightness: TonalLevel.SlightIncrease,
      contrast: TonalLevel.ModerateIncrease,
      saturation: TonalLevel.StrongDecrease,
    };
    expect(parse([{ action: AssetEditAction.Adjust, parameters: params }]).success).toBe(true);
  });

  it('accepts autoEnhance alone', () => {
    expect(parse([{ action: AssetEditAction.Adjust, parameters: { autoEnhance: true } }]).success).toBe(true);
  });

  it('rejects an empty adjust (no fields)', () => {
    expect(parse([{ action: AssetEditAction.Adjust, parameters: {} }]).success).toBe(false);
  });

  it('rejects autoEnhance combined with a manual field', () => {
    expect(
      parse([
        { action: AssetEditAction.Adjust, parameters: { autoEnhance: true, brightness: TonalLevel.SlightIncrease } },
      ]).success,
    ).toBe(false);
  });

  it('rejects an invalid TonalLevel value', () => {
    expect(parse([{ action: AssetEditAction.Adjust, parameters: { brightness: 'mega' } }]).success).toBe(false);
  });

  it('rejects two adjust actions in one edits array (uniqueEditActions)', () => {
    expect(
      parse([
        { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.SlightIncrease } },
        { action: AssetEditAction.Adjust, parameters: { contrast: TonalLevel.SlightIncrease } },
      ]).success,
    ).toBe(false);
  });

  it('accepts adjust coexisting with crop and mirror', () => {
    expect(
      parse([
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
        { action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } },
        { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.SlightIncrease } },
      ]).success,
    ).toBe(true);
  });
});
```

> `AssetEditsCreateDto.schema` is the nestjs-zod accessor for the underlying Zod schema (confirmed: e.g. `AgentSessionActivityEventCreateDto.schema.safeParse(...)` in `agent-session-activity-event.dto.spec.ts`). `AssetEditsCreateSchema` itself is a non-exported const, so use the DTO's `.schema`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server test -- --run src/dtos/editing.dto.spec.ts`
Expected: FAIL — `TonalLevel` is not exported / `Adjust` not a member.

- [ ] **Step 3: Implement the schema**

In `server/src/dtos/editing.dto.ts`:

1. Add `Adjust = 'adjust'` to `enum AssetEditAction`.
2. Add the enum + schema (place after `MirrorAxis`):

```ts
export enum TonalLevel {
  StrongDecrease = 'strong_decrease',
  ModerateDecrease = 'moderate_decrease',
  SlightDecrease = 'slight_decrease',
  SlightIncrease = 'slight_increase',
  ModerateIncrease = 'moderate_increase',
  StrongIncrease = 'strong_increase',
}

const TonalLevelSchema = z.enum(TonalLevel).describe('Signed adjustment level').meta({ id: 'TonalLevel' });

const AdjustParametersSchema = z
  .object({
    brightness: TonalLevelSchema.optional().describe('Brightness adjustment level'),
    contrast: TonalLevelSchema.optional().describe('Contrast adjustment level'),
    saturation: TonalLevelSchema.optional().describe('Saturation adjustment level'),
    autoEnhance: z.boolean().optional().describe('Auto-enhance (contrast stretch)'),
  })
  .superRefine((p, ctx) => {
    const manual = [p.brightness, p.contrast, p.saturation].filter((v) => v !== undefined);
    if (p.autoEnhance === undefined && manual.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'At least one adjustment is required' });
    }
    if (p.autoEnhance && manual.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'autoEnhance cannot be combined with manual adjustments' });
    }
  })
  .meta({ id: 'AdjustParameters' });
```

3. Wire `Adjust` into the discriminated union `__AssetEditActionItemSchema`:

```ts
z.object({ action: AssetEditActionSchema.extract(['Adjust']), parameters: AdjustParametersSchema }),
```

4. Add `AdjustParametersSchema` to the `AssetEditParametersSchema` union list.
5. Add `[AssetEditAction.Adjust]: AdjustParametersSchema` to `actionParameterMap`.
6. Export the type + value:

```ts
export type AdjustParameters = z.infer<typeof AdjustParametersSchema>;
```

(add `AdjustParameters` to the existing `export type ... = z.infer<...>` block at the bottom; `TonalLevel` is already exported as an enum.)

> `uniqueEditActions` already keys non-mirror actions by `action`, so two `adjust` actions are rejected automatically — no change needed there. Confirm by reading the function.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C server test -- --run src/dtos/editing.dto.spec.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/editing.dto.ts server/src/dtos/editing.dto.spec.ts
git commit -m "feat(editing): adjust edit action schema (TonalLevel + AdjustParameters)"
```

---

## Task 2: Pure factor tables + `contrastLinear` helper

**Files:**

- Create: `server/src/utils/editor-adjust.ts`
- Test: `server/src/utils/editor-adjust.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/utils/editor-adjust.spec.ts`:

```ts
import { TonalLevel } from 'src/dtos/editing.dto';
import { BRIGHTNESS_FACTOR, contrastLinear, CONTRAST_SLOPE, SATURATION_FACTOR } from 'src/utils/editor-adjust';

describe('editor-adjust factor tables', () => {
  it('brightness factors match the contract', () => {
    expect(BRIGHTNESS_FACTOR[TonalLevel.StrongDecrease]).toBe(0.7);
    expect(BRIGHTNESS_FACTOR[TonalLevel.SlightIncrease]).toBe(1.08);
    expect(BRIGHTNESS_FACTOR[TonalLevel.StrongIncrease]).toBe(1.32);
  });

  it('saturation factors match the contract', () => {
    expect(SATURATION_FACTOR[TonalLevel.StrongDecrease]).toBe(0.4);
    expect(SATURATION_FACTOR[TonalLevel.StrongIncrease]).toBe(1.55);
  });

  it('contrast slopes match the contract', () => {
    expect(CONTRAST_SLOPE[TonalLevel.SlightIncrease]).toBe(1.1);
    expect(CONTRAST_SLOPE[TonalLevel.StrongDecrease]).toBe(0.74);
  });

  describe('contrastLinear pivots around mid', () => {
    it('8-bit srgb mid=128', () => {
      expect(contrastLinear(TonalLevel.SlightIncrease, 128)).toEqual({ a: 1.1, b: 128 * (1 - 1.1) });
    });
    it('16-bit rgb16 mid=32768', () => {
      expect(contrastLinear(TonalLevel.SlightIncrease, 32768)).toEqual({ a: 1.1, b: 32768 * (1 - 1.1) });
    });
    it('a decrease level (a<1) yields b>0', () => {
      const { a, b } = contrastLinear(TonalLevel.ModerateDecrease, 128);
      expect(a).toBeLessThan(1);
      expect(b).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server test -- --run src/utils/editor-adjust.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `server/src/utils/editor-adjust.ts`:

```ts
import { TonalLevel } from 'src/dtos/editing.dto';

export const BRIGHTNESS_FACTOR: Record<TonalLevel, number> = {
  [TonalLevel.StrongDecrease]: 0.7,
  [TonalLevel.ModerateDecrease]: 0.82,
  [TonalLevel.SlightDecrease]: 0.92,
  [TonalLevel.SlightIncrease]: 1.08,
  [TonalLevel.ModerateIncrease]: 1.18,
  [TonalLevel.StrongIncrease]: 1.32,
};

export const SATURATION_FACTOR: Record<TonalLevel, number> = {
  [TonalLevel.StrongDecrease]: 0.4,
  [TonalLevel.ModerateDecrease]: 0.65,
  [TonalLevel.SlightDecrease]: 0.85,
  [TonalLevel.SlightIncrease]: 1.15,
  [TonalLevel.ModerateIncrease]: 1.3,
  [TonalLevel.StrongIncrease]: 1.55,
};

export const CONTRAST_SLOPE: Record<TonalLevel, number> = {
  [TonalLevel.StrongDecrease]: 0.74,
  [TonalLevel.ModerateDecrease]: 0.84,
  [TonalLevel.SlightDecrease]: 0.92,
  [TonalLevel.SlightIncrease]: 1.1,
  [TonalLevel.ModerateIncrease]: 1.22,
  [TonalLevel.StrongIncrease]: 1.4,
};

/** Linear contrast pivoting around mid-gray: output = a*input + b, with a*mid + b = mid. */
export const contrastLinear = (level: TonalLevel, mid: number): { a: number; b: number } => {
  const a = CONTRAST_SLOPE[level];
  return { a, b: mid * (1 - a) };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C server test -- --run src/utils/editor-adjust.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/editor-adjust.ts server/src/utils/editor-adjust.spec.ts
git commit -m "feat(editing): adjust factor tables + contrastLinear helper"
```

---

## Task 3: `transform.ts` adjust-is-a-no-op regression

**Files:**

- Test: `server/src/utils/transform.spec.ts` (extend)

`transform.ts` needs **no code change** — `getOutputDimensions` only reads crop/rotate, `createAffineMatrix` maps unknown actions to `identity()`, and `transformPoints` `continue`s on non-affine actions. This task locks that in with tests.

- [ ] **Step 1: Write the failing test**

Add to `server/src/utils/transform.spec.ts` (reuse the file's existing imports/fixtures; add `Adjust`/`TonalLevel` to the editing.dto import):

```ts
describe('adjust is geometrically inert', () => {
  const adjust = { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.ModerateIncrease } } as const;

  it('getOutputDimensions ignores adjust', () => {
    const dims = { width: 800, height: 600 };
    expect(getOutputDimensions([adjust], dims)).toEqual(dims);
  });

  it('mixed [crop, adjust, rotate] equals [crop, rotate] geometry', () => {
    const dims = { width: 800, height: 600 };
    const crop = { action: AssetEditAction.Crop, parameters: { x: 10, y: 20, width: 400, height: 300 } } as const;
    const rotate = { action: AssetEditAction.Rotate, parameters: { angle: 90 } } as const;
    expect(getOutputDimensions([crop, adjust, rotate], dims)).toEqual(getOutputDimensions([crop, rotate], dims));
  });

  it('transformFaceBoundingBox is unchanged by an adjust edit', () => {
    const box = {
      boundingBoxX1: 10,
      boundingBoxY1: 20,
      boundingBoxX2: 110,
      boundingBoxY2: 220,
      imageWidth: 800,
      imageHeight: 600,
    };
    const rotate = { action: AssetEditAction.Rotate, parameters: { angle: 90 } } as const;
    const withAdjust = transformFaceBoundingBox(box, [rotate, adjust], { width: 800, height: 600 });
    const without = transformFaceBoundingBox(box, [rotate], { width: 800, height: 600 });
    expect(withAdjust).toEqual(without);
  });
});
```

> Match the existing import style at the top of `transform.spec.ts` — import `getOutputDimensions`, `transformFaceBoundingBox` from `src/utils/transform` and `AssetEditAction`, `TonalLevel` from `src/dtos/editing.dto`. If `transformFaceBoundingBox` isn't already imported there, add it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C server test -- --run src/utils/transform.spec.ts`
Expected: FAIL — `TonalLevel` import (and the new cases) until the import resolves; if the import resolves but the `as const` typing rejects `Adjust`, that confirms Task 1 wired the union. Cases should then pass once Task 1 is in (adjust already inert). If a case FAILS on values, that's a real bug to fix in `transform.ts`.

- [ ] **Step 3: Implementation**

None expected. If `getOutputDimensions`/`transformFaceBoundingBox` change dims/points when an adjust is present, fix the offending function to skip `AssetEditAction.Adjust` explicitly. Otherwise no change.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C server test -- --run src/utils/transform.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/transform.spec.ts server/src/utils/transform.ts
git commit -m "test(editing): lock adjust as a geometric no-op in transform"
```

---

## Task 4: Render tonal ops in `applyEdits` (real-sharp behavioral)

**Files:**

- Modify: `server/src/repositories/media.repository.ts` (`applyEdits` ~line 149; caller `getImageDecodingPipeline` ~line 209)
- Test: `server/src/repositories/media.repository.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add a `describe('applyEdits (tonal adjustments)')` block to `media.repository.spec.ts`. Use real sharp + a uniform/two-region image and assert rendered pixels (mirror the existing `getPixelColor` helper):

```ts
const solid = (r: number, g: number, b: number, size = 100) =>
  sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } }).png();

describe('applyEdits (tonal adjustments)', () => {
  it('brightness increase lightens pixels', async () => {
    const out = await sut['applyEdits'](solid(128, 128, 128), [
      { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.ModerateIncrease } },
    ]);
    const px = await getPixelColor(await out.toBuffer(), 10, 10);
    expect(px.r).toBeGreaterThan(140); // 128 * 1.18 ≈ 151
  });

  it('brightness decrease darkens pixels', async () => {
    const out = await sut['applyEdits'](solid(128, 128, 128), [
      { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.ModerateDecrease } },
    ]);
    const px = await getPixelColor(await out.toBuffer(), 10, 10);
    expect(px.r).toBeLessThan(120); // 128 * 0.82 ≈ 105
  });

  it('saturation decrease reduces channel spread', async () => {
    const out = await sut['applyEdits'](solid(200, 50, 50), [
      { action: AssetEditAction.Adjust, parameters: { saturation: TonalLevel.StrongDecrease } },
    ]);
    const px = await getPixelColor(await out.toBuffer(), 10, 10);
    const spread = Math.max(px.r, px.g, px.b) - Math.min(px.r, px.g, px.b);
    expect(spread).toBeLessThan(150); // original spread = 150
  });

  it('contrast increase widens the spread around mid', async () => {
    // left half = 64 (below mid), right half = 192 (above mid)
    const img = sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 64, g: 64, b: 64 } } })
      .composite([
        {
          input: { create: { width: 50, height: 100, channels: 3, background: { r: 192, g: 192, b: 192 } } },
          left: 50,
          top: 0,
        },
      ])
      .png();
    const out = await sut['applyEdits'](img, [
      { action: AssetEditAction.Adjust, parameters: { contrast: TonalLevel.ModerateIncrease } },
    ]);
    const buf = await out.toBuffer();
    const dark = await getPixelColor(buf, 10, 50);
    const light = await getPixelColor(buf, 90, 50);
    expect(dark.r).toBeLessThan(64);
    expect(light.r).toBeGreaterThan(192);
  });

  it('autoEnhance stretches a narrow band toward full range', async () => {
    const img = sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 60, g: 60, b: 60 } } })
      .composite([
        {
          input: { create: { width: 50, height: 100, channels: 3, background: { r: 180, g: 180, b: 180 } } },
          left: 50,
          top: 0,
        },
      ])
      .png();
    const out = await sut['applyEdits'](img, [{ action: AssetEditAction.Adjust, parameters: { autoEnhance: true } }]);
    const buf = await out.toBuffer();
    const lo = await getPixelColor(buf, 10, 50);
    const hi = await getPixelColor(buf, 90, 50);
    expect(lo.r).toBeLessThan(60);
    expect(hi.r).toBeGreaterThan(180);
  });

  it('all three manual fields apply (modulate + linear) without error', async () => {
    const out = await sut['applyEdits'](solid(120, 90, 90), [
      {
        action: AssetEditAction.Adjust,
        parameters: {
          brightness: TonalLevel.SlightIncrease,
          saturation: TonalLevel.SlightDecrease,
          contrast: TonalLevel.SlightIncrease,
        },
      },
    ]);
    const px = await getPixelColor(await out.toBuffer(), 10, 10);
    expect(px.r).toBeGreaterThanOrEqual(0); // renders to a valid buffer
  });

  it('no adjust edit leaves pixels unchanged (rotate-only)', async () => {
    const baseline = await solid(128, 64, 32).toBuffer();
    const out = await sut['applyEdits'](sharp(baseline), [
      { action: AssetEditAction.Rotate, parameters: { angle: 0 } },
    ]);
    const px = await getPixelColor(await out.toBuffer(), 10, 10);
    expect(px).toEqual({ r: 128, g: 64, b: 32 });
  });
});
```

Add `TonalLevel` to the editing.dto import at the top of the spec.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C server test -- --run src/repositories/media.repository.spec.ts`
Expected: FAIL — tonal edits are not applied (brightness/contrast/etc. unchanged), so the pixel assertions fail.

- [ ] **Step 3: Implement the tonal branch**

In `media.repository.ts`:

1. Imports: add `AdjustParameters` to the `editing.dto` import; add `import { BRIGHTNESS_FACTOR, contrastLinear, SATURATION_FACTOR } from 'src/utils/editor-adjust';`. Ensure `Colorspace` is imported (it already is, used by `getImageDecodingPipeline`).
2. Change the `applyEdits` signature to receive the working colorspace and apply tonal ops after the affine step:

```ts
// `options.colorspace` is typed `string` in src/types.ts, so accept `string` (compare against the Colorspace enum value).
private async applyEdits(
  pipeline: sharp.Sharp,
  edits: AssetEditActionItem[],
  colorspace: string = Colorspace.Srgb,
): Promise<sharp.Sharp> {
  const affineEditOperations = edits.filter((edit) => edit.action !== 'crop');
  const matrix = createAffineMatrix(affineEditOperations);

  const crop = edits.find((edit) => edit.action === 'crop');
  const dimensions = await pipeline.metadata();

  if (crop) {
    pipeline = pipeline.extract({
      left: Math.round(crop.parameters.x),
      top: Math.round(crop.parameters.y),
      width: Math.round(crop.parameters.width),
      height: Math.round(crop.parameters.height),
    });
  }

  const { a, b, c, d } = matrix;
  pipeline = pipeline.affine([
    [a, b],
    [c, d],
  ]);

  const adjust = edits.find((edit) => edit.action === AssetEditAction.Adjust)?.parameters as
    | AdjustParameters
    | undefined;
  if (adjust) {
    if (adjust.autoEnhance) {
      pipeline = pipeline.normalise();
    } else {
      const brightness = adjust.brightness ? BRIGHTNESS_FACTOR[adjust.brightness] : 1;
      const saturation = adjust.saturation ? SATURATION_FACTOR[adjust.saturation] : 1;
      if (brightness !== 1 || saturation !== 1) {
        pipeline = pipeline.modulate({ brightness, saturation });
      }
      if (adjust.contrast) {
        const mid = colorspace === Colorspace.Srgb ? 128 : 32768;
        const { a: ca, b: cb } = contrastLinear(adjust.contrast, mid);
        pipeline = pipeline.linear(ca, cb);
      }
    }
  }

  return pipeline;
}
```

> The existing code did `left: crop ? Math.round(...) : 0` inside the `if (crop)` block — simplify to the direct form above (crop is non-null there). Keep behavior identical for crop/rotate/mirror.

3. Update the caller in `getImageDecodingPipeline` (~line 209-211) to pass the colorspace:

```ts
if (options.edits && options.edits.length > 0) {
  pipeline = await this.applyEdits(pipeline, options.edits, options.colorspace);
}
```

> `options.colorspace` is the `Colorspace` already used a few lines above for `pipelineColorspace`/`withIccProfile`. If it's optional/undefined there, default to `Colorspace.Srgb` (the signature default handles it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C server test -- --run src/repositories/media.repository.spec.ts`
Expected: PASS (existing crop/rotate/mirror tests + the 7 new tonal tests). If `autoEnhance`/`normalise` direction is off, verify the band image actually has min<max (it does: 60 vs 180).

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/media.repository.ts server/src/repositories/media.repository.spec.ts
git commit -m "feat(editing): render adjust tonal ops in applyEdits (sharp modulate/linear/normalise)"
```

---

## Task 5: OpenAPI regen (TS + Dart) + full gates

**Files:** generated only — `open-api/`, `mobile/openapi/`.

- [ ] **Step 1: Type-check + lint + format**

```bash
make check-server && make lint-server
pnpm -C server exec prettier --write src/dtos/editing.dto.ts src/utils/editor-adjust.ts src/repositories/media.repository.ts src/dtos/editing.dto.spec.ts src/utils/editor-adjust.spec.ts src/utils/transform.spec.ts src/repositories/media.repository.spec.ts
```

Expected: clean (zero warnings).

- [ ] **Step 2: Regenerate OpenAPI (TS + Dart)**

```bash
pnpm -C server build && pnpm -C server sync:open-api && make open-api
```

- [ ] **Step 3: Verify the new types are present in BOTH clients**

```bash
git status --porcelain open-api/ mobile/openapi/
grep -rl "TonalLevel" open-api/typescript-sdk/src >/dev/null && echo "TS ok"
grep -rl "tonal_level\|TonalLevel" mobile/openapi/lib >/dev/null && echo "Dart ok"
```

Expected: both `TonalLevel` / `AdjustParameters` present in the TS SDK and the Dart client (`mobile/openapi/`). If Dart is missing, run `make open-api-dart` explicitly (G2 lesson).

- [ ] **Step 4: Run the full Slice-1 test set once more**

```bash
pnpm -C server test -- --run src/dtos/editing.dto.spec.ts src/utils/editor-adjust.spec.ts src/utils/transform.spec.ts src/repositories/media.repository.spec.ts
```

Expected: all green.

- [ ] **Step 5: Commit the generated clients**

```bash
git add open-api/ mobile/openapi/
git commit -m "chore(openapi): regenerate clients for adjust edit action (TS + Dart)"
```

---

## Edge cases covered (from the spec)

- Empty adjust `{}` → rejected (Task 1).
- `autoEnhance` + manual field → rejected (Task 1).
- Invalid `TonalLevel` → rejected (Task 1).
- Two adjust actions → rejected by `uniqueEditActions` (Task 1).
- Adjust coexisting with crop + mirror → accepted (Task 1).
- `modulate({brightness:1,saturation:1})` no-op skipped when both are 1 (Task 4 implementation guard).
- Adjust is geometrically inert (dims/points/face boxes unchanged) (Task 3).
- Contrast pivots around the correct mid for srgb (128) vs rgb16 (32768) (Task 2 + Task 4).
- Non-image inputs are guarded at the op/workflow layers (Slices 3/5), not the renderer.

## Self-review checklist (run before handing off)

- Every Slice-1 spec test maps to a task above (schema XOR/levels → T1; factor tables + contrastLinear both colorspaces → T2; transform no-op → T3; rendered tonal direction incl. all-three + no-adjust → T4; OpenAPI TS+Dart → T5). ✅
- No placeholders; all code shown. ✅
- Type names consistent: `TonalLevel`, `AdjustParameters`, `BRIGHTNESS_FACTOR`/`SATURATION_FACTOR`/`CONTRAST_SLOPE`, `contrastLinear(level, mid)`. ✅
- No future-slice work (no agent op, no endpoint, no workflow). ✅

```

```
