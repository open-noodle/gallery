# Face Recognition Suggestions Phase 5c Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the existing face-suggestion banner and review modal on shared-space person detail pages, using the Phase 5b shared-space API and browser E2E coverage for the shared-space UI paths.

**Architecture:** Reuse `PersonSuggestionBanner.svelte`, `PersonSuggestionReviewModal.svelte`, `FaceCrop.svelte`, `face-suggestion-snooze.ts`, and `getFaceCropTransform` without creating new shared-space UI components. The shared-space person page owns only the data adapter: load a 5-item summary from `getSpacePersonFaceSuggestions`, pass the existing space-person thumbnail URL as the reference thumbnail, and wire modal actions to `confirmSpacePersonFaceSuggestion` and `dismissSpacePersonFaceSuggestion`. Viewer and stale-candidate behavior stays server-driven: the web client calls the shared-space API and hides the banner when the API returns `total: 0`.

**Tech Stack:** Svelte 5 runes, Svelte Testing Library, Vitest, generated `@immich/sdk` TypeScript client, existing Gallery modal manager, Playwright web E2E, Postgres fixture seeding through `e2e/src/utils.ts`.

**Design Reference:** `docs/plans/2026-05-16-face-recognition-suggestions-phase-5-design.md`.

**Phase 5c Scope:** Web UI reuse and browser coverage only. Do not change the Phase 5a scan/repository code or Phase 5b API/RBAC/identity graph code. Do not create a new banner, modal, crop component, snooze store, or request-time vector matching path.

**Conventions for every task:** strict TDD for new behavior. Write the failing web or E2E test first, run it, verify the expected failure, implement the minimal code, rerun green, then commit. Run all commands from `/home/pierre/dev/gallery/.worktrees/face-recognition-suggestions`.

- Web unit test: `cd web && pnpm test --run <file>`
- Web type/Svelte check: `make check-web`
- Browser E2E: `cd e2e && pnpm exec playwright test --project=web <file>`

**Strict TDD execution order:** Write and run Task 1 Steps 1-2 first, then write and run Task 4 Steps 1-2 while the shared-space page still has no banner, then implement Task 2, run Task 1 and Task 4 green, add Task 3's regression guard, and finish with Task 5. Do not commit red tests; commit tests together with the code that turns them green.

---

## File Structure

- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Add the shared-space face-suggestion summary loader, modal action wiring, space-person thumbnail reference URL, and banner mount.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`
  - Add Svelte component tests for banner visibility, viewer read-gate behavior, modal wiring, refresh after confirm, and snooze keyed by the space person id.
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
  - Strengthen the existing personal-page guard that suppresses the personal banner for space-scoped person refs.
- Create: `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`
  - Add Playwright coverage for the shared-space browser golden path, viewer-denied/no-banner path, stale unshared candidate, unnamed space person, and disabled-space no-banner paths.

---

### Task 1: Add shared-space person page unit tests

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`

- [ ] **Step 1: Write failing page tests for shared-space face suggestions**

Update the SDK type imports near the top of `space-person-detail-page.spec.ts`:

```ts
import {
  RepresentativeFaceSource,
  SharedSpaceRole,
  type PersonFaceSuggestionResponseDto,
  type PersonFaceSuggestionPageResponseDto,
  type PersonStatisticsResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpacePersonResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
```

Add this helper after `makePerson`:

```ts
function makeSuggestion(overrides: Partial<PersonFaceSuggestionResponseDto> = {}): PersonFaceSuggestionResponseDto {
  return {
    assetFaceId: 'face-1',
    assetId: 'asset-1',
    distance: 0.62,
    imageWidth: 100,
    imageHeight: 100,
    boundingBoxX1: 10,
    boundingBoxX2: 40,
    boundingBoxY1: 10,
    boundingBoxY2: 40,
    ...overrides,
  };
}
```

Append this describe block before the final `});` of the top-level `describe('Spaces person detail page', ...)`:

```ts
describe('face suggestions', () => {
  beforeEach(() => {
    localStorage.clear();
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
    sdkMock.confirmSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
    sdkMock.dismissSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
  });

  it('renders the reused banner for editors and uses the space-person thumbnail URL', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
      total: 2,
      items: [makeSuggestion()],
    });

    renderPage();

    await screen.findByTestId('person-suggestion-banner');
    expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      page: 1,
      size: 5,
    });
    const src = screen.getByTestId('suggestion-banner-reference').getAttribute('src') ?? '';
    expect(src).toContain('/shared-spaces/space-1/people/person-1/thumbnail');
    expect(src).not.toContain('/people/person-1/thumbnail');
  });

  it('relies on the server read-gate for viewers and hides when the API returns zero', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });

    renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

    await waitFor(() => {
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        page: 1,
        size: 5,
      });
    });
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-review-btn')).not.toBeInTheDocument();
  });

  it('hides the banner if the shared-space suggestion summary request fails', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockRejectedValue(new Error('not a member'));

    renderPage();

    await waitFor(() => {
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        page: 1,
        size: 5,
      });
    });
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  it('opens the review modal with shared-space SDK actions and refreshes after a confirm', async () => {
    const firstSuggestion = makeSuggestion({ assetFaceId: 'face-1' });
    let closeModal!: (value: { confirmed: number }) => void;
    sdkMock.getSpacePersonFaceSuggestions
      .mockResolvedValueOnce({ total: 1, items: [firstSuggestion] })
      .mockResolvedValueOnce({ total: 1, items: [firstSuggestion] })
      .mockResolvedValueOnce({ total: 0, items: [] });
    vi.mocked(modalManager.show).mockReturnValue(
      new Promise((resolve) => {
        closeModal = resolve;
      }) as never,
    );

    renderPage();

    await userEvent.click(await screen.findByTestId('suggestion-review-btn'));

    const modalProps = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
      referenceThumbnailUrl: string;
      loadPage: (request: { page: number; size: number }) => Promise<PersonFaceSuggestionPageResponseDto>;
      confirm: (assetFaceId: string) => Promise<void>;
      dismiss: (assetFaceId: string) => Promise<void>;
    };

    expect(modalProps.referenceThumbnailUrl).toContain('/shared-spaces/space-1/people/person-1/thumbnail');

    await modalProps.loadPage({ page: 2, size: 50 });
    expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
      id: 'space-1',
      personId: 'person-1',
      page: 2,
      size: 50,
    });

    await modalProps.confirm('face-1');
    expect(sdkMock.confirmSpacePersonFaceSuggestion).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      assetFaceId: 'face-1',
    });

    await modalProps.dismiss('face-2');
    expect(sdkMock.dismissSpacePersonFaceSuggestion).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      assetFaceId: 'face-2',
    });

    closeModal({ confirmed: 1 });

    await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
        id: 'space-1',
        personId: 'person-1',
        page: 1,
        size: 5,
      });
    });
  });

  it('keys Not now snooze by the space person id', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
      total: 2,
      items: [makeSuggestion()],
    });

    const firstRender = renderPage({ person: makePerson({ id: 'person-1', name: 'Alice' }) });
    await screen.findByTestId('person-suggestion-banner');
    await userEvent.click(screen.getByTestId('suggestion-snooze-btn'));
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
    firstRender.unmount();

    renderPage({ person: makePerson({ id: 'person-2', name: 'Alice in another space cluster' }) });

    await screen.findByTestId('person-suggestion-banner');
  });

  it('reloads suggestions when navigating to another space person in the same route component', async () => {
    sdkMock.getSpacePersonFaceSuggestions
      .mockResolvedValueOnce({ total: 2, items: [makeSuggestion({ assetFaceId: 'face-1' })] })
      .mockResolvedValueOnce({ total: 0, items: [] });
    const firstPerson = makePerson({ id: 'person-1', name: 'Alice' });
    const secondPerson = makePerson({
      id: 'person-2',
      name: 'Bob',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });

    const view = renderPage({ person: firstPerson });

    await screen.findByTestId('person-suggestion-banner');

    await view.rerender({
      component: SpacePersonDetailPage,
      componentProps: {
        data: {
          space: makeSpace(),
          members: [makeMember()],
          person: secondPerson,
          statistics: { assets: secondPerson.assetCount, faces: secondPerson.faceCount },
          action: null,
          previousRoute: null,
          meta: { title: 'Bob - Test Space' },
        },
      },
    });

    await waitFor(() => {
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
        id: 'space-1',
        personId: 'person-2',
        page: 1,
        size: 5,
      });
    });
    await waitFor(() => expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd web && pnpm test --run 'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts'
```

Expected: FAIL because `getSpacePersonFaceSuggestions` is not called from the shared-space person page and the banner is not mounted.

- [ ] **Step 3: Keep the red tests uncommitted and proceed to implementation**

Run:

```bash
git status --short
```

Expected: the shared-space page spec is modified and uncommitted. Proceed to Task 2; the Task 2 commit includes these tests and the implementation that makes them pass.

### Task 2: Wire the shared-space page to the existing banner and modal

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`

- [ ] **Step 1: Add imports**

Update the imports in `+page.svelte`:

```svelte
<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { clickOutside } from '$lib/actions/click-outside';
  import { listNavigation } from '$lib/actions/list-navigation';
  import ImageThumbnail from '$lib/components/assets/thumbnail/image-thumbnail.svelte';
  import PersonSuggestionBanner from '$lib/components/faces-page/person-suggestion-banner.svelte';
  import PeopleMergeSelector from '$lib/components/people/people-merge-selector.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/button-context-menu.svelte';
  import ControlAppBar from '$lib/components/shared-components/control-app-bar.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RemoveFromSpaceAction from '$lib/components/timeline/actions/RemoveFromSpaceAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { timeBeforeShowLoadingSpinner } from '$lib/constants';
  import PersonEditBirthDateModal from '$lib/modals/PersonEditBirthDateModal.svelte';
  import PersonSuggestionReviewModal from '$lib/modals/PersonSuggestionReviewModal.svelte';
  import RepresentativeFacePickerModal from '$lib/modals/RepresentativeFacePickerModal.svelte';
```

Update the SDK import list:

```ts
import {
  confirmSpacePersonFaceSuggestion,
  detachScopedPerson,
  dismissSpacePersonFaceSuggestion,
  getSpacePersonFaces,
  getSpacePersonFaceSuggestions,
  getSpacePeople,
  mergeSpacePeople,
  mergeScopedPeople,
  RepresentativeFaceSource,
  searchPerson,
  SharedSpaceRole,
  Type2 as ScopedPersonProfileType,
  updateSpacePersonRepresentativeFace,
  updateSpacePerson,
  type PersonFaceResponseDto,
  type PersonFaceSuggestionResponseDto,
  type PersonResponseDto,
  type PersonStatisticsResponseDto,
  type ScopedPersonProfileRefDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpacePersonResponseDto,
} from '@immich/sdk';
```

Keep the existing Svelte import unchanged:

```ts
import { tick } from 'svelte';
```

- [ ] **Step 2: Add shared-space suggestion state and actions**

Replace the current `thumbnailUrl` declaration:

```ts
const thumbnailUrl = $derived(
  createUrl(`/shared-spaces/${space.id}/people/${person.id}/thumbnail`, { updatedAt: person.updatedAt }),
);
```

with this block:

```ts
let thumbnailRefresh = $state<string | null>(null);
const thumbnailUrl = $derived(
  createUrl(`/shared-spaces/${space.id}/people/${person.id}/thumbnail`, {
    updatedAt: thumbnailRefresh ?? person.updatedAt,
  }),
);
const suggestionPerson = $derived({ id: person.id, name: person.name } as PersonResponseDto);
let suggestionTotal = $state(0);
let suggestionPreviews = $state<PersonFaceSuggestionResponseDto[]>([]);
```

Add these functions after `openRepresentativeFacePicker`:

```ts
async function loadSuggestionSummary(spaceId = space.id, personId = person.id) {
  try {
    const response = await getSpacePersonFaceSuggestions({ id: spaceId, personId, page: 1, size: 5 });
    if (spaceId !== space.id || personId !== person.id) {
      return;
    }
    suggestionTotal = response.total;
    suggestionPreviews = response.items;
  } catch {
    if (spaceId !== space.id || personId !== person.id) {
      return;
    }
    suggestionTotal = 0;
    suggestionPreviews = [];
  }
}

async function openSuggestionReview() {
  const result = await modalManager.show(PersonSuggestionReviewModal, {
    person: suggestionPerson,
    referenceThumbnailUrl: thumbnailUrl,
    loadPage: ({ page, size }: { page: number; size: number }) =>
      getSpacePersonFaceSuggestions({ id: space.id, personId: person.id, page, size }),
    confirm: (assetFaceId: string) =>
      confirmSpacePersonFaceSuggestion({ id: space.id, personId: person.id, assetFaceId }),
    dismiss: (assetFaceId: string) =>
      dismissSpacePersonFaceSuggestion({ id: space.id, personId: person.id, assetFaceId }),
  });

  await loadSuggestionSummary(space.id, person.id);
  if (result && result.confirmed > 0) {
    thumbnailRefresh = Date.now().toString();
    await invalidateAll();
  }
}
```

Add this route-keyed effect before the closing `</script>`:

```ts
$effect(() => {
  const currentSpaceId = space.id;
  const currentPersonId = person.id;
  thumbnailRefresh = null;
  suggestionTotal = 0;
  suggestionPreviews = [];
  void loadSuggestionSummary(currentSpaceId, currentPersonId);
});
```

This deliberately does not check `isEditor` in the client. Viewers call the shared-space API and receive `{ total: 0, items: [] }` from the server read-gate.

- [ ] **Step 3: Mount the reused banner in the person-header region**

In the `<Timeline>` content, add the banner immediately after the existing header/editing block and before the `{#snippet empty()}` block:

```svelte
      <PersonSuggestionBanner
        person={suggestionPerson}
        total={suggestionTotal}
        previews={suggestionPreviews}
        referenceThumbnailUrl={thumbnailUrl}
        onReview={openSuggestionReview}
      />

      {#snippet empty()}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd web && pnpm test --run 'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts'
make check-web
```

Expected: PASS.

Commit:

```bash
git add 'web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte' 'web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts'
git commit -m "feat(web): mount face suggestions on space person detail"
```

### Task 3: Re-verify the personal page no-double-banner guard

**Files:**

- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`

- [ ] **Step 1: Strengthen the existing personal-page regression test**

Find the existing test named `does not query suggestions for a space-scoped person (Phase 5 scope)` and add the final assertion shown here:

```ts
it('does not query suggestions for a space-scoped person (Phase 5 scope)', async () => {
  renderPage({
    person: makePerson({
      name: 'Alice',
      primaryProfile: { type: 'space-person', id: 'sp1', spaceId: 'space-1' },
    } as never),
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(sdkMock.getPersonFaceSuggestions).not.toHaveBeenCalled();
  expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the personal guard test**

Run:

```bash
cd web && pnpm test --run 'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts'
```

Expected: PASS. This is an explicit non-regression guard for the Phase 5 design's no-double-banner requirement; the guard already exists in the personal page implementation.

- [ ] **Step 3: Commit the guard**

Commit:

```bash
git add 'web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts'
git commit -m "test(web): guard personal banner for space-scoped people"
```

### Task 4: Add shared-space face suggestion browser E2E

**Files:**

- Create: `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`

- [ ] **Step 1: Create the failing Playwright spec**

Create `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`:

```ts
import {
  SharedSpaceRole,
  updateConfig,
  updateSpace,
  type LoginResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { asBearerAuth, utils } from 'src/utils';

type FixtureOptions = {
  name: string;
  faceRecognitionEnabled?: boolean;
  candidateShared?: boolean;
  personName?: string;
};

type SpaceSuggestionFixture = {
  space: SharedSpaceResponseDto;
  spacePersonId: string;
  candidateFaceIds: string[];
};

test.describe('Space person face suggestions (web)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    owner = await utils.userSetup(admin.accessToken, createUserDto.create('space-suggestion-owner'));
    editor = await utils.userSetup(admin.accessToken, createUserDto.create('space-suggestion-editor'));
    viewer = await utils.userSetup(admin.accessToken, createUserDto.create('space-suggestion-viewer'));

    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.maxDistance = 0.5;
    config.machineLearning.facialRecognition.suggestionMaxDistance = 0.8;
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  test.afterAll(async () => {
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestionMaxDistance = 0;
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  async function createFixture(options: FixtureOptions): Promise<SpaceSuggestionFixture> {
    const db = await utils.connectDatabase();
    const space = await utils.createSpace(owner.accessToken, { name: options.name });
    await updateSpace(
      {
        id: space.id,
        sharedSpaceUpdateDto: { faceRecognitionEnabled: options.faceRecognitionEnabled ?? true },
      },
      { headers: asBearerAuth(owner.accessToken) },
    );
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: editor.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: viewer.userId,
      role: SharedSpaceRole.Viewer,
    });

    const representativeAsset = await utils.createAsset(owner.accessToken);
    const candidateAsset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [representativeAsset.id, candidateAsset.id]);

    const { spacePersonId } = await utils.createSpacePerson(
      space.id,
      options.personName ?? 'E2E Space Suggest Target',
      owner.userId,
      representativeAsset.id,
    );

    const candidateFaceIds: string[] = [];
    for (const distance of [0.55, 0.6, 0.65]) {
      const face = await db.query<{ id: string }>(`INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`, [
        candidateAsset.id,
      ]);
      const faceId = face.rows[0].id;
      candidateFaceIds.push(faceId);
      await db.query(
        `INSERT INTO person_face_suggestion ("spacePersonId", "assetFaceId", distance) VALUES ($1, $2, $3)`,
        [spacePersonId, faceId, distance],
      );
    }

    if (options.candidateShared === false) {
      await db.query(`DELETE FROM shared_space_asset WHERE "spaceId" = $1 AND "assetId" = $2`, [
        space.id,
        candidateAsset.id,
      ]);
    }

    return { space, spacePersonId, candidateFaceIds };
  }

  test('editor sees the banner, opens the review modal, and confirms a suggestion', async ({ context, page }) => {
    const fixture = await createFixture({ name: 'Space Suggestion Golden' });
    await utils.setAuthCookies(context, editor.accessToken);

    await page.goto(`/spaces/${fixture.space.id}/people/${fixture.spacePersonId}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const banner = page.locator('[data-testid="person-suggestion-banner"]');
    await expect(banner).toBeVisible();

    await page.locator('[data-testid="suggestion-review-btn"]').click();
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    await page.locator('[data-testid="suggestion-same-btn"]').click();
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    const response = await page.request.get(
      `/api/shared-spaces/${fixture.space.id}/people/${fixture.spacePersonId}/face-suggestions`,
    );
    const body = await response.json();
    expect(body.total).toBeLessThan(3);
  });

  test('viewer gets no banner because the server read-gate returns zero suggestions', async ({ context, page }) => {
    const fixture = await createFixture({ name: 'Space Suggestion Viewer' });
    await utils.setAuthCookies(context, viewer.accessToken);

    await page.goto(`/spaces/${fixture.space.id}/people/${fixture.spacePersonId}`);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
    const response = await page.request.get(
      `/api/shared-spaces/${fixture.space.id}/people/${fixture.spacePersonId}/face-suggestions`,
    );
    const body = await response.json();
    expect(body).toMatchObject({ total: 0, items: [] });
  });

  test('stale unshared candidate rows do not show a banner (edge 21)', async ({ context, page }) => {
    const fixture = await createFixture({ name: 'Space Suggestion Stale', candidateShared: false });
    await utils.setAuthCookies(context, editor.accessToken);

    await page.goto(`/spaces/${fixture.space.id}/people/${fixture.spacePersonId}`);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
    const response = await page.request.get(
      `/api/shared-spaces/${fixture.space.id}/people/${fixture.spacePersonId}/face-suggestions`,
    );
    const body = await response.json();
    expect(body).toMatchObject({ total: 0, items: [] });
  });

  test('unnamed space people and disabled spaces do not show a banner (edges 23 and 25)', async ({ context, page }) => {
    const db = await utils.connectDatabase();
    const unnamed = await createFixture({ name: 'Space Suggestion Unnamed', personName: 'Temporary Name' });
    await db.query(`UPDATE shared_space_person SET name = '   ' WHERE id = $1`, [unnamed.spacePersonId]);
    await utils.setAuthCookies(context, editor.accessToken);

    await page.goto(`/spaces/${unnamed.space.id}/people/${unnamed.spacePersonId}`);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();

    const disabled = await createFixture({
      name: 'Space Suggestion Disabled',
      faceRecognitionEnabled: false,
    });

    await page.goto(`/spaces/${disabled.space.id}/people/${disabled.spacePersonId}`);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/space-person-face-suggestions.e2e-spec.ts
```

Expected when run before Task 2 implementation: FAIL because the shared-space person page does not render the face-suggestion banner.

- [ ] **Step 3: Run E2E after Task 2 is implemented**

Run:

```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/space-person-face-suggestions.e2e-spec.ts
```

Expected after Task 2 implementation: PASS.

- [ ] **Step 4: Commit E2E coverage**

Commit:

```bash
git add e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts
git commit -m "test(e2e): cover space person face suggestions"
```

### Task 5: Final verification and edge-case audit

**Files:**

- Verify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Verify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`
- Verify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
- Verify: `e2e/src/specs/web/space-person-face-suggestions.e2e-spec.ts`

- [ ] **Step 1: Run targeted web tests**

Run:

```bash
cd web && pnpm test --run 'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts' 'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts'
make check-web
```

Expected: PASS.

- [ ] **Step 2: Run targeted browser E2E**

Run:

```bash
cd e2e && pnpm exec playwright test --project=web src/specs/web/space-person-face-suggestions.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run the Phase 5c edge-case coverage audit**

Verify this mapping before final handoff:

- Edge 20: member removed between scan and review -> Phase 5b API/service tests cover 403/no mutation; Phase 4 modal already advances on confirm/dismiss errors and is reused unchanged.
- Edge 21: asset unshared or library unlinked after scan -> `space-person-face-suggestions.e2e-spec.ts` stale unshared candidate test proves no banner and API returns `{ total: 0, items: [] }`.
- Edge 22: merge cleanup -> Phase 5a merge/resolve tests cover pending-row cleanup; 5c does not add merge logic.
- Edge 23: unnamed or whitespace-name space person -> `space-person-face-suggestions.e2e-spec.ts` whitespace-name test proves no banner.
- Edge 24: viewer GET/confirm/dismiss -> Phase 5b covers API permissions; 5c unit and E2E viewer tests prove the page relies on server `{ total: 0 }` and shows no banner/actions.
- Edge 25: `faceRecognitionEnabled = false` -> `space-person-face-suggestions.e2e-spec.ts` disabled-space test proves no banner.
- Edge 26: candidate owned by another member -> Phase 5b medium tests cover no `asset_face.personId` or owner mutation; 5c uses the same confirm endpoint.
- Edge 27: pet space person -> Phase 5a scan/read-gate tests cover no generated/readable suggestions; 5c hides on server `total: 0`.
- Edge 28: same candidate suggested elsewhere -> Phase 5b medium tests cover `resolveAssignedFace`; 5c uses the same confirm endpoint and refreshes summary after confirmed results.
- Edge 29: disabled suggestion band -> Phase 5a/5b read-gate tests cover empty results; 5c hides on server `total: 0`.
- Edge 30: zero linked faces/no embeddings -> Phase 5a scan tests cover no suggestions; 5c hides on server `total: 0`.
- Edge 31: missing space identity at confirm -> Phase 5b medium tests cover identity creation/backlink; 5c uses the same confirm endpoint.
- Edge 32: existing identity overwrite -> Phase 5b medium tests cover last-writer-wins identity replacement; 5c uses the same confirm endpoint.

- [ ] **Step 4: Inspect final diff and commit final verification notes only when files changed**

Run:

```bash
git status --short
git diff --check
git log --oneline -8
```

Expected: clean diff check, with only intentional Phase 5c files changed or committed.
