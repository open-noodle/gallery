# People Avatar Source — Slice 1: Pin Today's Avatar Behaviour

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock today's Info-panel avatar behaviour behind pin tests so slices 2–6 cannot change it by accident.

**Architecture:** Test-only slice. No production file is touched. Every test asserts the rendered `<img src>` of the People grid in `DetailPanelPeople.svelte` for one viewer/face/crop combination, then is proven able to fail by mutating the component and watching it go red.

**Tech Stack:** Vitest, `@testing-library/svelte`, happy-dom, Svelte 5 runes.

**Spec:** `docs/superpowers/specs/2026-07-30-people-avatar-source-setting-design.md` §6 Slice 1.

## Global Constraints

- Web unit tests run as `pnpm test --run <path>` from `web/`. **Never** `pnpm test -- --run <path>` — the `--` form silently drops the path filter and runs all 295 files (spec trap 8).
- Assert avatars via `container.querySelector('img')?.getAttribute('src')`. **Never** `getByRole('img')` — these images carry `alt={person.name}`, which is `""` for untagged people, and an empty alt removes the `img` role (spec trap 3).
- `assetFactory` randomises `type`; `zoomImageToBase64` branches on it. Every asset built in this spec pins `type` explicitly (spec trap 1).
- No production source file may be modified by this slice. `git status` at the end must show only `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts` and this plan.
- Baseline is green: 294 files / 3986 tests pass. Any other red is this slice's doing.

---

### Task 1: Test harness upgrades

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts` (imports, helpers, `renderPanel`)

**Interfaces:**

- Consumes: nothing from earlier slices.
- Produces, for Tasks 2–4 in this plan and for slices 4 and 6:
  - `asset(overrides?: Partial<AssetResponseDto>): AssetResponseDto` — always `id: 'asset-1'`, `ownerId: 'owner-1'`, `type: AssetTypeEnum.Image` unless overridden.
  - `renderPanel(props: { isOwner: boolean; spaceId?: string; people?: PersonResponseDto[]; sharedLink?: boolean; assetType?: AssetTypeEnum })`
  - `spacePerson(name: string, spacePersonId: string): PersonResponseDto`
  - `givePersonAFace(personId: string, faceId?: string): void`
  - `settleCrop(): Promise<void>`
  - `CROP_DATA_URL: string`

- [ ] **Step 1: Widen the imports**

Replace the first two import lines:

```ts
import type { PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen } from '@testing-library/svelte';
```

with:

```ts
import { AssetTypeEnum, type AssetResponseDto, type PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
```

- [ ] **Step 2: Replace the `asset` helper and `renderPanel`**

Find:

```ts
const asset = () => assetFactory.build({ id: 'asset-1', ownerId: 'owner-1' });
```

Replace with:

```ts
// `assetFactory` randomises `type` (see web/src/test-data/factories/asset-factory.ts), and
// `zoomImageToBase64` takes a different code path for Image vs Video. An unpinned type is a
// latent flake, so every asset built here pins it.
const asset = (overrides: Partial<AssetResponseDto> = {}) =>
  assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', type: AssetTypeEnum.Image, ...overrides });
```

Find the body of `renderPanel` and replace the whole function with:

```ts
const renderPanel = (props: {
  isOwner: boolean;
  spaceId?: string;
  people?: PersonResponseDto[];
  sharedLink?: boolean;
  assetType?: AssetTypeEnum;
}) => {
  authManagerMock.isSharedLink = props.sharedLink ?? false;
  return renderWithTooltips(DetailPanelPeople, {
    asset: asset({
      ...(props.people ? { people: props.people } : {}),
      ...(props.assetType ? { type: props.assetType } : {}),
    }),
    isOwner: props.isOwner,
    previousRoute: '/photos',
    spaceId: props.spaceId,
  });
};
```

- [ ] **Step 3: Add the new helpers directly below `renderPanel`**

```ts
// A person as the server sends it inside a shared space: the id stays the GLOBAL person id
// (AssetService.applySpacePeople only *adds* spacePersonId), which is why faceManager's
// facesByPersonId lookup still matches for space members.
const spacePerson = (name: string, spacePersonId: string): PersonResponseDto =>
  ({ ...person(name), spacePersonId }) as unknown as PersonResponseDto;

const givePersonAFace = (personId: string, faceId = 'face-1') => {
  faceManagerMock.facesByPersonId = new Map<string, unknown[]>([[personId, [{ id: faceId }]]]);
  faceManagerMock.data = [{ id: faceId }];
};

const CROP_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

// The {#await} block renders its PENDING branch first, which shows the same fallback URL the
// failure case shows. Without flushing to the :then branch, a test meaning to assert the
// resolved state silently asserts the pending state and can never fail.
const settleCrop = async () => {
  await waitFor(() => expect(zoomImageToBase64Mock).toHaveBeenCalled());
  await tick();
  await tick();
};
```

- [ ] **Step 3b: Reset the shared crop mock between tests**

`web/vite.config.ts:58-70` sets neither `clearMocks` nor `restoreMocks`, and `zoomImageToBase64Mock` is a file-level `vi.hoisted()` mock. Its **call history therefore accumulates across every test in the file.** The existing `beforeEach` only reassigns the resolved value, which does not clear calls.

This is load-bearing, not hygiene: `settleCrop` waits on `expect(zoomImageToBase64Mock).toHaveBeenCalled()`. With leaked history that predicate is already true on entry, so `settleCrop` returns before the component has rendered its `:then` branch and **every** crop assertion after the first silently checks the pending state instead.

In the existing `beforeEach`, replace:

```ts
zoomImageToBase64Mock.mockResolvedValue(undefined);
```

with:

```ts
// vite.config.ts sets no clearMocks/restoreMocks, so this shared hoisted mock keeps its call
// history across tests in this file. settleCrop() waits on that history, so it must be cleared
// or every crop assertion after the first one asserts the pending branch by mistake.
zoomImageToBase64Mock.mockReset();
zoomImageToBase64Mock.mockResolvedValue(undefined);
```

`mockReset()` clears implementations as well as calls, so the `mockResolvedValue` must come after it.

- [ ] **Step 4: Run the existing suite to prove the harness change broke nothing**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 13 tests. (Pinning `type` to Image removes randomness from the existing tests; none of them exercise the crop, so none change behaviour.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
git commit -m "test(web): pin asset type and add avatar-source test helpers"
```

---

### Task 2: Pin the owner's three avatar paths (1.1–1.3)

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
- Mutate then revert: `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`

**Interfaces:**

- Consumes: `asset`, `renderPanel`, `givePersonAFace`, `settleCrop`, `CROP_DATA_URL` from Task 1.
- Produces: nothing consumed later; these are guards.

- [ ] **Step 1: Write the three failing pins**

Append a new `describe` block inside the existing top-level `describe('DetailPanelPeople', …)`, after the last existing test:

```ts
describe('avatar source (pins current behaviour)', () => {
  it('shows the face cropped from this asset when the crop resolves', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);

    const { container } = renderPanel({ isOwner: true });
    await settleCrop();

    expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);
  });

  it('falls back to the person thumbnail when the crop resolves to null', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    zoomImageToBase64Mock.mockResolvedValue(null);

    const { container } = renderPanel({ isOwner: true });
    await settleCrop();

    expect(zoomImageToBase64Mock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
  });

  it('uses the person thumbnail and never crops when the person has no face in this asset', async () => {
    faceManagerMock.people = [person('Alice')];
    faceManagerMock.facesByPersonId = new Map();

    const { container } = renderPanel({ isOwner: true });
    await tick();

    expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 16 tests. **These are pin tests — passing first-run is expected and is not sufficient.** Step 3 is what makes them real.

- [ ] **Step 3: Mutation-verify each pin**

For each mutation: edit `DetailPanelPeople.svelte`, run the single spec file, confirm the named test **fails**, then `git checkout web/src/lib/components/asset-viewer/DetailPanelPeople.svelte` to revert before the next mutation.

| Pin                   | Mutation in `DetailPanelPeople.svelte`                                                                             | Must go red                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| crop resolves         | In the `{:then}` branch, change `url={faceThumbnailUrl ?? fallbackThumbnailUrl}` to `url={fallbackThumbnailUrl}`   | "shows the face cropped…"                    |
| crop resolves to null | In the `{:then}` branch, change `url={faceThumbnailUrl ?? fallbackThumbnailUrl}` to `url={faceThumbnailUrl ?? ''}` | "falls back to the person thumbnail…"        |
| no face in asset      | In the `{:else}` branch, change `url={fallbackThumbnailUrl}` to `url={getAssetUrls(asset).thumbnail}`              | "uses the person thumbnail and never crops…" |

Record the red output for each in the commit body.

- [ ] **Step 4: Confirm the component is unmodified**

Run: `git diff --stat web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`
Expected: empty output.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
git commit -m "test(web): pin the owner's three info-panel avatar paths"
```

---

### Task 3: Pin the space and non-owner paths (1.4–1.7)

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
- Mutate then revert: `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`

**Interfaces:**

- Consumes: `spacePerson`, `givePersonAFace`, `settleCrop`, `renderPanel` from Task 1.

- [ ] **Step 1: Write the four failing pins**

Append inside the same `describe('avatar source (pins current behaviour)', …)` block:

```ts
it('falls back to the space person thumbnail for a space member', async () => {
  const bob = spacePerson('Bob', 'space-person-1');
  givePersonAFace('person-Bob');
  zoomImageToBase64Mock.mockResolvedValue(null);

  const { container } = renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
  await settleCrop();

  expect(container.querySelector('img')?.getAttribute('src')).toContain(
    '/shared-spaces/space-1/people/space-person-1/thumbnail',
  );
});

it('falls back to the asset thumbnail for a viewer with no space context', async () => {
  faceManagerMock.people = [person('Alice')];
  givePersonAFace('person-Alice');
  zoomImageToBase64Mock.mockResolvedValue(null);

  const { container } = renderPanel({ isOwner: false });
  await settleCrop();

  const src = container.querySelector('img')?.getAttribute('src');
  // /people/{id}/thumbnail is unreachable for this viewer — see the spec's RBAC note.
  expect(src).not.toContain('/people/');
  expect(src).not.toContain('/shared-spaces/');
  expect(src).toContain('/assets/asset-1/');
});

it('uses the owner person thumbnail for the owner even inside a space', async () => {
  // The owner reads faceManager.people, and mapPerson never emits spacePersonId — so the space
  // arm cannot fire for the owner even with a spaceId prop present.
  faceManagerMock.people = [person('Alice')];
  faceManagerMock.facesByPersonId = new Map();

  const { container } = renderPanel({ isOwner: true, spaceId: 'space-1' });
  await tick();

  const src = container.querySelector('img')?.getAttribute('src');
  expect(src).toContain('/people/');
  expect(src).not.toContain('/shared-spaces/');
});

it('never synthesises a space thumbnail URL when the space person id is missing', async () => {
  // The server filters these out, but the client must degrade rather than request
  // /shared-spaces/space-1/people/undefined/thumbnail.
  const bob = person('Bob');
  faceManagerMock.facesByPersonId = new Map();

  const { container } = renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
  await tick();

  const src = container.querySelector('img')?.getAttribute('src');
  expect(src).not.toContain('/shared-spaces/');
  expect(src).not.toContain('undefined');
  expect(src).toContain('/assets/asset-1/');
});
```

- [ ] **Step 2: Run them**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 20 tests.

- [ ] **Step 3: Mutation-verify each pin**

Same revert discipline as Task 2.

| Pin                          | Mutation in `getPersonFallbackThumbnailUrl`                                                                                         | Must go red                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| space member fallback        | Delete the `if (spaceId && person.spacePersonId) { … }` block                                                                       | "falls back to the space person…"          |
| viewer with no space context | Change `return isOwner ? getPeopleThumbnailUrl(person) : getAssetUrls(asset).thumbnail;` to `return getPeopleThumbnailUrl(person);` | "falls back to the asset thumbnail…"       |
| owner inside a space         | Change the space guard from `spaceId && person.spacePersonId` to `spaceId`                                                          | "uses the owner person thumbnail…"         |
| missing space person id      | Change the space guard from `spaceId && person.spacePersonId` to `spaceId`                                                          | "never synthesises a space thumbnail URL…" |

- [ ] **Step 4: Confirm the component is unmodified**

Run: `git diff --stat web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`
Expected: empty output.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
git commit -m "test(web): pin space and non-owner info-panel avatar paths"
```

---

### Task 4: Pin the unnamed person, and correct the stale #796 note (1.8–1.9)

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`

**Interfaces:**

- Consumes: `renderPanel`, `givePersonAFace` from Task 1.

- [ ] **Step 1: Write the unnamed-person pin**

Append inside the same `describe` block:

```ts
it('renders an avatar for a person with no name', async () => {
  // Untagged faces are the common case and render alt="" — which strips the img role, so this
  // must be asserted structurally, never through getByRole('img') or getByText.
  faceManagerMock.people = [person('')];
  faceManagerMock.facesByPersonId = new Map();

  const { container } = renderPanel({ isOwner: true });
  await tick();

  const img = container.querySelector('img');
  expect(img).not.toBeNull();
  expect(img?.getAttribute('src')).toContain('/people/');
});
```

- [ ] **Step 2: Run it**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 21 tests.

- [ ] **Step 3: Mutation-verify**

Mutation: in `DetailPanelPeople.svelte`, wrap the `{:else}` branch's `<ImageThumbnail …/>` in `{#if person.name}…{/if}`.
Expected: "renders an avatar for a person with no name" fails. Revert with `git checkout web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`.

- [ ] **Step 4: Replace the stale `#796` NOTE comment block**

The block currently beginning `// NOTE on what these tests do and do NOT prove (#796).` makes two claims that are no longer true — `mapFaces` has not nulled `person` for non-owners since #818 (`server/src/dtos/person.dto.ts:350-361` does `void auth`), and `AssetService.get` does not hard-set `people = []` (`server/src/services/asset.service.ts:147` only filters hidden people). Replace the entire block with:

```ts
// NOTE on what these tests do and do NOT prove.
//
// These exercise the component's gate and avatar resolution given a people list. They mock
// `faceManager`, so they prove client logic only — never the server contract.
//
// History: before #818 the server redacted identity from non-owners on both sources, so the
// People section was empty for a shared-album recipient no matter what the client did. That is
// fixed — `mapFaces` (server/src/dtos/person.dto.ts) now maps `person` for anyone with
// Permission.AssetRead, and `AssetService.get` filters only hidden people for a non-owner with
// no space. The server side is pinned by real-database tests:
// server/test/medium/specs/services/person.service.spec.ts and .../asset.service.spec.ts.
//
// Avatar-URL reachability is NOT symmetric across viewers, and that asymmetry is load-bearing
// for the crop-vs-profile-face setting: /people/{id}/thumbnail is guarded by
// Permission.PersonRead, which server/src/utils/access.ts resolves as owner ∪ shared-space
// member. A viewer who is neither (album share, partner share) has no representative face to
// fall back to, which is why they stay on the asset crop unconditionally.
```

- [ ] **Step 5: Rename the misleading test**

Find the test named:

```ts
it('renders nothing for a non-owner given the empty list the server actually serves today', () => {
```

Rename it and replace its inline comment:

```ts
it('renders nothing for a non-owner when handed an empty people list', () => {
  // Pre-#818 this was the production shape for a shared-album recipient. It no longer is; the
  // test is kept because the empty-list gate itself still matters.
```

Leave the assertions untouched.

- [ ] **Step 6: Run the whole web suite**

Run: `cd web && pnpm test --run`
Expected: 295 files, 0 failures. Test count is 3986 + 8 new = 3994 passing.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
git commit -m "test(web): pin unnamed-person avatar and correct the stale #796 note"
```

---

## Slice Completion Checklist

- [ ] 8 new tests exist (1.1–1.8), each individually mutation-verified red.
- [ ] `git diff main --stat` shows **no** production source file changed.
- [ ] `cd web && pnpm test --run` is fully green.
- [ ] Branch pushed.
