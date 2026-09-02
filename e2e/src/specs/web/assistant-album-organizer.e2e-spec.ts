import {
  AgentAlbumAddAssetsOperationType,
  AgentAlbumCreateOperationType,
  AgentAlbumSetCoverOperationType,
  AgentApprovalMode,
  AgentOperationApplyStatus,
  AgentOperationNewAlbumTargetKind,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentSessionStatus,
  AgentToolCallStatus,
  AgentToolName,
  ProviderType,
  createAgentProviderCredential,
  createAgentSession,
  getAgentSession,
  getAlbumInfo,
  getAllAlbums,
  getCurrentOperationPlan,
  getToolCalls,
  reviseProposedOperations,
  type AgentOperationPlanApplyResponseDto,
  type AgentOperationPlanResponseDto,
  type LoginResponseDto,
} from '@immich/sdk';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

const credentialLabel = 'E2E deterministic runner';
const model = 'e2e-album-organizer';

const authOptions = (accessToken: string) => ({ headers: asBearerAuth(accessToken) });

const createE2eCredential = (accessToken: string) =>
  createAgentProviderCredential(
    {
      agentProviderCredentialCreateDto: {
        providerType: ProviderType.OpenaiCompatible,
        label: credentialLabel,
        secret: 'e2e-secret',
        baseUrl: 'https://e2e-provider.invalid/v1',
        models: [model],
        defaultModel: model,
      },
    },
    authOptions(accessToken),
  );

const sendAssistantPrompt = async (page: Page, prompt: string) => {
  await page.getByRole('textbox', { name: 'Message' }).fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
};

const startAssistantSession = async (page: Page, accessToken: string, providerCredentialId: string, prompt: string) => {
  const session = await createAgentSession(
    {
      agentSessionCreateDto: {
        providerCredentialId,
        model,
        permissionPreset: AgentPermissionPreset.Careful,
        approvalMode: AgentApprovalMode.PlanOnly,
      },
    },
    authOptions(accessToken),
  );

  await page.goto(`/assistant?session=${session.id}`);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await sendAssistantPrompt(page, prompt);
  return session;
};

const createLooseAssets = async (accessToken: string) =>
  await Promise.all([
    utils.createAsset(accessToken, {
      fileCreatedAt: '2026-05-01T10:00:00.000Z',
      fileModifiedAt: '2026-05-01T10:00:00.000Z',
    }),
    utils.createAsset(accessToken, {
      fileCreatedAt: '2026-05-02T10:00:00.000Z',
      fileModifiedAt: '2026-05-02T10:00:00.000Z',
    }),
  ]);

const makeThumbnailUnavailable = async (assetId: string) => {
  const db = await utils.connectDatabase();
  await expect
    .poll(
      async () => {
        const result = await db.query(
          `SELECT 1 FROM "asset_file" WHERE "assetId" = $1 AND "type" = 'thumbnail' AND "isEdited" = false`,
          [assetId],
        );
        return result.rowCount;
      },
      { timeout: 10_000 },
    )
    .toBe(1);

  const result = await db.query(
    `UPDATE "asset_file" SET "path" = $1 WHERE "assetId" = $2 AND "type" = 'thumbnail' AND "isEdited" = false`,
    [`/test-assets/albums/missing-thumbnail-${assetId}.webp`, assetId],
  );
  expect(result.rowCount).toBe(1);
};

const startPortugalPlan = async (page: Page, accessToken: string, providerCredentialId: string) => {
  const session = await startAssistantSession(
    page,
    accessToken,
    providerCredentialId,
    'Create a Portugal trip album from my loose photos.',
  );

  await expect(page.getByText('I proposed a Portugal Trip album.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Plan review' })).toBeVisible();

  const currentPlan = await getCurrentOperationPlan({ id: session.id }, authOptions(accessToken));
  if (!currentPlan) {
    throw new Error('Expected the runner to create an operation plan');
  }

  return { session, currentPlan };
};

const getPortugalDestination = (page: Page, name = 'Portugal Trip') =>
  page.getByTestId('agent-session-chat-transcript').getByRole('region', { name });

const openAddPhotosReviewDialog = async (page: Page, destination: Locator) => {
  await destination.getByRole('button', { name: 'Review photos' }).click();
  return page.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
};

const findOperation = (plan: AgentOperationPlanResponseDto, type: AgentOperationType) => {
  const operation = plan.operations.find((operation) => operation.type === type);
  if (!operation) {
    throw new Error(`Expected plan to include ${type}`);
  }

  return operation;
};

const waitForApplyRequest = (page: Page, sessionId: string) =>
  page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().includes(`/api/agent/sessions/${sessionId}/operation-plan/`) &&
      request.url().endsWith('/apply'),
  );

const waitForApplyResponse = (page: Page, sessionId: string, status = 201) =>
  page.waitForResponse(
    (response) =>
      response.url().includes(`/api/agent/sessions/${sessionId}/operation-plan/`) &&
      response.url().endsWith('/apply') &&
      response.status() === status,
  );

const applySelectedOperations = async (page: Page, sessionId: string, label: string) => {
  const applyRequestPromise = waitForApplyRequest(page, sessionId);
  const applyResponsePromise = waitForApplyResponse(page, sessionId);
  await page.getByRole('button', { name: label }).click();

  return {
    request: await applyRequestPromise,
    response: await applyResponsePromise,
  };
};

const clonePlan = (plan: AgentOperationPlanResponseDto): AgentOperationPlanResponseDto => structuredClone(plan);

const fulfillStaleApplyResponse = async (route: Route) => {
  await route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      statusCode: 409,
      message: 'Agent operation plan revision is stale',
      error: 'Conflict',
    }),
  });
};

test.describe('Assistant album organizer', () => {
  let admin: LoginResponseDto;
  let providerCredentialId: string;

  test.beforeAll(async () => {
    utils.initSdk();
  });

  test.beforeEach(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    const credential = await createE2eCredential(admin.accessToken);
    providerCredentialId = credential.id;
  });

  test('proposes album operations, lets the user toggle one off, and applies the approved operations', async ({
    context,
    page,
  }) => {
    await createLooseAssets(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const { session, currentPlan } = await startPortugalPlan(page, admin.accessToken, providerCredentialId);

    await expect(page.getByText('Create Portugal Trip and add 2 loose assets.')).toBeVisible();
    await expect(page.getByText('1 destination')).toBeVisible();
    await expect(page.getByText('3 selected changes')).toBeVisible();

    const portugalDestination = getPortugalDestination(page);
    await expect(portugalDestination).toBeVisible();
    const thumbnailStrip = portugalDestination.getByTestId('agent-plan-thumbnail-strip');
    await expect(thumbnailStrip).toBeVisible();
    await expect(thumbnailStrip.getByTestId('agent-plan-thumbnail-image')).toHaveCount(2);
    await expect(thumbnailStrip.getByText(/\+\d+/)).toHaveCount(0);
    await expect(page.getByText('New album')).toBeVisible();
    await expect(page.getByLabel('Create album "Portugal Trip"')).toBeChecked();
    await expect(page.getByLabel('Add 2 photos')).toBeChecked();
    await expect(page.getByLabel('Set cover photo')).toBeChecked();

    await expect(page.getByText('Create Portugal Trip', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Add selected photos to Portugal Trip')).toHaveCount(0);
    await expect(page.getByText('Use first photo as Portugal Trip cover')).toHaveCount(0);

    const proposedAddOperation = findOperation(currentPlan, AgentOperationType.AlbumAddAssets);
    const proposedCreateOperation = findOperation(currentPlan, AgentOperationType.AlbumCreate);
    expect(proposedAddOperation?.id).toEqual(expect.any(String));
    expect(proposedCreateOperation.id).toEqual(expect.any(String));
    const excludedAssetId = proposedAddOperation!.assetIds[0];
    expect(excludedAssetId).toEqual(expect.any(String));

    await portugalDestination.getByLabel('Description').fill('Curated favorites from the trip.');
    await portugalDestination.getByLabel('Album name').fill('Portugal Favorites');
    const renamedPortugalDestination = getPortugalDestination(page, 'Portugal Favorites');
    await expect(renamedPortugalDestination.getByText('Create album "Portugal Favorites"')).toBeVisible();

    await expect(page.getByText(proposedAddOperation!.id)).toHaveCount(0);
    await renamedPortugalDestination.getByRole('button', { name: 'Show technical details' }).nth(1).click();
    await expect(page.getByText(proposedAddOperation!.id)).toBeVisible();

    const photoReviewDialog = await openAddPhotosReviewDialog(page, renamedPortugalDestination);
    await photoReviewDialog.getByRole('checkbox', { name: 'Include photo 1' }).uncheck();
    await photoReviewDialog.getByRole('button', { name: 'Done reviewing' }).click();
    await expect(renamedPortugalDestination.getByText('1 of 2 photos selected')).toHaveCount(1);
    await page.getByLabel('Set cover photo').uncheck();
    await expect(page.getByRole('button', { name: 'Apply 2 selected' })).toBeEnabled();

    const { request: applyRequest, response: applyResponse } = await applySelectedOperations(
      page,
      session.id,
      'Apply 2 selected',
    );
    expect(applyRequest.postDataJSON()).toMatchObject({
      operationIds: expect.arrayContaining([proposedAddOperation!.id]),
      itemSelections: {
        [proposedAddOperation!.id]: {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [excludedAssetId],
        },
      },
      fieldOverrides: {
        [proposedCreateOperation.id]: {
          albumName: 'Portugal Favorites',
          description: 'Curated favorites from the trip.',
        },
      },
      planRevision: currentPlan.revision,
    });
    const { plan: appliedPlan } = (await applyResponse.json()) as AgentOperationPlanApplyResponseDto;

    await expect(page.getByText('2 applied · 1 skipped · 0 failed.')).toBeVisible();
    await expect(page.getByText('Applied', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Skipped', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('0 failed').first()).toBeVisible();
    expect(appliedPlan.status).toBe(AgentOperationPlanStatus.Applied);
    await expect
      .poll(
        async () => {
          const updatedSession = await getAgentSession({ id: session.id }, authOptions(admin.accessToken));
          return updatedSession.status;
        },
        {
          timeout: 10_000,
        },
      )
      .toBe(AgentSessionStatus.Running);

    const createOperation = appliedPlan.operations.find(
      (operation) => operation.type === AgentOperationType.AlbumCreate,
    );
    const addOperation = appliedPlan.operations.find(
      (operation) => operation.type === AgentOperationType.AlbumAddAssets,
    );
    const coverOperation = appliedPlan.operations.find(
      (operation) => operation.type === AgentOperationType.AlbumSetCover,
    );

    expect(createOperation?.status).toBe(AgentOperationStatus.Applied);
    expect(addOperation?.status).toBe(AgentOperationStatus.Applied);
    expect(coverOperation?.status).toBe(AgentOperationStatus.Skipped);
    expect(coverOperation?.result).toEqual({ skippedReason: 'Operation was not selected for apply' });

    const albumId = createOperation?.result?.albumId;
    expect(albumId).toEqual(expect.any(String));

    const album = await getAlbumInfo({ id: albumId as string }, authOptions(admin.accessToken));
    expect(album.albumName).toBe('Portugal Favorites');
    expect(album.description).toBe('Curated favorites from the trip.');
    expect(album.assetCount).toBe(1);
  });

  test('keeps technical operation details hidden until the user opens details', async ({ context, page }) => {
    await createLooseAssets(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const { currentPlan } = await startPortugalPlan(page, admin.accessToken, providerCredentialId);
    const addOperation = findOperation(currentPlan, AgentOperationType.AlbumAddAssets);
    const portugalDestination = getPortugalDestination(page);

    await expect(page.getByText(addOperation.id)).toHaveCount(0);
    await portugalDestination.getByRole('button', { name: 'Show technical details' }).nth(1).click();
    await expect(page.getByText(addOperation.id)).toBeVisible();
    await portugalDestination.getByRole('button', { name: 'Hide technical details' }).click();
    await expect(page.getByText(addOperation.id)).toHaveCount(0);
  });

  test('supports mobile item review expansion, excluding one photo, and applying a sparse selection', async ({
    context,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createLooseAssets(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const { session, currentPlan } = await startPortugalPlan(page, admin.accessToken, providerCredentialId);
    const addOperation = findOperation(currentPlan, AgentOperationType.AlbumAddAssets);
    const excludedAssetId = addOperation.assetIds[0];
    const portugalDestination = getPortugalDestination(page);

    const photoReviewDialog = await openAddPhotosReviewDialog(page, portugalDestination);
    await expect(photoReviewDialog.getByRole('checkbox', { name: 'Include photo 1' })).toBeVisible();
    await photoReviewDialog.getByRole('checkbox', { name: 'Include photo 1' }).uncheck();
    await photoReviewDialog.getByRole('button', { name: 'Done reviewing' }).click();
    await expect(portugalDestination.getByText('1 of 2 photos selected')).toHaveCount(1);
    await page.getByLabel('Set cover photo').uncheck();
    await expect(page.getByRole('button', { name: 'Apply 2 selected' })).toBeEnabled();

    const { request: applyRequest } = await applySelectedOperations(page, session.id, 'Apply 2 selected');

    expect(applyRequest.postDataJSON()).toMatchObject({
      operationIds: expect.arrayContaining([addOperation.id]),
      itemSelections: {
        [addOperation.id]: {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [excludedAssetId],
        },
      },
      planRevision: currentPlan.revision,
    });
    await expect(page.getByText('2 applied · 1 skipped · 0 failed.')).toBeVisible();
  });

  test('supersedes an older plan revision and applies only the latest revised plan', async ({ context, page }) => {
    await createLooseAssets(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const { session, currentPlan: oldPlan } = await startPortugalPlan(page, admin.accessToken, providerCredentialId);
    const oldAddOperation = findOperation(oldPlan, AgentOperationType.AlbumAddAssets);
    const [coverAssetId] = oldAddOperation.assetIds;

    await reviseProposedOperations(
      {
        id: session.id,
        planId: oldPlan.id,
        agentReviseAlbumOperationsDto: {
          summary: 'Create Portugal Highlights and add 2 loose assets.',
          feedback: 'Use a shorter album name before applying.',
          operations: [
            {
              type: AgentAlbumCreateOperationType.AlbumCreate,
              summary: 'Create Portugal Highlights',
              targetKind: AgentOperationNewAlbumTargetKind.NewAlbum,
              temporaryTargetId: 'portugal-highlights',
              riskLevel: AgentOperationRiskLevel.Low,
              enabled: true,
              payload: {
                albumName: 'Portugal Highlights',
                description: 'Revised by the deterministic e2e assistant.',
              },
            },
            {
              type: AgentAlbumAddAssetsOperationType.AlbumAddAssets,
              summary: 'Add selected photos to Portugal Highlights',
              targetKind: AgentOperationTargetKind.NewAlbum,
              temporaryTargetId: 'portugal-highlights',
              assetIds: oldAddOperation.assetIds,
              riskLevel: AgentOperationRiskLevel.Medium,
              enabled: true,
              payload: {},
            },
            {
              type: AgentAlbumSetCoverOperationType.AlbumSetCover,
              summary: 'Use first photo as Portugal Highlights cover',
              targetKind: AgentOperationTargetKind.NewAlbum,
              temporaryTargetId: 'portugal-highlights',
              assetIds: [coverAssetId],
              riskLevel: AgentOperationRiskLevel.Low,
              enabled: true,
              payload: {},
            },
          ],
        },
      },
      authOptions(admin.accessToken),
    );

    await expect(page.getByText('Create Portugal Highlights and add 2 loose assets.')).toBeVisible();
    await expect(page.getByText('Create Portugal Trip and add 2 loose assets.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apply 3 selected' })).toBeEnabled();

    const latestPlan = await getCurrentOperationPlan({ id: session.id }, authOptions(admin.accessToken));
    if (!latestPlan) {
      throw new Error('Expected a revised operation plan');
    }
    expect(latestPlan.id).not.toBe(oldPlan.id);
    expect(latestPlan.revision).toBeGreaterThan(oldPlan.revision);

    const { request: applyRequest } = await applySelectedOperations(page, session.id, 'Apply 3 selected');
    expect(applyRequest.url()).toContain(`/operation-plan/${latestPlan.id}/apply`);
    expect(applyRequest.url()).not.toContain(`/operation-plan/${oldPlan.id}/apply`);
    expect(applyRequest.postDataJSON()).toMatchObject({ planRevision: latestPlan.revision });
    await expect(page.getByText('3 applied · 0 skipped · 0 failed.')).toBeVisible();
  });

  test('shows thumbnail fallback when a mounted thumbnail request fails while keeping the plan applicable', async ({
    context,
    page,
  }) => {
    const [assetWithMissingThumbnail] = await createLooseAssets(admin.accessToken);
    await makeThumbnailUnavailable(assetWithMissingThumbnail.id);
    await utils.setAuthCookies(context, admin.accessToken);

    const { session } = await startPortugalPlan(page, admin.accessToken, providerCredentialId);
    const portugalDestination = getPortugalDestination(page);
    // The plan's thumbnail strip renders below the fold and its images use loading="lazy",
    // so the broken thumbnail only attempts to load (and triggers the fallback) once it is
    // scrolled into the viewport. Bring each tile into view before asserting the fallback.
    const thumbnails = portugalDestination.getByTestId('agent-plan-thumbnail-image');
    await expect(thumbnails.first()).toBeAttached();
    for (const thumbnail of await thumbnails.all()) {
      await thumbnail.scrollIntoViewIfNeeded();
    }
    await expect(portugalDestination.getByText('Preview unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply 3 selected' })).toBeEnabled();

    await applySelectedOperations(page, session.id, 'Apply 3 selected');
    await expect(page.getByText('3 applied · 0 skipped · 0 failed.')).toBeVisible();
  });

  test('keeps the visible plan after a stale apply response and tells the user to review the latest plan', async ({
    context,
    page,
  }) => {
    await createLooseAssets(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const { session } = await startPortugalPlan(page, admin.accessToken, providerCredentialId);
    const applyRoute = `**/api/agent/sessions/${session.id}/operation-plan/*/apply`;
    const applyHandler = fulfillStaleApplyResponse;
    await page.route(applyRoute, applyHandler);

    try {
      const applyResponsePromise = waitForApplyResponse(page, session.id, 409);
      await page.getByRole('button', { name: 'Apply 3 selected' }).click();
      await applyResponsePromise;

      await expect(page.getByText('This plan changed. Review the latest plan before applying.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Plan review' })).toBeVisible();
      await expect(page.getByText('Create Portugal Trip and add 2 loose assets.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apply 3 selected' })).toBeEnabled();
    } finally {
      await page.unroute(applyRoute, applyHandler);
    }
  });

  test('returns partial apply states while keeping operation IDs hidden before apply', async ({ context, page }) => {
    await createLooseAssets(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const { session, currentPlan } = await startPortugalPlan(page, admin.accessToken, providerCredentialId);
    const createOperation = findOperation(currentPlan, AgentOperationType.AlbumCreate);
    const addOperation = findOperation(currentPlan, AgentOperationType.AlbumAddAssets);
    const coverOperation = findOperation(currentPlan, AgentOperationType.AlbumSetCover);
    const partialPlan = clonePlan(currentPlan);
    partialPlan.status = AgentOperationPlanStatus.Applied;
    partialPlan.operations = partialPlan.operations.map((operation) => {
      if (operation.id === createOperation.id) {
        return { ...operation, status: AgentOperationStatus.Applied, result: { albumId: 'partial-album-id' } };
      }

      if (operation.id === addOperation.id) {
        return {
          ...operation,
          status: AgentOperationStatus.Failed,
          error: 'One photo could not be added',
          result: {
            assetResults: [
              { id: addOperation.assetIds[0], success: true },
              { id: addOperation.assetIds[1], success: false, error: 'Asset write failed' },
            ],
          },
        };
      }

      if (operation.id === coverOperation.id) {
        return {
          ...operation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'Skipped after add-assets failure' },
        };
      }

      return operation;
    });

    const applyRoute = `**/api/agent/sessions/${session.id}/operation-plan/${currentPlan.id}/apply`;
    const applyHandler = async (route: Route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          status: AgentOperationApplyStatus.PartiallyApplied,
          summary: 'Applied 1 operation. Skipped 1. Failed 1.',
          appliedOperationIds: [createOperation.id],
          skippedOperationIds: [coverOperation.id],
          failedOperationIds: [addOperation.id],
          plan: partialPlan,
        } satisfies AgentOperationPlanApplyResponseDto),
      });
    };
    await page.route(applyRoute, applyHandler);

    try {
      await expect(page.getByText(addOperation.id)).toHaveCount(0);
      const applyResponsePromise = waitForApplyResponse(page, session.id);
      await page.getByRole('button', { name: 'Apply 3 selected' }).click();
      const applyResponse = await applyResponsePromise;
      const applyResult = (await applyResponse.json()) as AgentOperationPlanApplyResponseDto;

      expect(applyResult.status).toBe(AgentOperationApplyStatus.PartiallyApplied);
      expect(applyResult.appliedOperationIds).toEqual([createOperation.id]);
      expect(applyResult.skippedOperationIds).toEqual([coverOperation.id]);
      expect(applyResult.failedOperationIds).toEqual([addOperation.id]);
      expect(findOperation(applyResult.plan, AgentOperationType.AlbumCreate).status).toBe(AgentOperationStatus.Applied);
      expect(findOperation(applyResult.plan, AgentOperationType.AlbumAddAssets).status).toBe(
        AgentOperationStatus.Failed,
      );
      expect(findOperation(applyResult.plan, AgentOperationType.AlbumSetCover).status).toBe(
        AgentOperationStatus.Skipped,
      );
    } finally {
      await page.unroute(applyRoute, applyHandler);
    }
  });

  test('surfaces and audits a denied runner proposal without creating a plan or album', async ({ context, page }) => {
    await utils.createAsset(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const session = await startAssistantSession(
      page,
      admin.accessToken,
      providerCredentialId,
      'Create a denied test album with an inaccessible photo.',
    );

    await expect(page.getByText(/Gallery denied the album organization request/)).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => await getCurrentOperationPlan({ id: session.id }, authOptions(admin.accessToken)), {
        timeout: 5000,
      })
      .toBeFalsy();

    const toolCalls = await getToolCalls({ id: session.id }, authOptions(admin.accessToken));
    const proposalToolCall = toolCalls.find((toolCall) => toolCall.toolName === AgentToolName.ProposeAlbumOperations);
    expect(proposalToolCall).toMatchObject({
      status: AgentToolCallStatus.Denied,
      toolName: AgentToolName.ProposeAlbumOperations,
      error: 'Selection handle is expired or not available for this session',
    });

    const albums = await getAllAlbums({}, authOptions(admin.accessToken));
    expect(albums.map((album) => album.albumName)).not.toContain('Denied Trip');
  });
});
