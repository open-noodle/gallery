# Pi Agent End-to-End Album Organizer Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 14 from `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: exercise the Assistant album organizer through Playwright with a deterministic mocked runner, user operation toggles, apply, and one denied proposal path.

**Architecture:** Add an e2e-only runner runtime behind the existing `agent-runner` HTTP protocol. Playwright's Docker Compose stack starts that runner and configures the server's agent runner URL and internal tool gateway URL. The web e2e spec drives the real Assistant page, while the mock runner uses the real Gallery tool gateway to search visible assets and propose album operations; no direct album write tool is added.

**Tech Stack:** Node.js `agent-runner`, Gallery internal agent tool gateway, Docker Compose, Playwright, generated `@immich/sdk`, NestJS server running in the existing e2e stack.

## MCP Coordination Note

The concurrent MCP design in `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md` replaces the runner's hardcoded Gallery tool gateway with a Gallery-hosted MCP endpoint. If this plan is implemented or refactored after that MCP work lands, treat this note as overriding the older gateway-specific snippets below.

Preserve the Playwright behavior and deterministic e2e runtime intent, but adapt the transport surface:

- Use `mcpGateway` instead of `toolGateway` in runner session creation.
- Call Gallery through MCP `tools/call` for `searchAssets` and `proposeAlbumOperations` instead of posting to `/api/agent/internal/tools/.../search-assets` and `/propose-album-operations`.
- Do not import `agent-runner/src/gallery-tools.mjs` or `agent-runner/src/gallery-tool-client.mjs`; the MCP migration retires those files.
- Configure e2e with `IMMICH_AGENT_MCP_GATEWAY_URL=http://immich-server:2285/api/agent/internal/mcp` instead of `IMMICH_AGENT_TOOL_GATEWAY_URL`.
- Keep the end-to-end spec mostly transport-agnostic. It should continue to validate the user flow, persisted plan, denied proposal audit, and final album state rather than asserting the runner transport.
- Replace the final "no direct write/apply tool" registry check with an MCP `tools/list` assertion once the MCP server owns tool discovery.

Scheduling recommendation: if slice 14 has not been implemented yet, wait until MCP slices 1-5 from the MCP design are complete, then implement the e2e runner against MCP. If this slice has already landed, keep the behavioral e2e coverage and let the MCP migration refactor `agent-runner/src/e2e-runtime.mjs`, `agent-runner/src/e2e-runtime.test.mjs`, `agent-runner/src/server.mjs`, `agent-runner/src/server.test.mjs`, and `e2e/docker-compose.yml`.

---

## Scope

This plan implements vertical slice 14 only:

- Use TDD for the slice: add the Playwright user-flow spec first, run it red, then add the deterministic runner/runtime wiring and unit tests needed to turn it green.
- Add a deterministic e2e runner runtime that uses the same HTTP protocol as the Pi runner.
- Keep the production runner default as the Pi runtime.
- Configure `e2e/docker-compose.yml` so the server has a runner URL, tool gateway URL, and agent secret during Playwright runs.
- Add a Playwright web spec that:
  - creates an agent provider credential;
  - starts a session through `/assistant`;
  - sends a prompt;
  - waits for the mocked runner to propose album operations through the real gateway;
  - toggles one operation off;
  - applies the selected operations;
  - verifies persisted operation statuses and the created album;
  - verifies a denied proposal path creates an audited denied tool call, no operation plan, and no album.
- Add runner unit coverage for deterministic proposal behavior, denied proposals, insufficient visible assets, gateway token redaction, session validation, and runtime-aware health capabilities.

This plan intentionally does not add:

- Real provider/model e2e coverage.
- Tool approval UI.
- New album operation types.
- Direct runner write/apply tools.
- Broad e2e coverage for every permission preset.

## File Structure

- `agent-runner/src/e2e-runtime.mjs` - e2e-only deterministic runtime that searches assets and proposes album operations through the Gallery tool gateway.
- `agent-runner/src/e2e-runtime.test.mjs` - unit coverage for happy proposal, denied proposal, insufficient visible assets, gateway token redaction, and session validation.
- `agent-runner/src/server.mjs` - select `createE2eRuntime()` when `GALLERY_AGENT_RUNNER_RUNTIME=e2e`, otherwise keep `createPiRuntime()`, and make `/health` expose runtime-aware capabilities.
- `agent-runner/src/server.test.mjs` - cover runtime selection and runtime-aware health without changing existing protocol tests.
- `agent-runner/Dockerfile` - small runner image for the Playwright Docker Compose stack.
- `e2e/docker-compose.yml` - add the `agent-runner` service and server environment for agent runner/tool-gateway config.
- `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts` - Playwright web e2e coverage for the album organizer happy/toggle/apply flow and denied proposal path.

---

### Task 1: Add the Failing Assistant Album Organizer Playwright Spec

**Files:**

- Create: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`

- [ ] **Step 1: Write the failing Playwright spec before runner implementation**

Create `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`:

```ts
import {
  AgentApprovalMode,
  AgentOperationPlanStatus,
  AgentOperationStatus,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolCallStatus,
  AgentToolName,
  createAgentProviderCredential,
  getAgentSession,
  getAgentSessions,
  getAlbumInfo,
  getAllAlbums,
  getCurrentOperationPlan,
  getToolCalls,
  type AgentOperationPlanResponseDto,
  type AgentSessionResponseDto,
  type LoginResponseDto,
} from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

const credentialLabel = 'E2E deterministic runner';
const model = 'e2e-album-organizer';

const authOptions = (accessToken: string) => ({ headers: asBearerAuth(accessToken) });

const createE2eCredential = (accessToken: string) =>
  createAgentProviderCredential(
    {
      agentProviderCredentialCreateDto: {
        providerType: AgentProviderType.OpenaiCompatible,
        label: credentialLabel,
        secret: 'e2e-secret',
        baseUrl: 'http://e2e-provider.invalid/v1',
        models: [model],
        defaultModel: model,
      },
    },
    authOptions(accessToken),
  );

const waitForLatestSession = async (
  accessToken: string,
  expectedStatus: AgentSessionStatus,
): Promise<AgentSessionResponseDto> => {
  let latestSession: AgentSessionResponseDto | undefined;

  await expect
    .poll(
      async () => {
        const sessions = await getAgentSessions(authOptions(accessToken));
        latestSession = sessions.toSorted((first, second) => second.createdAt.localeCompare(first.createdAt))[0];
        return latestSession?.status;
      },
      { timeout: 10_000 },
    )
    .toBe(expectedStatus);

  return latestSession!;
};

const waitForCurrentPlan = async (
  accessToken: string,
  sessionId: string,
  expectedStatus: AgentOperationPlanStatus,
): Promise<AgentOperationPlanResponseDto> => {
  let plan: AgentOperationPlanResponseDto | null = null;

  await expect
    .poll(
      async () => {
        plan = await getCurrentOperationPlan({ id: sessionId }, authOptions(accessToken));
        return plan?.status;
      },
      { timeout: 10_000 },
    )
    .toBe(expectedStatus);

  return plan!;
};

const startAssistantSession = async (page: Page, accessToken: string) => {
  await page.goto('/assistant');
  await expect(page.getByTestId('assistant-status-reason')).toHaveText('Runner healthy');
  await expect(page.getByRole('heading', { name: 'Session setup' })).toBeVisible();

  await page.getByLabel('Provider credential').selectOption({ label: credentialLabel });
  await page.getByLabel('Model').fill(model);
  await page.getByLabel('Permission preset').selectOption(AgentPermissionPreset.Careful);
  await page.getByLabel('Approval mode').selectOption(AgentApprovalMode.PlanOnly);
  await page.getByRole('button', { name: 'Start session' }).click();

  await expect(page.getByRole('heading', { name: 'Created session' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();
  await expect(page.getByText('No proposed album plan yet.')).toBeVisible();

  return waitForLatestSession(accessToken, AgentSessionStatus.Running);
};

const sendAssistantPrompt = async (page: Page, prompt: string) => {
  await page.getByRole('textbox', { name: 'Message' }).fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
};

test.describe('Assistant album organizer', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
  });

  test.beforeEach(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    await createE2eCredential(admin.accessToken);
  });

  test('proposes album operations, lets the user toggle one off, and applies the approved operations', async ({
    context,
    page,
  }) => {
    await Promise.all([
      utils.createAsset(admin.accessToken, {
        fileCreatedAt: '2026-05-01T10:00:00.000Z',
        fileModifiedAt: '2026-05-01T10:00:00.000Z',
      }),
      utils.createAsset(admin.accessToken, {
        fileCreatedAt: '2026-05-02T10:00:00.000Z',
        fileModifiedAt: '2026-05-02T10:00:00.000Z',
      }),
    ]);
    await utils.setAuthCookies(context, admin.accessToken);

    const session = await startAssistantSession(page, admin.accessToken);
    await sendAssistantPrompt(page, 'Create a Portugal trip album from my loose photos.');

    await expect(page.getByText('I proposed a Portugal Trip album.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Plan review' })).toBeVisible();
    await expect(page.getByText('Create Portugal Trip and add 2 loose assets.')).toBeVisible();
    await expect(page.getByLabel('Create Portugal Trip')).toBeChecked();
    await expect(page.getByLabel('Add selected photos to Portugal Trip')).toBeChecked();
    await expect(page.getByLabel('Use first photo as Portugal Trip cover')).toBeChecked();

    await page.getByLabel('Use first photo as Portugal Trip cover').uncheck();
    await expect(page.getByRole('button', { name: 'Apply 2 selected' })).toBeEnabled();

    const applyResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/agent/sessions/${session.id}/operation-plan/`) &&
        response.url().endsWith('/apply') &&
        response.status() === 201,
    );
    await page.getByRole('button', { name: 'Apply 2 selected' }).click();
    await applyResponse;

    await expect(page.getByRole('status')).toContainText('Applied 2 operations. 0 failed.');
    const appliedPlan = await waitForCurrentPlan(admin.accessToken, session.id, AgentOperationPlanStatus.Applied);
    await expect
      .poll(async () => (await getAgentSession({ id: session.id }, authOptions(admin.accessToken))).status, {
        timeout: 10_000,
      })
      .toBe(AgentSessionStatus.Completed);

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
    expect(album.albumName).toBe('Portugal Trip');
    expect(album.description).toBe('Organized by the deterministic e2e assistant.');
    expect(album.assetCount).toBe(2);
  });

  test('surfaces and audits a denied runner proposal without creating a plan or album', async ({ context, page }) => {
    await utils.createAsset(admin.accessToken);
    await utils.setAuthCookies(context, admin.accessToken);

    const session = await startAssistantSession(page, admin.accessToken);
    await sendAssistantPrompt(page, 'Create a denied test album with an inaccessible photo.');

    await expect(page.getByText(/Gallery denied the album organization request/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No proposed album plan yet.')).toBeVisible();

    await expect
      .poll(async () => await getCurrentOperationPlan({ id: session.id }, authOptions(admin.accessToken)), {
        timeout: 5_000,
      })
      .toBeNull();

    const toolCalls = await getToolCalls({ id: session.id }, authOptions(admin.accessToken));
    const proposalToolCall = toolCalls.find((toolCall) => toolCall.toolName === AgentToolName.ProposeAlbumOperations);
    expect(proposalToolCall).toMatchObject({
      status: AgentToolCallStatus.Denied,
      toolName: AgentToolName.ProposeAlbumOperations,
      error: 'One or more assets are not accessible',
    });

    const albums = await getAllAlbums({}, authOptions(admin.accessToken));
    expect(albums.map((album) => album.albumName)).not.toContain('Denied Trip');
  });
});
```

- [ ] **Step 2: Run the spec red before implementing the runner or compose wiring**

Run:

```bash
pnpm --dir e2e exec playwright test --project=web src/specs/web/assistant-album-organizer.e2e-spec.ts
```

Expected: FAIL because the e2e stack does not yet provide a deterministic healthy runner, `GALLERY_AGENT_RUNNER_RUNTIME=e2e` does not exist, and the mocked runner cannot propose album operations yet.

- [ ] **Step 3: Keep the red spec uncommitted until Tasks 2 and 3 turn it green**

Do not skip this red run. The first failing point should be runner setup/runtime availability, not missing imports or TypeScript syntax errors.

---

### Task 2: Add Deterministic E2E Runner Runtime

**Files:**

- Create: `agent-runner/src/e2e-runtime.test.mjs`
- Create: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/server.mjs`
- Modify: `agent-runner/src/server.test.mjs`

- [ ] **Step 1: Write the failing e2e runtime tests**

Create `agent-runner/src/e2e-runtime.test.mjs`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createE2eRuntime } from './e2e-runtime.mjs';

const gallerySessionId = '00000000-0000-4000-8000-000000000100';
const runnerSessionId = `e2e-${gallerySessionId}`;
const token = 'gateway-token-secret';
const gateway = { url: 'http://gallery.example.test/api/agent/internal/tools', token };

const createSessionBody = (overrides = {}) => ({
  gallerySessionId,
  credential: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: 'openai-compatible',
    label: 'E2E runner',
    baseUrl: 'http://provider.invalid/v1',
    models: ['e2e-album-organizer'],
    defaultModel: 'e2e-album-organizer',
    secret: 'e2e-secret',
  },
  model: 'e2e-album-organizer',
  permissionPreset: 'careful',
  permissionPlan: {},
  approvalMode: 'plan-only',
  initialContext: {},
  toolGateway: gateway,
  ...overrides,
});

const messageBody = (text) => ({
  runnerSessionId,
  gallerySessionId,
  messageId: '00000000-0000-4000-8000-000000000200',
  content: { blocks: [{ type: 'text', text }] },
});

const collectEvents = async (runtime, text) => {
  const events = [];
  for await (const event of runtime.sendMessage(messageBody(text))) {
    events.push(event);
  }
  return events;
};

const createFetch = (handlers) => {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const path = new URL(String(url)).pathname;
    calls.push({ path, body, authorization: init?.headers?.Authorization });

    const handler = handlers.find((candidate) => path.endsWith(candidate.path));
    if (!handler) {
      return new Response(JSON.stringify({ error: `unexpected path ${path}` }), { status: 500 });
    }

    const result = await handler.handle(body);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { calls, fetchImplementation };
};

const successHandlers = () => [
  {
    path: '/search-assets',
    handle: () => ({
      body: {
        status: 'success',
        assets: [
          { id: '00000000-0000-4000-8000-000000000201' },
          { id: '00000000-0000-4000-8000-000000000202' },
          { id: '00000000-0000-4000-8000-000000000203' },
        ],
      },
    }),
  },
  {
    path: '/propose-album-operations',
    handle: (body) => ({
      body: {
        status: 'success',
        summary: 'Stored 3 proposed operations.',
        plan: { id: '00000000-0000-4000-8000-000000000301' },
        toolCall: null,
        received: body,
      },
    }),
  },
];

describe('e2e runtime', () => {
  it('creates a runner session with Gallery tool capabilities', async () => {
    const runtime = createE2eRuntime();

    const session = await runtime.createSession(createSessionBody());

    assert.equal(runtime.getCapabilities().runtime, 'e2e');
    assert.equal(runtime.getCapabilities().tools.includes('proposeAlbumOperations'), true);
    assert.equal(session.runnerSessionId, runnerSessionId);
    assert.equal(session.capabilities.protocolVersion, '2026-05-14');
    assert.equal(session.capabilities.streaming, true);
    assert.equal(session.capabilities.models.includes('e2e-album-organizer'), true);
    assert.equal(session.capabilities.tools.includes('proposeAlbumOperations'), true);
    assert.equal(JSON.stringify(session).includes(token), false);
  });

  it('searches visible assets and proposes a deterministic album plan', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a Portugal trip album.');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].path.endsWith('/search-assets'), true);
    assert.deepEqual(calls[0].body, { filters: { isNotInAlbum: true }, limit: 3 });
    assert.equal(calls[0].authorization, `Bearer ${token}`);
    assert.equal(calls[1].path.endsWith('/propose-album-operations'), true);
    assert.equal(calls[1].body.summary, 'Create Portugal Trip and add 2 loose assets.');
    assert.deepEqual(
      calls[1].body.operations.map((operation) => operation.type),
      ['album.create', 'album.addAssets', 'album.setCover'],
    );
    assert.deepEqual(calls[1].body.operations[1].assetIds, [
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000202',
    ]);
    assert.deepEqual(calls[1].body.operations[2].assetIds, ['00000000-0000-4000-8000-000000000201']);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /I proposed a Portugal Trip album/);
  });

  it('reports a denied proposal without leaking the gateway token', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        path: '/propose-album-operations',
        handle: () => ({
          status: 400,
          body: { message: `denied with ${token}` },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a denied test album.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path.endsWith('/propose-album-operations'), true);
    assert.equal(calls[0].body.summary, 'Denied Trip would use inaccessible assets.');
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /Gallery denied the album organization request/);
    assert.equal(events.at(-1).content.blocks[0].text.includes(token), false);
    assert.match(events.at(-1).content.blocks[0].text, /\[redacted\]/);
  });

  it('reports insufficient visible assets without creating a proposal or leaking the gateway token', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        path: '/search-assets',
        handle: () => ({
          body: {
            status: 'success',
            assets: [{ id: '00000000-0000-4000-8000-000000000201' }],
          },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a Portugal trip album.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path.endsWith('/search-assets'), true);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /needs at least two visible loose assets/);
    assert.equal(events.at(-1).content.blocks[0].text.includes(token), false);
  });

  it('rejects messages for unknown runner sessions', async () => {
    const runtime = createE2eRuntime();

    await assert.rejects(() => collectEvents(runtime, 'Create an album.'), /Runner session not found/);
  });
});
```

- [ ] **Step 2: Run the runner tests and verify they fail**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because `agent-runner/src/e2e-runtime.mjs` does not exist.

- [ ] **Step 3: Implement the e2e runtime**

Create `agent-runner/src/e2e-runtime.mjs`:

```js
import { createGalleryToolClient, redactGatewayToken } from './gallery-tool-client.mjs';
import { galleryToolNames } from './gallery-tools.mjs';

const protocolVersion = '2026-05-14';
const inaccessibleAssetId = '00000000-0000-4000-8000-000000000014';

export const e2eCapabilities = {
  protocolVersion,
  streaming: true,
  tools: galleryToolNames,
  models: ['e2e-album-organizer'],
  runtime: 'e2e',
};

const getPromptText = (content) =>
  content?.blocks
    ?.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim() ?? '';

const completedEvent = ({ gallerySessionId, runnerSessionId, text }) => ({
  type: 'assistant-message-completed',
  sessionId: gallerySessionId,
  runnerSessionId,
  providerMessageId: 'e2e-provider-message',
  content: { blocks: [{ type: 'text', text }] },
});

const deltaEvent = ({ gallerySessionId, runnerSessionId, text }) => ({
  type: 'assistant-message-delta',
  sessionId: gallerySessionId,
  runnerSessionId,
  delta: text,
  sequence: 1,
});

const requireGateway = (entry) => {
  if (!entry.toolGateway) {
    throw new Error('The e2e runner requires a Gallery tool gateway');
  }

  return entry.toolGateway;
};

const requireSearchAssets = async (client) => {
  const result = await client.post('search-assets', { filters: { isNotInAlbum: true }, limit: 3 });
  if (result.status !== 'success') {
    throw new Error(`Asset search did not complete successfully: ${result.status}`);
  }

  const assets = Array.isArray(result.assets) ? result.assets : [];
  if (assets.length < 2) {
    throw new Error('The e2e runner needs at least two visible loose assets');
  }

  return assets.slice(0, 2).map((asset) => asset.id);
};

const proposePortugalTrip = async (client) => {
  const assetIds = await requireSearchAssets(client);
  const [coverAssetId] = assetIds;
  await client.post('propose-album-operations', {
    summary: 'Create Portugal Trip and add 2 loose assets.',
    operations: [
      {
        type: 'album.create',
        summary: 'Create Portugal Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'portugal-trip',
        riskLevel: 'low',
        enabled: true,
        payload: {
          albumName: 'Portugal Trip',
          description: 'Organized by the deterministic e2e assistant.',
        },
      },
      {
        type: 'album.addAssets',
        summary: 'Add selected photos to Portugal Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'portugal-trip',
        assetIds,
        riskLevel: 'medium',
        enabled: true,
        payload: {},
      },
      {
        type: 'album.setCover',
        summary: 'Use first photo as Portugal Trip cover',
        targetKind: 'new_album',
        temporaryTargetId: 'portugal-trip',
        assetIds: [coverAssetId],
        riskLevel: 'low',
        enabled: true,
        payload: {},
      },
    ],
  });
};

const proposeDeniedTrip = async (client) => {
  await client.post('propose-album-operations', {
    summary: 'Denied Trip would use inaccessible assets.',
    operations: [
      {
        type: 'album.create',
        summary: 'Create Denied Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'denied-trip',
        riskLevel: 'low',
        enabled: true,
        payload: {
          albumName: 'Denied Trip',
          description: 'This operation plan is intentionally denied by Gallery.',
        },
      },
      {
        type: 'album.addAssets',
        summary: 'Add inaccessible photo to Denied Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'denied-trip',
        assetIds: [inaccessibleAssetId],
        riskLevel: 'high',
        enabled: true,
        payload: {},
      },
    ],
  });
};

export const createE2eRuntime = ({ fetch: fetchImplementation = fetch } = {}) => {
  const sessions = new Map();

  return {
    getCapabilities() {
      return e2eCapabilities;
    },

    async createSession(body) {
      const runnerSessionId = `e2e-${body.gallerySessionId}`;
      sessions.set(runnerSessionId, {
        gallerySessionId: body.gallerySessionId,
        model: body.model,
        toolGateway: body.toolGateway,
      });

      return {
        runnerSessionId,
        capabilities: {
          ...e2eCapabilities,
          tools: body.toolGateway ? e2eCapabilities.tools : [],
          models: [body.model],
        },
      };
    },

    async *sendMessage({ runnerSessionId, gallerySessionId, content }) {
      const entry = sessions.get(runnerSessionId);
      if (!entry || entry.gallerySessionId !== gallerySessionId) {
        throw new Error('Runner session not found');
      }

      const gateway = requireGateway(entry);
      const client = createGalleryToolClient({
        gateway,
        gallerySessionId,
        fetch: fetchImplementation,
      });
      const prompt = getPromptText(content);

      yield deltaEvent({
        gallerySessionId,
        runnerSessionId,
        text: 'Drafting an album plan.',
      });

      try {
        if (/\bdenied\b|\binaccessible\b/i.test(prompt)) {
          await proposeDeniedTrip(client);
        } else {
          await proposePortugalTrip(client);
        }

        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: 'I proposed a Portugal Trip album. Review the operations before applying them.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: `Gallery denied the album organization request: ${redactGatewayToken(message, gateway)}`,
        });
      }
    },
  };
};
```

- [ ] **Step 4: Add runtime selection in the server**

Modify `agent-runner/src/server.mjs` imports:

```js
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createE2eRuntime } from './e2e-runtime.mjs';
import { createPiRuntime } from './pi-runtime.mjs';
```

Rename the top-level `capabilities` constant to `defaultCapabilities`:

```js
const defaultCapabilities = {
  protocolVersion: '2026-05-14',
  streaming: true,
  tools: [],
  models: [],
  runtime: 'pi',
};
```

Add these helpers after `decodeRunnerSessionId`:

```js
export const createRuntimeFromEnv = (env = process.env) =>
  env.GALLERY_AGENT_RUNNER_RUNTIME === 'e2e' ? createE2eRuntime() : createPiRuntime();

const normalizeCapabilities = (capabilities) => {
  if (
    !capabilities ||
    typeof capabilities !== 'object' ||
    typeof capabilities.protocolVersion !== 'string' ||
    typeof capabilities.streaming !== 'boolean' ||
    !Array.isArray(capabilities.tools) ||
    !Array.isArray(capabilities.models)
  ) {
    throw new Error('invalid runtime capabilities');
  }

  const normalizedCapabilities = {
    protocolVersion: capabilities.protocolVersion,
    streaming: capabilities.streaming,
    tools: capabilities.tools,
    models: capabilities.models,
  };
  if (typeof capabilities.runtime === 'string') {
    normalizedCapabilities.runtime = capabilities.runtime;
  }

  return normalizedCapabilities;
};

const getRuntimeCapabilities = (runtime) =>
  typeof runtime.getCapabilities === 'function'
    ? normalizeCapabilities(runtime.getCapabilities())
    : defaultCapabilities;
```

Update `normalizeRuntimeCreateSessionResponse` to use the shared capability normalizer:

```js
const normalizeRuntimeCreateSessionResponse = (runnerSession) => {
  if (typeof runnerSession?.runnerSessionId !== 'string') {
    throw new Error('invalid runtime session response');
  }

  return {
    runnerSessionId: runnerSession.runnerSessionId,
    capabilities: normalizeCapabilities(runnerSession.capabilities),
  };
};
```

Change the `startServer` default runtime:

```js
export const startServer = ({
  port = Number(process.env.PORT ?? 4477),
  host = process.env.HOST ?? '127.0.0.1',
  runtime = createRuntimeFromEnv(),
} = {}) => {
```

Change the `/health` response to use the active runtime capabilities:

```js
if (request.method === 'GET' && url.pathname === '/health') {
  sendJson(response, 200, { status: 'ok', version: '0.1.0', capabilities: getRuntimeCapabilities(runtime) });
  return;
}
```

- [ ] **Step 5: Cover runtime selection in server tests**

Modify the import in `agent-runner/src/server.test.mjs`:

```js
import { createRuntimeFromEnv, startServer } from './server.mjs';
```

Add these tests near the import/argv and health tests:

```js
it('selects the e2e runtime from environment', async () => {
  const runtime = createRuntimeFromEnv({ GALLERY_AGENT_RUNNER_RUNTIME: 'e2e' });

  const session = await runtime.createSession(createSessionBody({ toolGateway: null }));

  assert.equal(session.runnerSessionId, 'e2e-00000000-0000-4000-8000-000000000100');
  assert.equal(session.capabilities.runtime, 'e2e');
});

it('returns runtime-aware health capabilities', async () => {
  const runtime = {
    ...createRuntime(),
    getCapabilities: () => ({
      protocolVersion: '2026-05-14',
      streaming: true,
      tools: ['proposeAlbumOperations'],
      models: ['e2e-album-organizer'],
      runtime: 'e2e',
    }),
  };

  await withServer(runtime, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['proposeAlbumOperations'],
        models: ['e2e-album-organizer'],
        runtime: 'e2e',
      },
    });
  });
});
```

- [ ] **Step 6: Run runner tests and verify they pass**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 7: Commit the runner runtime**

```bash
git add agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs agent-runner/src/server.mjs agent-runner/src/server.test.mjs
git commit -m "test(agent-runner): add deterministic e2e runtime"
```

---

### Task 3: Wire Agent Runner Into Playwright Compose and Turn the E2E Spec Green

**Files:**

- Create: `agent-runner/Dockerfile`
- Modify: `e2e/docker-compose.yml`
- Verify/commit: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`

- [ ] **Step 1: Add the runner Dockerfile**

Create `agent-runner/Dockerfile`:

```dockerfile
FROM ghcr.io/immich-app/base-server-dev:202604141125@sha256:9338c216fb0fef4172cf53cd8e4ff607c6635d576dcc1366151f13d69bbb45ef

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  COREPACK_HOME=/tmp \
  PNPM_HOME=/buildcache/pnpm-store \
  PATH="/buildcache/pnpm-store:$PATH"

RUN npm install --global corepack@latest && \
  corepack enable pnpm && \
  pnpm config set store-dir "$PNPM_HOME"

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY patches ./patches
COPY agent-runner ./agent-runner

RUN --mount=type=cache,id=pnpm-agent-runner,target=/buildcache/pnpm-store \
  pnpm --filter @open-noodle/agent-runner --frozen-lockfile install

EXPOSE 4477

CMD ["pnpm", "--dir", "agent-runner", "start"]
```

- [ ] **Step 2: Run a Compose config check and verify the runner is absent**

Run:

```bash
docker compose -f e2e/docker-compose.yml config --services | rg '^agent-runner$'
```

Expected: FAIL because the e2e compose stack does not yet define an `agent-runner` service.

- [ ] **Step 3: Configure the server and runner service**

Modify the `immich-server.environment` block in `e2e/docker-compose.yml` to include the agent environment:

```text
      IMMICH_AGENT_SECRET_KEY: e2e-agent-secret-key-change-me
      IMMICH_AGENT_RUNNER_URL: http://agent-runner:4477
      IMMICH_AGENT_TOOL_GATEWAY_URL: http://immich-server:2285/api/agent/internal/tools
      IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS: '5000'
      IMMICH_AGENT_RUNNER_MESSAGE_STREAM_TIMEOUT_MS: '30000'
```

Modify `immich-server.depends_on` to include the runner:

```text
      agent-runner:
        condition: service_started
```

Add this service after `immich-server`:

```text
  agent-runner:
    container_name: immich-e2e-agent-runner
    build:
      context: ../
      dockerfile: agent-runner/Dockerfile
    environment:
      HOST: 0.0.0.0
      PORT: 4477
      GALLERY_AGENT_RUNNER_RUNTIME: e2e
    ports:
      - 4477:4477
```

- [ ] **Step 4: Run Compose config check and verify the runner exists**

Run:

```bash
docker compose -f e2e/docker-compose.yml config --services | rg '^agent-runner$'
```

Expected: PASS with output:

```text
agent-runner
```

- [ ] **Step 5: Build the runner image**

Run:

```bash
docker compose -f e2e/docker-compose.yml build agent-runner
```

Expected: PASS.

- [ ] **Step 6: Run TypeScript checking for the e2e package**

Run:

```bash
pnpm --dir e2e check
```

Expected: PASS.

- [ ] **Step 7: Run lint for the e2e package**

Run:

```bash
pnpm --dir e2e lint
```

Expected: PASS.

- [ ] **Step 8: Run the targeted Playwright spec and verify the red Task 1 test is now green**

Run:

```bash
pnpm --dir e2e exec playwright test --project=web src/specs/web/assistant-album-organizer.e2e-spec.ts
```

Expected: PASS with the happy/toggle/apply test and denied/audited proposal test both passing.

- [ ] **Step 9: Commit the e2e compose wiring and Playwright coverage**

```bash
git add agent-runner/Dockerfile e2e/docker-compose.yml e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
git commit -m "test(e2e): cover assistant album organizer flow"
```

---

### Task 4: Final Verification

**Files:**

- Verify: `agent-runner/src/e2e-runtime.mjs`
- Verify: `agent-runner/src/server.mjs`
- Verify: `agent-runner/Dockerfile`
- Verify: `e2e/docker-compose.yml`
- Verify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`

- [ ] **Step 1: Run runner unit tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 2: Run e2e package checks**

Run:

```bash
pnpm --dir e2e check
pnpm --dir e2e lint
```

Expected: PASS.

- [ ] **Step 3: Run the targeted Assistant Playwright test**

Run:

```bash
pnpm --dir e2e exec playwright test --project=web src/specs/web/assistant-album-organizer.e2e-spec.ts
```

Expected: PASS with two tests passing.

- [ ] **Step 4: Confirm the exported runner tool registry has no direct write/apply tool**

Run:

```bash
node --input-type=module <<'EOF'
import { galleryToolNames } from './agent-runner/src/gallery-tools.mjs';

const forbiddenTools = [
  'applyAlbumOperations',
  'applyApprovedOperations',
  'createAlbum',
  'addAssetsToAlbum',
  'setAlbumCover',
];
const exposedForbiddenTools = galleryToolNames.filter((toolName) => forbiddenTools.includes(toolName));

if (exposedForbiddenTools.length > 0) {
  throw new Error(`Runner exposes direct write/apply tools: ${exposedForbiddenTools.join(', ')}`);
}
EOF
```

Expected: PASS. The runner may propose album operation payloads, but the exported tool registry must not expose direct album write/apply tools.

- [ ] **Step 5: Review the final diff**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- agent-runner/src/e2e-runtime.mjs agent-runner/src/server.mjs agent-runner/Dockerfile e2e/docker-compose.yml e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
```

Expected: diff is limited to the e2e runtime, runner selection, compose wiring, and the new Playwright spec.
