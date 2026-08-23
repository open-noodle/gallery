# People Avatar Source — Slice 2: Extract the Pure Resolver

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all avatar-source decision logic out of `DetailPanelPeople.svelte` into a pure, unit-tested module, and collapse the component's triplicated `<ImageThumbnail>` into one snippet — with zero behaviour change.

**Architecture:** A new `web/src/lib/utils/person-avatar.ts` exports two pure functions. `getRepresentativeThumbnailUrl` answers "does this viewer have a reachable profile-face URL for this person, and what is it?". `resolvePersonAvatar` picks one of three renderings. The component becomes a thin renderer over that decision. The setting is **not** read in this slice — `cropFacesFromAsset: true` is passed as a literal so behaviour is byte-identical to slice 1's pins.

**Tech Stack:** TypeScript, Svelte 5 runes + snippets, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-people-avatar-source-setting-design.md` §3.1, §3.4, §4, §6 Slice 2.

## Global Constraints

- Web unit tests run as `pnpm test --run <path>` from `web/`. **Never** `pnpm test -- --run <path>` (drops the path filter, runs all 295 files).
- **Slice 1's pins must stay green without being edited.** If a pin needs changing to accommodate this slice, the refactor is wrong — stop and report.
- No relative imports in new web modules; use the `$lib/` alias, matching the rest of `web/src/lib/utils/`.
- Prettier: 120 char width, single quotes, trailing commas, semicolons.
- `web`'s `pnpm lint` is `eslint . --concurrency 6` — **no `--max-warnings`**. Only errors fail it. The ~600 pre-existing `better-tailwindcss/enforce-consistent-class-order` warnings are tolerated; judge the gate by exit code, not by warning count.
- IDE diagnostics reading `Cannot find name 'vi' / 'describe' / 'expect'` in `.spec.ts` files are language-server noise. `pnpm check:typescript` is the real gate and is clean.

---

### Task 1: The pure resolver module

**Files:**

- Create: `web/src/lib/utils/person-avatar.ts`
- Test: `web/src/lib/utils/person-avatar.spec.ts`

**Interfaces:**

- Consumes: `createUrl`, `getPeopleThumbnailUrl` from `$lib/utils`; `PersonResponseDto` from `@immich/sdk`.
- Produces, for Task 2 and for slices 4 and 6:
  - `getRepresentativeThumbnailUrl(person: PersonResponseDto, context: { isOwner: boolean; spaceId?: string }): string | undefined`
  - `resolvePersonAvatar(input: { person: PersonResponseDto; isOwner: boolean; spaceId?: string; hasFaceInAsset: boolean; cropFacesFromAsset: boolean; assetThumbnailUrl: string }): PersonAvatar`
  - `type PersonAvatar = { kind: 'representative'; url: string } | { kind: 'assetFace'; fallbackUrl: string } | { kind: 'fallback'; url: string }`

- [ ] **Step 1: Write the failing unit spec**

Create `web/src/lib/utils/person-avatar.spec.ts`:

```ts
import type { PersonResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { getRepresentativeThumbnailUrl, resolvePersonAvatar } from '$lib/utils/person-avatar';

const person = (overrides: Partial<PersonResponseDto> = {}): PersonResponseDto =>
  ({
    id: 'person-1',
    name: 'Alice',
    birthDate: null,
    thumbnailPath: '',
    isHidden: false,
    isFavorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as unknown as PersonResponseDto;

const ASSET_THUMB = '/api/assets/asset-1/thumbnail';

describe('getRepresentativeThumbnailUrl', () => {
  it('returns the owner person thumbnail for the owner outside a space', () => {
    const url = getRepresentativeThumbnailUrl(person(), { isOwner: true });
    expect(url).toContain('/people/person-1/thumbnail');
  });

  it('returns the space person thumbnail for a space member', () => {
    const url = getRepresentativeThumbnailUrl(person({ spacePersonId: 'space-person-1' }), {
      isOwner: false,
      spaceId: 'space-1',
    });
    expect(url).toContain('/shared-spaces/space-1/people/space-person-1/thumbnail');
  });

  it('prefers the space arm over the owner arm when both could apply', () => {
    const url = getRepresentativeThumbnailUrl(person({ spacePersonId: 'space-person-1' }), {
      isOwner: true,
      spaceId: 'space-1',
    });
    expect(url).toContain('/shared-spaces/');
    expect(url).not.toContain('/people/person-1/');
  });

  it('takes the owner arm for the owner inside a space when the person has no space profile', () => {
    // mapPerson never emits spacePersonId, so this is the real shape for an owner in a space.
    const url = getRepresentativeThumbnailUrl(person(), { isOwner: true, spaceId: 'space-1' });
    expect(url).toContain('/people/person-1/thumbnail');
    expect(url).not.toContain('/shared-spaces/');
  });

  it('returns undefined for a viewer who is neither owner nor space member', () => {
    expect(getRepresentativeThumbnailUrl(person(), { isOwner: false })).toBeUndefined();
  });

  it('returns undefined for a non-owner in a space whose person has no space profile', () => {
    // Must not synthesise /shared-spaces/space-1/people/undefined/thumbnail.
    expect(getRepresentativeThumbnailUrl(person(), { isOwner: false, spaceId: 'space-1' })).toBeUndefined();
  });

  it('carries updatedAt as a cache-buster on the owner arm', () => {
    const url = getRepresentativeThumbnailUrl(person({ updatedAt: '2026-02-02T00:00:00.000Z' }), { isOwner: true });
    expect(url).toContain('updatedAt=');
    expect(url).toContain('2026-02-02');
  });

  it('carries updatedAt as a cache-buster on the space arm', () => {
    const url = getRepresentativeThumbnailUrl(
      person({ spacePersonId: 'space-person-1', updatedAt: '2026-02-02T00:00:00.000Z' }),
      { isOwner: false, spaceId: 'space-1' },
    );
    expect(url).toContain('updatedAt=');
    expect(url).toContain('2026-02-02');
  });

  it('omits the updatedAt param when the person has none', () => {
    const url = getRepresentativeThumbnailUrl(person({ updatedAt: undefined }), { isOwner: true });
    expect(url).not.toContain('updatedAt=');
  });
});

describe('resolvePersonAvatar', () => {
  const resolve = (overrides: Partial<Parameters<typeof resolvePersonAvatar>[0]> = {}) =>
    resolvePersonAvatar({
      person: person(),
      isOwner: true,
      hasFaceInAsset: true,
      cropFacesFromAsset: true,
      assetThumbnailUrl: ASSET_THUMB,
      ...overrides,
    });

  it('crops from the asset when the setting is on and the person has a face', () => {
    const avatar = resolve();
    expect(avatar.kind).toBe('assetFace');
    expect(avatar).toHaveProperty('fallbackUrl', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('uses the representative face when the setting is off', () => {
    const avatar = resolve({ cropFacesFromAsset: false });
    expect(avatar.kind).toBe('representative');
    expect(avatar).toHaveProperty('url', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('uses the representative face when the person has no face in this asset', () => {
    const avatar = resolve({ hasFaceInAsset: false });
    expect(avatar.kind).toBe('fallback');
    expect(avatar).toHaveProperty('url', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('falls back to the asset thumbnail when there is no representative face and no crop', () => {
    const avatar = resolve({ isOwner: false, hasFaceInAsset: false });
    expect(avatar).toEqual({ kind: 'fallback', url: ASSET_THUMB });
  });

  it('KEEPS cropping for a viewer with no reachable representative face even when the setting is off', () => {
    // The regression guard: turning the setting off must not demote an album/partner viewer to
    // the whole-asset thumbnail as every person's avatar.
    const avatar = resolve({ isOwner: false, cropFacesFromAsset: false });
    expect(avatar).toEqual({ kind: 'assetFace', fallbackUrl: ASSET_THUMB });
  });

  it('uses the space representative face for a space member when the setting is off', () => {
    const avatar = resolve({
      person: person({ spacePersonId: 'space-person-1' }),
      isOwner: false,
      spaceId: 'space-1',
      cropFacesFromAsset: false,
    });
    expect(avatar.kind).toBe('representative');
    expect(avatar).toHaveProperty('url', expect.stringContaining('/shared-spaces/space-1/people/space-person-1/'));
  });

  it('uses the owner representative face for the owner inside a space when the setting is off', () => {
    const avatar = resolve({ spaceId: 'space-1', cropFacesFromAsset: false });
    expect(avatar).toHaveProperty('url', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('degrades a space member with no space profile to the asset thumbnail, never a broken space URL', () => {
    const avatar = resolve({ isOwner: false, spaceId: 'space-1', hasFaceInAsset: false });
    expect(avatar).toEqual({ kind: 'fallback', url: ASSET_THUMB });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `cd web && pnpm test --run src/lib/utils/person-avatar.spec.ts`
Expected: FAIL at collection — `Failed to resolve import "$lib/utils/person-avatar"`. If it fails any other way, stop and report.

- [ ] **Step 3: Write the module**

Create `web/src/lib/utils/person-avatar.ts`:

```ts
import type { PersonResponseDto } from '@immich/sdk';
import { createUrl, getPeopleThumbnailUrl } from '$lib/utils';

/** Which of the three renderings the Info-panel People grid should use for one person. */
export type PersonAvatar =
  | { kind: 'representative'; url: string }
  | { kind: 'assetFace'; fallbackUrl: string }
  | { kind: 'fallback'; url: string };

/**
 * The URL of the person's representative (feature-photo) face, or `undefined` when this viewer
 * has no representative thumbnail they can reach.
 *
 * The space arm is checked first: inside a space, a person's profile may carry its own name and
 * face that differ from the underlying `person` row, so the space thumbnail wins whenever there
 * is one.
 *
 * The `undefined` arm is NOT "non-owner". `/people/{id}/thumbnail` is guarded by
 * Permission.PersonRead, which server/src/utils/access.ts resolves as owner ∪ shared-space member
 * — a space member may legitimately read it. It returns undefined only for a viewer who is
 * neither, i.e. someone reaching the asset through an album or partner share. Such a viewer has
 * no profile face to show, which is why the crop-vs-profile setting cannot apply to them.
 */
export const getRepresentativeThumbnailUrl = (
  person: PersonResponseDto,
  { isOwner, spaceId }: { isOwner: boolean; spaceId?: string },
): string | undefined => {
  if (spaceId && person.spacePersonId) {
    return createUrl(`/shared-spaces/${spaceId}/people/${person.spacePersonId}/thumbnail`, {
      updatedAt: person.updatedAt,
    });
  }

  return isOwner ? getPeopleThumbnailUrl(person) : undefined;
};

export const resolvePersonAvatar = ({
  person,
  isOwner,
  spaceId,
  hasFaceInAsset,
  cropFacesFromAsset,
  assetThumbnailUrl,
}: {
  person: PersonResponseDto;
  isOwner: boolean;
  spaceId?: string;
  hasFaceInAsset: boolean;
  cropFacesFromAsset: boolean;
  assetThumbnailUrl: string;
}): PersonAvatar => {
  const representativeUrl = getRepresentativeThumbnailUrl(person, { isOwner, spaceId });

  if (!cropFacesFromAsset && representativeUrl) {
    return { kind: 'representative', url: representativeUrl };
  }

  if (hasFaceInAsset) {
    return { kind: 'assetFace', fallbackUrl: representativeUrl ?? assetThumbnailUrl };
  }

  return { kind: 'fallback', url: representativeUrl ?? assetThumbnailUrl };
};
```

- [ ] **Step 4: Run the spec to green**

Run: `cd web && pnpm test --run src/lib/utils/person-avatar.spec.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/person-avatar.ts web/src/lib/utils/person-avatar.spec.ts
git commit -m "refactor(web): extract info-panel avatar resolution into a pure module"
```

---

### Task 2: Rewire the component onto the resolver and collapse the snippet

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`

**Interfaces:**

- Consumes: `getRepresentativeThumbnailUrl`, `resolvePersonAvatar`, `PersonAvatar` from Task 1.
- Produces: nothing new; the component's props are unchanged.

- [ ] **Step 1: Replace `getPersonFallbackThumbnailUrl` with the resolver**

In the `<script>` block, delete the whole `getPersonFallbackThumbnailUrl` function **and its comment block**, and delete the now-unused imports `getAssetUrls`, `getPeopleThumbnailUrl`, and `createUrl` **only if** nothing else in the file uses them (`createUrl` is still used by `getPersonHref` — check before deleting).

Add the import:

```ts
import { resolvePersonAvatar } from '$lib/utils/person-avatar';
```

- [ ] **Step 2: Add the avatar snippet**

Declare the snippet at the **top level of the markup, immediately after the closing `-->` of the `#796` comment block and immediately before `{#if !authManager.isSharedLink …}`**. Top level puts it in scope for the whole template, and declaring it before its use site avoids relying on snippet hoisting:

```svelte
{#snippet avatar(url: string, person: AssetPerson, isHighlighted: boolean)}
  <ImageThumbnail
    curve
    shadow
    {url}
    altText={person.name}
    title={person.name}
    widthStyle="100%"
    hidden={person.isHidden}
    highlighted={isHighlighted}
    class="outline-offset-2 outline-immich-primary group-focus-visible:outline-2 dark:outline-immich-dark-primary"
  />
{/snippet}
```

- [ ] **Step 3: Replace the three `<ImageThumbnail>` blocks**

Replace the entire `{#if personFaces[0]} … {/if}` block inside the `<a>` with:

```svelte
{@const avatarSource = resolvePersonAvatar({
  person,
  isOwner,
  spaceId,
  hasFaceInAsset: personFaces.length > 0,
  cropFacesFromAsset: true,
  assetThumbnailUrl: getAssetUrls(asset).thumbnail,
})}
{#if avatarSource.kind === 'assetFace'}
  {#await zoomImageToBase64(personFaces[0]!, asset.id, asset.type, assetViewerManager.imgRef)}
    {@render avatar(avatarSource.fallbackUrl, person, isHighlighted)}
  {:then faceThumbnailUrl}
    {@render avatar(faceThumbnailUrl ?? avatarSource.fallbackUrl, person, isHighlighted)}
  {/await}
{:else}
  {@render avatar(avatarSource.url, person, isHighlighted)}
{/if}
```

`getAssetUrls` is therefore still needed — keep its import. `cropFacesFromAsset: true` is a deliberate literal in this slice; slice 4 replaces it with the store.

- [ ] **Step 4: Run slice 1's pins — they must pass unmodified**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 21 tests, with **no edits to the spec file**. If any pin fails, the refactor changed behaviour — fix the component, never the pin.

- [ ] **Step 5: Type-check and lint**

Run: `cd web && pnpm check:typescript && pnpm lint`
Expected: both clean. `pnpm lint` must report zero warnings.

- [ ] **Step 6: Run the full web suite**

Run: `cd web && pnpm test --run`
Expected: 295 files, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.svelte
git commit -m "refactor(web): render info-panel avatars from one snippet"
```

---

## Slice Completion Checklist

- [ ] `person-avatar.ts` + spec exist; 17 unit tests green.
- [ ] Slice 1's 21 component tests pass **with the spec file unmodified** (`git diff` on it is empty for this slice).
- [ ] `<ImageThumbnail>` appears exactly once in `DetailPanelPeople.svelte`.
- [ ] `pnpm check:typescript`, `pnpm lint`, `pnpm test --run` all clean.
- [ ] Branch pushed.
