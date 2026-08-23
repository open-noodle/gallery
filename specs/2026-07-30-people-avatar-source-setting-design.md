# Info-panel People avatar source — user setting

- **Status:** Ready to implement (via `/impl-loop`).
- **Date:** 2026-07-30
- **Scope:** web only. Mobile is already on the representative-face behaviour and is untouched.
- **Branch:** `feat/people-avatar-source-setting` (off `main`)
- **Origin:** user reports that the asset-viewer Info panel now shows each person cropped from the
  photo on screen rather than their profile face. Opinion is split, so the behaviour becomes a
  preference rather than a reversal.

## 1. Context

The Info panel's People grid used to render each person's **representative thumbnail** — the crop
of their feature photo served by `GET /people/{id}/thumbnail`. Fork commit `2d5b88853ee`
("fix: use space people in asset details", 2026-05-01) changed it to render a **live crop of the
face in the asset currently on screen**, computed client-side by `zoomImageToBase64()`.

Everything lives in one component, `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`,
and both code paths already exist there: the representative thumbnail is already wired up as the
_fallback_ used while the crop is pending or when it fails. The work is therefore not "add a second
rendering mode" — it is "let the user choose which of the two existing modes wins", plus the
guard rails that stop that choice from producing a broken avatar for viewers who cannot reach a
representative thumbnail at all.

### Why the crop was introduced at all

For a viewer who does not own the asset, the representative thumbnail is a crop of a _different_
asset — one they may have no right to see — and `/people/{id}/thumbnail` is reachable only to the
owner or to a member of a space containing that person (§3.1). The crop from the on-screen asset is
the only face image every entitled viewer is certainly allowed. That constraint does not disappear
when the setting is added — it becomes the reason the setting cannot be applied unconditionally
(§3.2).

## 2. Decisions

| #   | Decision                                                                | Rationale                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Store the preference in **localStorage**, web-only                      | Follows the established `preferences.store.ts` pattern (`alwaysLoadOriginalFile`, `playVideoThumbnailOnHover`). No server change, no OpenAPI/SDK/Dart regeneration, no migration. Mobile already renders representative faces, so there is nothing to sync. |
| D2  | **Default = crop from the asset** (today's behaviour)                   | Nothing changes visually on upgrade; no regression for users who like the crop. The complaining cohort opts out.                                                                                                                                            |
| D3  | Expose it in **user settings _and_ as an in-panel toggle**              | The settings switch is the discoverable, persistent home; the in-panel button lets a user flip modes on the photo where the difference actually matters.                                                                                                    |
| D4  | The setting is **inert where no representative thumbnail is reachable** | See §3.2. Applying it unconditionally would give shared-album and partner viewers eight copies of the full asset thumbnail as avatars.                                                                                                                      |

## 3. Design

### 3.1 New module: `web/src/lib/utils/person-avatar.ts`

All decision logic moves out of the component into two pure functions, so the full truth table is
covered by fast unit tests and the component spec only has to prove wiring. The signatures below are
normative; the bodies follow directly from the two rule lists that accompany them.

```ts
// No bespoke person type: `spacePersonId?: string` is already on the SDK's PersonResponseDto
// (packages/sdk/src/fetch-client.ts:976), and both call sites — faceManager.people and
// asset.people — are PersonResponseDto[]. Taking the DTO directly also lets this module reuse
// getPeopleThumbnailUrl without a cast.
export type PersonAvatar =
  | { kind: 'representative'; url: string }
  | { kind: 'assetFace'; fallbackUrl: string }
  | { kind: 'fallback'; url: string };

/**
 * The URL of the person's representative (feature-photo) face, or `undefined` when this viewer
 * has no representative thumbnail they are entitled to request.
 */
export const getRepresentativeThumbnailUrl = (
  person: PersonResponseDto,
  context: { isOwner: boolean; spaceId?: string },
): string | undefined => { ... };

/** Which of the three renderings the People grid should use for this person. */
export const resolvePersonAvatar = (input: {
  person: PersonResponseDto;
  isOwner: boolean;
  spaceId?: string;
  hasFaceInAsset: boolean;
  cropFacesFromAsset: boolean;
  assetThumbnailUrl: string;
}): PersonAvatar => { ... };
```

**`getRepresentativeThumbnailUrl`** — three arms, in order:

| Viewer                                       | URL                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Space context and `person.spacePersonId` set | `/shared-spaces/{spaceId}/people/{spacePersonId}/thumbnail?updatedAt=…` |
| `isOwner`                                    | `/people/{person.id}/thumbnail?updatedAt=…`                             |
| Anyone else                                  | `undefined` — no representative face this viewer can reach (§3.2)       |

The space arm is checked **first**, preserving today's ordering in `getPersonFallbackThumbnailUrl`:
whenever a person carries a `spacePersonId` in space context, the space thumbnail wins, because the
space person may carry a different name and face from the underlying `person` row. Both arms carry
`updatedAt` as the cache-buster — `getPeopleThumbnailUrl` already defaults it to `person.updatedAt`.

**Precise RBAC note (the component's own comment overstates this).** `/people/{id}/thumbnail` is
guarded by `Permission.PersonRead`, which `server/src/utils/access.ts:319-326` resolves as
`checkOwnerAccess ∪ checkSharedSpaceAccess` — a shared-space member **can** legitimately read it for
a person shared through their space. So the third arm is not "owner-gated"; it is "this viewer is
neither the owner nor a member of a space containing this person, so the request would be denied".
Routing space members to `/shared-spaces/…` instead is a **product** decision (the space profile may
carry its own representative face and name), not an RBAC necessity. Do not restate the third arm as
"owner-only" in code comments — it is wrong and will mislead the next reader.

**`resolvePersonAvatar`** — first match wins:

1. `cropFacesFromAsset === false` **and** a representative URL exists → `{ kind: 'representative' }`.
   The crop is never computed.
2. `hasFaceInAsset` → `{ kind: 'assetFace', fallbackUrl: representativeUrl ?? assetThumbnailUrl }`.
   Today's behaviour: the fallback renders while the crop resolves and if the crop returns `null`.
3. otherwise → `{ kind: 'fallback', url: representativeUrl ?? assetThumbnailUrl }`.

### 3.2 Why rule 1 is conditional

For a non-owner with **no** space context — a shared-album recipient or a partner — the fallback is
`getAssetUrls(asset).thumbnail`, i.e. the whole photo. If the setting were applied unconditionally,
switching `cropFacesFromAsset` **off** would render that same crowd shot as every person's avatar.
Such viewers stay on the crop regardless of the setting, and (per §3.3) never see the toggle
offered.

Space members _are_ affected by the setting: `AssetService.applySpacePeople`
(`server/src/services/asset.service.ts:180`) leaves `person.id` as the global person id and only
_adds_ `spacePersonId`, so `faceManager.facesByPersonId.get(person.id)` matches for them and they
get crops today; they also have a reachable representative thumbnail via the space endpoint.

### 3.3 Toggle visibility

The in-panel button renders **iff at least one visible person has a representative URL**:

```ts
const canChooseAvatarSource = $derived(
  visiblePeople.some((p) => getRepresentativeThumbnailUrl(p, { isOwner, spaceId }) !== undefined),
);
```

A control that cannot change anything is worse than no control. This also keeps the button out of
the shared-album case entirely.

The button must sit **outside** the existing `{#if isOwner}` block, because space viewers need it
and are not owners. Note the interaction with an existing test (§5.4).

### 3.4 Component refactor

`DetailPanelPeople.svelte` currently repeats an identical eleven-prop `<ImageThumbnail>` three
times. Collapse to a single Svelte snippet taking `(url, person, isHighlighted)`, and drive it from
`resolvePersonAvatar`. This is a targeted cleanup in code the feature already rewrites — no
unrelated refactoring.

### 3.5 Store

```ts
// web/src/lib/stores/preferences.store.ts
export const cropFacesFromAsset = persisted<boolean>('crop-faces-from-asset', true, {});
```

### 3.6 Strings

Four keys, inserted **alphabetically** into `i18n/en.json` (only `en.json` needs new keys; other
locales come from translation).

| Key                                 | English                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `crop_faces_from_photo`             | Crop faces from the photo                                                                                        |
| `crop_faces_from_photo_description` | Show each person's avatar cropped from the photo you are viewing. When off, their profile face is shown instead. |
| `show_faces_from_photo`             | Show faces from this photo                                                                                       |
| `show_profile_faces`                | Show profile faces                                                                                               |

The in-panel button uses a **state-dependent icon and aria-label** describing the action it
performs (unlike the neighbouring hidden-people button, which has a fixed label):

| Current mode          | Icon                   | `aria-label`            |
| --------------------- | ---------------------- | ----------------------- |
| Cropping from asset   | `mdiAccountBoxOutline` | `show_profile_faces`    |
| Showing profile faces | `mdiCropFree`          | `show_faces_from_photo` |

Both icon names are verified present in `@mdi/js`.

### 3.7 Settings placement

`web/src/routes/(user)/user-settings/AppSettings.svelte`, as a `<Field label description>` +
`<Switch>` following the `showDeleteModal` / `playVideoThumbnailOnHover` entries in that file.

## 4. Behaviour truth table

`R` = representative URL exists. `F` = person has a face row in this asset. `C` = setting
`cropFacesFromAsset`.

| Viewer                           | R   | F   | C     | Result                                | Toggle shown |
| -------------------------------- | --- | --- | ----- | ------------------------------------- | ------------ |
| Owner, no space                  | yes | yes | true  | crop, fallback `/people/…`            | yes          |
| Owner, no space                  | yes | yes | false | `/people/…`, no crop computed         | yes          |
| Owner, no space                  | yes | no  | true  | `/people/…`                           | yes          |
| Owner, no space                  | yes | no  | false | `/people/…`                           | yes          |
| **Owner, inside a space**        | yes | any | any   | `/people/…` — **never** the space arm | yes          |
| Space member (non-owner)         | yes | yes | true  | crop, fallback `/shared-spaces/…`     | yes          |
| Space member (non-owner)         | yes | yes | false | `/shared-spaces/…`                    | yes          |
| Space member (non-owner)         | yes | no  | any   | `/shared-spaces/…`                    | yes          |
| Space member, no `spacePersonId` | no  | yes | any   | crop, fallback asset thumbnail        | no           |
| Album / partner viewer, no space | no  | yes | true  | crop, fallback asset thumbnail        | no           |
| Album / partner viewer, no space | no  | yes | false | crop, fallback asset thumbnail        | no           |
| Album / partner viewer, no space | no  | no  | any   | asset thumbnail                       | no           |
| Shared link                      | —   | —   | —     | section not rendered at all           | no           |

Two rows above are counter-intuitive and each needs its own test:

- **Owner inside a space** takes the owner arm, not the space arm. `people` comes from
  `faceManager.people` (the ternary at `DetailPanelPeople.svelte:28` only switches source for
  `isSpaceMember && !isOwner`), and `mapPerson` (`server/src/dtos/person.dto.ts:304-317`) does not
  emit `spacePersonId` at all — so the space arm's guard can never be satisfied on that source, even
  with a `spaceId` prop present.
- **Space member whose person carries no `spacePersonId`** degrades to the album/partner row.
  `AssetService.get` filters these out server-side (`asset.service.ts:123` and `:141`), so it should
  not occur — but the client must not synthesise `/shared-spaces/…/people/undefined/thumbnail`.

**"No space" means no `effectiveSpaceId`, which is broader than "no space route".**
`DetailPanel.svelte:48` computes `effectiveSpaceId = spaceId || asset.resolvedSpaceId`, and
`AssetService.get` sets `resolvedSpaceId` whenever _any_ space contains the asset for that viewer
(`asset.service.ts:132-142`). The album/partner rows are therefore only reachable when no space
contains the asset. A test that passes `spaceId: undefined` is testing that narrow case, not
"a non-owner in general" — production would have resolved a space for most non-owners.

Additional behaviours that must hold in **both** modes:

- Hidden people stay filtered by `assetViewerManager.isShowingHiddenPeople`.
- Hover/focus face highlighting (`setHighlightedFaces` / `clearHighlightedFaces`) is unaffected.
- Person links (`getPersonHref`) are unaffected.
- Age / birth-date rendering is unaffected.
- Flipping the setting while the panel is open re-renders live.

## 5. Testing method

Every slice is **TDD**: write the failing test first, run it, confirm it fails **for the stated
reason**, write the minimum code to pass, re-run to green, then refactor. A test that passes on its
first run is a red flag — the test is wrong, not the code.

**Pin-test exception protocol.** Slice 1 is entirely pin tests (they assert today's behaviour, so
they pass first-run by construction). Each one must be proven capable of going red: mutate the
behaviour it pins, watch it fail, revert. A pin that cannot go red pins nothing. This applies to
every test marked **pin** below.

User-visible behaviour is expressed as **BDD scenarios** (Given/When/Then) and implemented at the
highest layer that can observe it.

### 5.1 Layers

| Layer         | File                                                            | Proves                                                                                                                                           |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit (pure)   | `web/src/lib/utils/person-avatar.spec.ts` (new)                 | The whole §4 truth table, URL shape, `updatedAt` cache-busting                                                                                   |
| Component BDD | `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts` | Rendered `img src`, that the crop is _not_ computed, toggle gating                                                                               |
| Settings      | `web/src/routes/(user)/user-settings/AppSettings.spec.ts` (new) | Switch reflects and writes the store                                                                                                             |
| E2E           | `e2e/src/ui/specs/asset-viewer/people-avatar.e2e-spec.ts` (new) | Real browser: flipping the mode changes the avatar `src` and persists across a reload. **Requires a new `GET /api/faces` mock first — see §5.3** |

### 5.2 Test traps (verified against the current tree — do not rediscover these the hard way)

1. **`assetFactory` randomises `type`.** `web/src/test-data/factories/asset-factory.ts` builds
   `type: Sync.each(() => faker.helpers.enumValue(AssetTypeEnum))`. `zoomImageToBase64` branches on
   `assetType`, so any test touching the crop path **must** pass `type: AssetTypeEnum.Image`
   explicitly. Leaving it random is a latent flake, not a style nit.
2. **The existing `beforeEach` makes the crop always fail.** `DetailPanelPeople.spec.ts` sets
   `zoomImageToBase64Mock.mockResolvedValue(undefined)`. Any test that means to exercise the crop
   must override it with a real `data:image/png;base64,…` string, or it silently asserts the
   fallback and proves nothing.
3. **Assert avatars via `container.querySelector('img')?.getAttribute('src')`**, the idiom already
   used in this spec. `getByRole('img')` does not match images with an empty `alt`, so a
   role-based assertion here can pass no matter what the component renders.
4. **`ImageThumbnail` renders `<BrokenAsset>` instead of `<img>` when the image errors.** E2E must
   therefore mock the thumbnail endpoints (§5.3) rather than rely on a real generated thumbnail.
5. **`utils.createFace` in `e2e/src/utils.ts` inserts no bounding box**, so a DB-backed e2e face has
   an all-zero box and `zoomImageToBase64` returns `null` (`faceWidth <= 0`). A DB-backed e2e can
   never show the crop — hence §5.3.
6. **`DetailPanelPeople.spec.ts` never renders real people from the server** — it mocks
   `faceManager`. These tests prove the component's logic, not the server contract.
7. **The file's existing `#796` NOTE is now factually wrong — correct it, do not preserve it.** It
   claims `mapFaces()` nulls `person` unless `person.ownerId === auth.user.id`, and that
   `AssetService.get` hard-sets `people = []` for a non-owner with no space. Neither holds since
   #818 landed the server half: `mapFaces` (`server/src/dtos/person.dto.ts:350-361`) does
   `void auth` and maps the person unconditionally, and `AssetService.get`
   (`server/src/services/asset.service.ts:147`) merely filters hidden people. The sibling test
   _"renders nothing for a non-owner given the empty list the server actually serves today"_ is
   likewise describing a server that no longer exists — it still passes (it mocks an empty list) but
   its name and comment are misleading. **Slice 1 rewrites that comment block and renames that test**
   to say what it actually proves: the component renders nothing when handed an empty list.
8. **`pnpm test -- --run <path>` silently drops the path filter.** Measured on this tree: the `--`
   form ran 294 files / 3987 tests in 72 s; `pnpm test --run <path>` ran 1 file / 13 tests in 4 s.
   Use the second form. Note `CLAUDE.md` documents the first — that instruction is wrong.

### 5.3 E2E flavour and its prerequisite

The e2e goes in `e2e/src/ui/specs/asset-viewer/` (Playwright, **fully mocked network**), following
`face-editor.e2e-spec.ts`. It does **not** go in
`e2e/src/specs/web/asset-viewer/detail-panel.e2e-spec.ts` (DB-backed), because of trap 5.

**The mock this needs does not exist yet.** `face-editor-network.ts:102` intercepts
`**/api/faces` for **`POST` only** (`if (request.method() !== 'POST') return route.fallback()`),
and nothing in `e2e/src/ui/mock-network/` intercepts the `GET /api/faces?id=…` that
`faceManager.getAssetFaces` actually calls — `base-network.ts` has no catch-all either. Left as-is,
the People section renders empty and the spec proves nothing. Slice 7 must therefore add a
`GET **/api/faces*` mock returning `AssetFaceResponseDto[]` with a non-null `person` and a
**non-zero** bounding box. `**/api/people/*/thumbnail` is already mocked in `face-editor-network.ts`
and can be reused, as can `randomThumbnail` from `e2e/src/ui/generators/timeline/images.ts`.

**Running the `ui` project locally without touching the shared Docker stack.** The `ui` project's
`webServer` points at the machine-wide `immich-e2e` compose stack on `:2285`, which other sessions
may be using and which serves a _stale_ web bundle — useless for verifying new UI. Because the
`ui` suite mocks every `/api/*` route, it only needs the web app served. Build and preview locally
instead:

```bash
cd web && pnpm build && pnpm preview --port 4173 --host 127.0.0.1   # leave running
cd e2e && PLAYWRIGHT_DISABLE_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 \
  pnpm exec playwright test --project=ui
```

Two prerequisites: `git submodule update --init e2e/test-assets` (empty in a fresh worktree —
`e2e/src/utils.ts` throws at import without it, which surfaces as a confusing "No tests found"),
and a **rebuild + preview restart** after any web change, or Playwright silently tests the old
bundle. Verified: 100 `ui` tests pass this way.

**Do not make the e2e depend on a successful crop.** Producing one requires the on-screen `<img>`
to decode and survive `canvas.toDataURL()` in the mocked environment; that is an unproven
prerequisite and not worth blocking on. Assert instead that the avatar `src` is **not** the person
thumbnail before the flip, **is** `/api/people/…/thumbnail` after it, and survives a reload. That
holds whether or not the crop renders.

### 5.4 Known interaction with an existing test

`DetailPanelPeople.spec.ts` asserts `expect(screen.queryAllByRole('button')).toHaveLength(0)` for a
non-owner. That scenario has no space context, so the new toggle is correctly hidden and the test
stays green. **Leave the assertion as-is** — it is now a load-bearing regression guard for §3.3.
If it goes red during slice 6, the visibility rule is wrong; do not relax the test.

## 6. Slices

Each slice ends with: its own tests green, the previously-green suite still green, a commit, and a
push. Slices 1–2 are behaviour-preserving and safe to ship alone.

### Slice 1 — Pin today's avatar behaviour

_No production change._ Extend `DetailPanelPeople.spec.ts`.

- **1.1** (pin) Given the owner and a person with a face in this image asset, when the crop
  resolves, then the avatar `src` is the returned `data:` URL. _(Override trap 2; pin trap 1.)_
- **1.2** (pin) Given the owner and a person with a face, when the crop resolves to `null`, then the
  avatar `src` contains `/people/`.
- **1.3** (pin) Given the owner and a person with **no** face in this asset, then the avatar `src`
  contains `/people/` and `zoomImageToBase64` was never called.
- **1.4** (pin) Given a space member who is not the owner, and a person carrying `spacePersonId`
  with a face, when the crop resolves to `null`, then the avatar `src` contains
  `/shared-spaces/space-1/people/`.
- **1.5** (pin) Given a non-owner with no space context and a person with a face, when the crop
  resolves to `null`, then the avatar `src` contains neither `/people/` nor `/shared-spaces/`
  (it is the asset thumbnail).
- **1.6** (pin) Given the **owner** viewing their own asset **with a `spaceId` prop set** and a
  person carrying no `spacePersonId`, then the avatar `src` contains `/people/` — the space arm does
  not fire. _(§4, first counter-intuitive row.)_
- **1.7** (pin) Given a space member and a person **without** `spacePersonId`, then the avatar `src`
  contains neither `/shared-spaces/` nor the string `undefined`. _(§4, second counter-intuitive
  row — guards against synthesising `/shared-spaces/…/people/undefined/thumbnail`.)_
- **1.8** (pin) Given a person whose `name` is the empty string (an untagged face — the common
  case), the avatar still renders. Assert via `container.querySelector('img')`, never
  `getByRole('img')` or `getByText` (trap 3).
- **1.9** Correct the stale `#796` NOTE comment block and rename the misleading
  _"…the empty list the server actually serves today"_ test per trap 7. _(Comment/name change only;
  no assertion changes.)_

**Done when:** 1.1–1.8 pass and each has been individually mutation-verified to go red; 1.9 leaves
the suite green.

### Slice 2 — Extract the pure resolver

- **2.1** New `web/src/lib/utils/person-avatar.ts` with `getRepresentativeThumbnailUrl` and
  `resolvePersonAvatar` (§3.1).
- **2.2** New `web/src/lib/utils/person-avatar.spec.ts` covering every row of §4 plus:
  space arm wins over owner arm when both apply; `updatedAt` appears as a query param on both arms;
  `undefined` `updatedAt` omits the param.
- **2.3** Rewire `DetailPanelPeople.svelte` to call both functions. Behaviour identical —
  `cropFacesFromAsset` is not read yet; pass the literal `true`.
- **2.4** Collapse the three duplicated `<ImageThumbnail>` blocks into one snippet (§3.4).

**Done when:** slice 1's pins are still green **unmodified**, and 2.2 is green.

### Slice 3 — The preference store

- **3.1** Add `cropFacesFromAsset` to `preferences.store.ts` (§3.5).
- **3.2** Spec: default is `true` with empty localStorage; a written value round-trips; a
  non-boolean localStorage value degrades to the default rather than throwing.

_Not consumed by any component yet._

### Slice 4 — Honour the setting in the panel

- **4.1** Given the owner, a person with a face, and the setting **off**, then the avatar `src`
  contains `/people/` **and** `zoomImageToBase64` was never called. _(The "never called" half is the
  point: representative mode must skip the canvas work entirely, per §7.)_
- **4.2** Given the owner and the setting **on** (default), then behaviour is identical to slice 1.1.
- **4.3** Given a space member with `spacePersonId` and the setting **off**, then the avatar `src`
  contains `/shared-spaces/…`.
- **4.4** Given a **non-owner with no space** and the setting **off**, then `zoomImageToBase64` is
  still called and, once it resolves, the avatar `src` is its `data:` URL — the setting does not
  demote this viewer to the asset thumbnail. _(§3.2 — the regression guard.)_
- **4.5** Given a rendered panel, when the store value is flipped **on the same component instance**
  (no re-render, no remount), then the avatar `src` updates. Assert by grabbing the container once,
  calling `cropFacesFromAsset.set(false)`, awaiting a tick, and re-reading `src` from that same
  container.
- **4.6** Given a **video** asset with the setting **off**, then `zoomImageToBase64` is not called
  (no media fetch for a crop nobody will see). Pass `type: AssetTypeEnum.Video` explicitly (trap 1).
- **4.7** Given the **owner inside a space** (§4 row 5) and the setting **off**, then the avatar
  `src` contains `/people/`, not `/shared-spaces/`.
- **4.8** Hidden-people filtering, highlight-on-hover, person links and age rendering are unchanged
  with the setting off. _(One test per behaviour; these guard the snippet refactor.)_
- **4.9** Given the setting **off** and the same person present on two consecutive assets, when the
  panel switches asset, then the avatar `src` still resolves from the new asset's props. _(The
  `{#await}` sits inside an `{#each}` keyed on `person.id`, so a person shared between two assets
  keeps its DOM node across the switch; this guards the snippet refactor in 2.4 against pinning a
  stale avatar.)_

Implementation: pass `$cropFacesFromAsset` into `resolvePersonAvatar`.

### Slice 5 — Settings switch

- **5.1** Add the four i18n keys to `i18n/en.json` (§3.6). Placement is automatic — the root
  `.prettierrc` runs `prettier-plugin-sort-json` with `jsonRecursiveSort: true`, and `en.json` is
  currently fully sorted (verified), so prettier will order them. Do not hand-place and do not
  reorder anything else.
- **5.2** Add the `<Field>` + `<Switch>` to `AppSettings.svelte` (§3.7).
- **5.3** New `AppSettings.spec.ts` (mirroring `FeatureSettings.spec.ts`): the switch is checked
  when the store is `true`; toggling it writes `false` to the store; it reflects an
  already-`false` store on mount.

**Risk on 5.3, and the fallback.** `AppSettings.svelte` is heavier to mount than `FeatureSettings`:
it pulls `themeManager` from `@immich/ui`, starts a `setInterval` in `onMount`, and renders
`SettingsLanguageSelector` + `SettingCombobox`. `FeatureSettings.spec.ts` already needed four module
mocks to become mountable. Budget for mocking `@immich/ui`'s `themeManager` and using fake timers
for the interval. **If mounting proves impractical, do not sink the slice into it** — drop 5.3, note
it in the PR, and rely on slice 6's component tests (same store, real assertions) plus slice 7.1's
e2e, which drives the real settings page in a browser. The switch is three lines of markup over an
already-tested store; an unmountable harness is not worth a day.

### Slice 6 — In-panel toggle button

- **6.1** Given the owner with people, then a toggle button with aria-label "Show profile faces" is
  present; clicking it sets the store to `false` and the label becomes "Show faces from this photo".
- **6.2** Given a space member who is not the owner, then the toggle is present. _(Proves it is
  outside the `isOwner` gate.)_
- **6.3** Given a non-owner with no space context, then the toggle is absent — and the existing
  `queryAllByRole('button')).toHaveLength(0)` assertion still passes untouched (§5.4).
- **6.4** Given an owner whose asset has no people at all, then the toggle is absent (nothing to
  apply it to) while the add-face affordance remains.
- **6.5** The button's icon changes with the mode (§3.6).

Implementation: button in the section header, **outside** `{#if isOwner}`, gated on
`canChooseAvatarSource` (§3.3).

### Slice 7 — E2E and the final gate

- **7.1a** New mock module (or an addition to `face-editor-network.ts`) intercepting
  `GET **/api/faces*` and returning one `AssetFaceResponseDto` per mock person, each with a non-null
  `person` and a non-zero bounding box (§5.3). Without this the People section is empty and 7.1b
  proves nothing — verify the section renders people **before** writing the assertions.
- **7.1b** New `e2e/src/ui/specs/asset-viewer/people-avatar.e2e-spec.ts`: open a photo, open the
  Info panel, assert the avatar `src` is **not** `/api/people/…/thumbnail`; click the in-panel
  toggle; assert it now matches `/api/people/…/thumbnail`; reload and assert the choice persisted.
  Deliberately does not assert a `data:` URL — see §5.3.
- **7.2** Full web gate from `web/`: `pnpm check:typescript`, `pnpm check:svelte`, `pnpm lint`,
  `pnpm test`.
- **7.3** `cd docs && pnpm format` — the spec and any plan files must be prettier-clean; this is the
  one gate the local web checks never touch.
- **7.4** Confirm no other locale file was edited and no key was orphaned (`i18n/` is shared by web
  and mobile — grep both before touching an existing key).

## 7. Secondary benefit worth stating in the PR

`zoomImageToBase64` decodes the full-size image and runs a canvas crop **per person per asset**. On
a group photo with eight tagged people that is eight decodes every time the Info panel opens.
Representative mode is a plain `<img src>` against the thumbnail endpoint, so users who flip the
setting also get a faster panel. This is why slice 4.1 and 4.6 assert the crop is _not attempted_
rather than merely _not displayed_.

## 8. Global invariants

- **No server changes.** If a slice appears to need one, stop — the design is wrong.
- **Never request `/people/{id}/thumbnail` for a viewer who is neither the owner nor a member of a
  space containing that person** (#796). Enforced by `getRepresentativeThumbnailUrl` returning
  `undefined`, and pinned by the existing "never requests the owner-only person thumbnail for a
  non-owner" test. That test's _name_ is a simplification (see the RBAC note in §3.1) but its
  assertion is correct for the scenario it sets up — leave it alone.
- **`i18n/` is shared by web and mobile.** New keys go in `en.json` only; grep both apps before
  editing or deleting an existing key.
- **`pnpm test -- --run <path>` drops the path filter** (trap 8) — run web unit tests as
  `pnpm test --run <path>`.
- `web/pnpm check:svelte` has been observed scanning zero files locally; treat CI as the
  authority for that gate.
- **`web`'s `pnpm lint` is `eslint . --concurrency 6` — there is no `--max-warnings`.** Only
  **errors** fail it, so judge the gate by **exit code**, never by warning count. On the rebased
  base there are 8 pre-existing warnings in unrelated files; do not chase them. (CLAUDE.md's
  blanket "zero warnings policy" does not describe this package.)
  **But errors are real and they are usually yours.** The post-cutover config enables
  `unicorn/consistent-conditional-object-spread`, which turns `...(cond ? { a } : {})` into an
  error — write `...(cond && { a })`. When lint exits non-zero, check whether the cited file is
  one this feature introduced before concluding it is pre-existing; `npx eslint --fix <file>`
  applies the rule's own autofix.
- **Branch base:** this branch is rebased onto `origin/main` (`a7390f7c057`, the v3.1.0 cutover).
  All open PRs target `main`; the older "target the rolling branch" guidance is stale as of the
  2026-07-30 cutover.
- **Baseline measured 2026-07-30 on the rebased base:** `web` is green at 294 files / 4009 tests /
  2 skipped / 8 todo, with slice 1's 8 pins included. Any red after a slice is that slice's doing.
- **IDE `Cannot find name 'vi' / 'describe' / 'expect'` diagnostics in spec files are language-server
  noise**, not a gate. `pnpm check:typescript` is clean; judge by that.

## 9. Out of scope

- **Mobile.** `mobile/lib/presentation/widgets/asset_viewer/asset_details/people_details.widget.dart`
  already renders the representative thumbnail via `getPersonThumbnailUrl`, i.e. the behaviour this
  setting restores. No Dart change, no sync of the preference.
- **Other web people surfaces** — People page, people pickers, face editor, search rows. All are
  representative-face already and mutually consistent; the split only ever existed in the Info panel.
- **Server-side `UserPreferences`.** Explicitly rejected as D1. If cross-device sync is wanted
  later, `cropFacesFromAsset` is a single call site and can be re-pointed at a server preference
  without touching the resolver or its tests.
