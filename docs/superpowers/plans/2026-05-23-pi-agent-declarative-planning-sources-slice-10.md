# Pi Agent Clarification Loop UI And Message Blocks Slice 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render source-resolution clarification choices in assistant chat and let the user answer with an opaque choice reference that Pi can reuse in the next source-aware tool call.

**Architecture:** Add a persisted assistant `clarification` message block alongside the existing `text`, `tool-call`, `asset`, and `plan` blocks. Add opaque `choice:<kind>:<token>` refs to declarative resolver choices and allow those refs on declarative named filters so follow-up tool calls can resolve the exact selected candidate without exposing raw IDs. Render the block in the assistant chat as compact choice buttons with optional thumbnails and a text-only fallback.

**Tech Stack:** NestJS DTOs and runner stream validation, resolver service, OpenAPI TypeScript SDK generation, Svelte 5, Vitest, Testing Library.

---

## Scope

This is Slice 10 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only:

- persisted assistant clarification message blocks;
- opaque choice refs on source-resolution choices;
- declarative named-filter `choiceRefs` so selected choices can be reused in the next tool call;
- assistant chat rendering for clarification blocks, optional thumbnails, click-to-reply, and text fallback;
- generated OpenAPI TypeScript SDK updates needed by the web UI.

Do not implement:

- broad MCP prompt/example/doc overhaul. That is Slice 11.
- activity timeline wording or observability polish. That is Slice 12.
- a new persistence table for clarification state. Choice refs are deterministic and session-scoped.
- direct writes or auto-apply behavior.

## Files

- Modify: `server/src/dtos/agent-message.dto.ts`
  - Add `AgentMessageClarificationBlockSchema` and `AgentMessageClarificationChoiceSchema`.
  - Include the block in assistant response content, not public user message creation.
- Modify: `server/src/types/agent-message.types.ts`
  - Add `AgentMessageClarificationBlock` and choice types.
- Modify: `server/src/dtos/agent-message.dto.spec.ts`
  - Add contract coverage for accepted clarification blocks, text fallback, unsafe raw ID rejection, and public-create rejection.
- Modify: `server/src/repositories/agent-runner.repository.ts`
  - Accept clarification blocks in `assistant-message-completed` stream events.
- Modify: `server/src/repositories/agent-runner.repository.spec.ts`
  - Add stream parsing coverage for valid and invalid clarification blocks.
- Modify: `server/src/types/agent-tool.types.ts`
  - Add optional `choiceRef` to `AgentResolvedAssetSearchFilterChoice`.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Add `choiceRef` to `AgentResolvedAssetSearchFilterChoiceSchema`.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - Assert resolver choices accept safe choice refs and reject raw UUID refs.
- Modify: `server/src/types/agent-asset-source.types.ts`
  - Add optional `choiceRefs` to `AgentDeclarativeNamedFilter`.
- Modify: `server/src/dtos/agent-asset-source.dto.ts`
  - Add `AgentChoiceRefSchema` and allow bounded unique `choiceRefs` on named filters.
- Modify: `server/src/dtos/agent-asset-source.dto.spec.ts`
  - Add schema tests for valid choice refs, raw UUID rejection, and duplicate refs.
- Modify: `server/src/services/agent-asset-search-filter-resolver.service.ts`
  - Generate deterministic session-scoped opaque refs for choices.
  - Resolve provided choice refs before falling back to ambiguous-name matching.
- Modify: `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`
  - Add resolver tests for ambiguous people choices and follow-up `choiceRefs`.
- Modify: `open-api/immich-openapi-specs.json`
  - Regenerate from server DTOs.
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
  - Regenerate TypeScript SDK.
- Modify: `open-api/typescript-sdk/build/fetch-client.js`
  - Regenerate TypeScript SDK build output.
- Modify: `open-api/typescript-sdk/build/fetch-client.d.ts`
  - Regenerate TypeScript SDK build output.
- Create: `web/src/routes/(user)/assistant/agent-message-clarification-ui.ts`
  - Local formatting helpers for button labels and follow-up text.
- Create: `web/src/routes/(user)/assistant/agent-message-clarification-ui.spec.ts`
  - Unit tests for follow-up text and safe choice-ref display behavior.
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
  - Render assistant message blocks instead of flattening only text.
  - Add clarification card rendering, thumbnails, fallback glyph, and click-to-reply.
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
  - Add UI tests for choices, thumbnails, click-to-reply, reload preservation, and text fallback.
- Modify: `i18n/en.json`
  - Add English labels for clarification UI.

## Design Decisions

- Choice refs use the format `choice:<kind>:<token>`, for example `choice:person:fccMVHPSQ35DjvWH`.
- The token is a deterministic SHA-256 based value derived from session ID, kind, normalized query, candidate value, candidate ID when present, and the resulting search filter. It is not reversible and does not contain a raw UUID.
- Resolver follow-up calls include choice refs on the same named filter:

```ts
{
  people: {
    match: 'any',
    names: ['Pierre'],
    choiceRefs: ['choice:person:fccMVHPSQ35DjvWH']
  }
}
```

- A selected choice ref must match one visible candidate for one provided query. Unknown or stale refs return `needs_clarification` and do not create broad filters.
- Clarification message blocks are assistant-response-only. The public create message DTO remains text-only so users cannot forge structured blocks through the normal chat endpoint.
- The UI follow-up text includes the safe `choiceRef`, label, kind, and query, for example: `Use choice:person:fccMVHPSQ35DjvWH for Pierre (Pierre M.).`
- Optional thumbnails use `thumbnailAssetId` and the existing asset thumbnail endpoint. Choices without thumbnails render a compact initials fallback.
- Reload preservation is handled by persisting the block in `agent_message.content`; no client-only state is required.

## TDD Requirements

Use TDD for every implementation step:

1. Write or update the failing test first.
2. Run the exact focused command and verify the failure is for missing Slice 10 behavior.
3. Implement the smallest code change that makes that test pass.
4. Re-run the focused test and verify green.
5. Continue to the next behavior only after green.

Generated OpenAPI and SDK changes happen after server DTO tests are green. Web tests that import the new SDK enum must fail before SDK regeneration.

## Edge Cases Required By This Slice

Every edge case below must be covered by automated tests in this slice:

- Ambiguous people render concise choices with optional thumbnails.
- Choice refs do not expose unsafe internal IDs or raw UUIDs.
- User selection can be included in the next source-aware tool call through `choiceRefs`.
- Reloading the session preserves the clarification context because it is persisted as a message block.
- Text-only fallback works when thumbnails are unavailable.
- Public user message creation still rejects structured clarification blocks.
- Unknown or stale choice refs do not resolve to a broad search.

## Task 1: Server Message Block Contract

**Files:**

- Modify: `server/src/dtos/agent-message.dto.ts`
- Modify: `server/src/types/agent-message.types.ts`
- Modify: `server/src/dtos/agent-message.dto.spec.ts`
- Modify: `server/src/repositories/agent-runner.repository.ts`
- Modify: `server/src/repositories/agent-runner.repository.spec.ts`

- [ ] **Step 1: Write failing DTO tests for assistant clarification blocks**

In `server/src/dtos/agent-message.dto.spec.ts`, add to `describe(AgentMessageResponseDto.name, ...)`:

```ts
it('encodes persisted clarification blocks with safe choice refs and optional thumbnails', () => {
  const result = AgentMessageResponseDto.schema.safeEncode(
    makeResponse({
      content: {
        blocks: [
          {
            type: 'clarification',
            kind: 'person',
            query: 'Pierre',
            summary: 'I found two people named Pierre.',
            textFallback: 'Which Pierre should I use?',
            choices: [
              {
                choiceRef: 'choice:person:abcDEF1234567890',
                label: 'Pierre M.',
                description: '12 matching photos',
                thumbnailAssetId: factory.uuid(),
              },
              {
                choiceRef: 'choice:person:defABC1234567890',
                label: 'Pierre',
                thumbnailAssetId: null,
              },
            ],
          },
        ],
      },
    }),
  );

  expect(result.success).toBe(true);
});

it.each([
  ['raw uuid choice ref', { choiceRef: factory.uuid(), label: 'Pierre', thumbnailAssetId: null }],
  ['choice with raw id', { choiceRef: 'choice:person:abcDEF1234567890', id: factory.uuid(), label: 'Pierre' }],
  [
    'choice with search filter',
    { choiceRef: 'choice:person:abcDEF1234567890', label: 'Pierre', searchFilter: { personIds: [factory.uuid()] } },
  ],
])('rejects unsafe clarification choice payloads: %s', (_label, choice) => {
  const result = AgentMessageResponseDto.schema.safeEncode(
    makeResponse({
      content: {
        blocks: [
          {
            type: 'clarification',
            kind: 'person',
            query: 'Pierre',
            summary: 'I found two people named Pierre.',
            textFallback: 'Which Pierre should I use?',
            choices: [choice],
          },
        ],
      } as never,
    }),
  );

  expect(result.success).toBe(false);
});
```

Extend the existing public create rejection table:

```ts
{
  type: 'clarification',
  kind: 'person',
  query: 'Pierre',
  summary: 'Pick a person.',
  textFallback: 'Which person?',
  choices: [{ choiceRef: 'choice:person:abcDEF1234567890', label: 'Pierre' }],
}
```

- [ ] **Step 2: Run DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-message.dto.spec.ts -t "clarification|public create|persisted structured"
```

Expected: fails because `clarification` is not a valid message block type.

- [ ] **Step 3: Implement message block DTO and types**

In `server/src/types/agent-message.types.ts`, add:

```ts
export type AgentMessageClarificationChoice = {
  choiceRef: string;
  label: string;
  description?: string;
  thumbnailAssetId?: string | null;
};

export type AgentMessageClarificationBlock = {
  type: 'clarification';
  kind: 'person' | 'tag' | 'album' | 'space' | 'cameraMake' | 'cameraModel' | 'lensModel';
  query: string;
  summary: string;
  textFallback: string;
  choices: AgentMessageClarificationChoice[];
};
```

Include `AgentMessageClarificationBlock` in `AgentMessageBlock`.

In `server/src/dtos/agent-message.dto.ts`, add near the other block schemas:

```ts
const choiceRef = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^choice:(person|tag|album|space|cameraMake|cameraModel|lensModel):[A-Za-z0-9_-]{8,120}$/, {
    message: 'choiceRef must use the choice:<kind>:<token> format',
  });

const AgentMessageClarificationChoiceSchema = z
  .strictObject({
    choiceRef,
    label: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(500).optional(),
    thumbnailAssetId: z.uuidv4().nullable().optional(),
  })
  .meta({ id: 'AgentMessageClarificationChoice' });

const AgentMessageClarificationBlockSchema = z
  .strictObject({
    type: z.literal('clarification').meta({ id: 'AgentMessageClarificationBlockType' }),
    kind: z.enum(['person', 'tag', 'album', 'space', 'cameraMake', 'cameraModel', 'lensModel']),
    query: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(1000),
    textFallback: z.string().trim().min(1).max(1000),
    choices: z.array(AgentMessageClarificationChoiceSchema).min(1).max(10),
  })
  .meta({ id: 'AgentMessageClarificationBlock' });
```

Add `AgentMessageClarificationBlockSchema` to `AgentMessageBlockSchema`, but not to `AgentUserMessageContentSchema`.

- [ ] **Step 4: Re-run DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-message.dto.spec.ts -t "clarification|public create|persisted structured"
```

Expected: all selected tests pass.

- [ ] **Step 5: Write failing runner repository stream tests**

In `server/src/repositories/agent-runner.repository.spec.ts`, add coverage near existing `assistant-message-completed` parsing tests:

```ts
it('accepts completed assistant messages with clarification blocks', async () => {
  const event = {
    type: 'assistant-message-completed',
    sessionId: sessionId,
    runnerSessionId,
    providerMessageId: null,
    content: {
      blocks: [
        {
          type: 'clarification',
          kind: 'person',
          query: 'Pierre',
          summary: 'I found two people named Pierre.',
          textFallback: 'Which Pierre should I use?',
          choices: [{ choiceRef: 'choice:person:abcDEF1234567890', label: 'Pierre M.', thumbnailAssetId: null }],
        },
      ],
    },
  };

  mockFetchSse(event);

  await expect(repository.streamMessage(messageRequest)).resolves.toContainEqual(event);
});

it('rejects completed assistant messages with malformed clarification choices', async () => {
  mockFetchSse({
    type: 'assistant-message-completed',
    sessionId,
    runnerSessionId,
    providerMessageId: null,
    content: {
      blocks: [
        {
          type: 'clarification',
          kind: 'person',
          query: 'Pierre',
          summary: 'I found two people named Pierre.',
          textFallback: 'Which Pierre should I use?',
          choices: [{ choiceRef: 'not-safe', label: 'Pierre M.' }],
        },
      ],
    },
  });

  await expect(repository.streamMessage(messageRequest)).rejects.toThrow('invalid stream event');
});
```

Use the existing helper names in that spec; if they differ, keep the assertion shape and adapt only to local helpers.

- [ ] **Step 6: Run runner repository tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/repositories/agent-runner.repository.spec.ts -t "clarification|assistant-message-completed"
```

Expected: valid clarification event is filtered/rejected because `isMessageBlock()` does not accept `clarification`.

- [ ] **Step 7: Implement runner stream validation**

In `server/src/repositories/agent-runner.repository.ts`, add helpers:

```ts
const clarificationKinds = new Set(['person', 'tag', 'album', 'space', 'cameraMake', 'cameraModel', 'lensModel']);
const isChoiceRef = (value: unknown) =>
  typeof value === 'string' &&
  /^choice:(person|tag|album|space|cameraMake|cameraModel|lensModel):[A-Za-z0-9_-]{8,120}$/.test(value);
```

Extend `isMessageBlock()`:

```ts
if (block.type === 'clarification') {
  const choices = Array.isArray(block.choices) ? block.choices.map(objectRecord) : [];
  return (
    typeof block.kind === 'string' &&
    clarificationKinds.has(block.kind) &&
    typeof block.query === 'string' &&
    typeof block.summary === 'string' &&
    typeof block.textFallback === 'string' &&
    choices.length > 0 &&
    choices.length <= 10 &&
    choices.every(
      (choice) =>
        isChoiceRef(choice.choiceRef) &&
        typeof choice.label === 'string' &&
        optionalString(choice.description) &&
        (choice.thumbnailAssetId === undefined ||
          choice.thumbnailAssetId === null ||
          typeof choice.thumbnailAssetId === 'string'),
    )
  );
}
```

- [ ] **Step 8: Re-run runner repository tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/repositories/agent-runner.repository.spec.ts -t "clarification|assistant-message-completed"
```

Expected: selected tests pass.

## Task 2: Opaque Choice Refs For Source Resolution

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/types/agent-asset-source.types.ts`
- Modify: `server/src/dtos/agent-asset-source.dto.ts`
- Modify: `server/src/dtos/agent-asset-source.dto.spec.ts`
- Modify: `server/src/services/agent-asset-search-filter-resolver.service.ts`
- Modify: `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`

- [ ] **Step 1: Write failing DTO tests for choice refs**

In `server/src/dtos/agent-asset-source.dto.spec.ts`, add:

```ts
it('accepts declarative named filters with safe choice refs', () => {
  const result = AgentAssetSourceInputDto.schema.safeParse({
    kind: 'search',
    filters: {
      people: {
        match: 'any',
        names: ['Pierre'],
        choiceRefs: ['choice:person:abcDEF1234567890'],
      },
    },
  });

  expect(result.success).toBe(true);
});

it.each([
  ['raw uuid', [factory.uuid()]],
  ['wrong kind', ['choice:user:abcDEF1234567890']],
  ['duplicate refs', ['choice:person:abcDEF1234567890', 'choice:person:abcDEF1234567890']],
])('rejects declarative named filter choice refs with %s', (_label, choiceRefs) => {
  const result = AgentAssetSourceInputDto.schema.safeParse({
    kind: 'search',
    filters: {
      people: { match: 'any', names: ['Pierre'], choiceRefs },
    },
  });

  expect(result.success).toBe(false);
});
```

In `server/src/dtos/agent-tool.dto.spec.ts`, extend the resolver choice response test:

```ts
choiceRef: 'choice:person:abcDEF1234567890',
```

Add a rejection test for `choiceRef: factory.uuid()`.

- [ ] **Step 2: Run DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts src/dtos/agent-tool.dto.spec.ts -t "choice refs|choiceRef|resolve filter"
```

Expected: fails because schemas do not know `choiceRefs` or `choiceRef`.

- [ ] **Step 3: Implement choice-ref schemas and types**

In `server/src/types/agent-tool.types.ts`, add:

```ts
choiceRef?: string;
```

to `AgentResolvedAssetSearchFilterChoice`.

In `server/src/types/agent-asset-source.types.ts`, add:

```ts
choiceRefs?: string[];
```

to `AgentDeclarativeNamedFilter`.

In `server/src/dtos/agent-asset-source.dto.ts`, export a shared schema:

```ts
export const AgentChoiceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^choice:(person|tag|album|space|cameraMake|cameraModel|lensModel):[A-Za-z0-9_-]{8,120}$/, {
    message: 'choiceRef must use the choice:<kind>:<token> format',
  })
  .meta({ id: 'AgentChoiceRef' });
```

Add to `AgentDeclarativeNamedFilterSchema`:

```ts
choiceRefs: z
  .array(AgentChoiceRefSchema)
  .max(20)
  .superRefine((choiceRefs, ctx) => {
    if (new Set(choiceRefs).size !== choiceRefs.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'choiceRefs must be unique' });
    }
  })
  .optional(),
```

In `server/src/dtos/agent-tool.dto.ts`, import `AgentChoiceRefSchema` and add `choiceRef: AgentChoiceRefSchema.optional()` to `AgentResolvedAssetSearchFilterChoiceSchema`.

- [ ] **Step 4: Re-run DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts src/dtos/agent-tool.dto.spec.ts -t "choice refs|choiceRef|resolve filter"
```

Expected: selected DTO tests pass.

- [ ] **Step 5: Write failing resolver tests for opaque refs and follow-up resolution**

In `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`, add near the declarative ambiguity tests:

```ts
it('returns opaque choice refs for ambiguous people without exposing raw ids in the ref', async () => {
  const result = await sut.resolveDeclarativeFilters(auth, session, {
    people: { match: 'any', names: ['Pierre'] },
  });

  expect(result.status).toBe('needs_clarification');
  const choices = result.results[0].choices;
  expect(choices).toHaveLength(2);
  expect(choices[0].choiceRef).toMatch(/^choice:person:[A-Za-z0-9_-]{8,120}$/);
  expect(choices[0].choiceRef).not.toContain(choices[0].id ?? 'no-id');
  expect(choices[1].choiceRef).toMatch(/^choice:person:[A-Za-z0-9_-]{8,120}$/);
});

it('uses a selected people choice ref on the next declarative resolver call', async () => {
  const ambiguous = await sut.resolveDeclarativeFilters(auth, session, {
    people: { match: 'any', names: ['Pierre'] },
  });
  expect(ambiguous.status).toBe('needs_clarification');
  const selected = ambiguous.results[0].choices[1];

  const result = await sut.resolveDeclarativeFilters(auth, session, {
    people: { match: 'any', names: ['Pierre'], choiceRefs: [selected.choiceRef!] },
  });

  expect(result.status).toBe('success');
  expect(result.filters.personIds).toEqual([selected.id]);
  expect(result.results[0]).toMatchObject({
    kind: 'person',
    query: 'Pierre',
    status: 'matched',
    id: selected.id,
    value: selected.value,
  });
});

it('does not broaden search when a selected choice ref is stale', async () => {
  const result = await sut.resolveDeclarativeFilters(auth, session, {
    people: { match: 'any', names: ['Pierre'], choiceRefs: ['choice:person:staleChoice0000'] },
  });

  expect(result.status).toBe('needs_clarification');
  expect(result.filters.personIds).toBeUndefined();
  expect(result.message).toMatch(/choice/i);
});
```

Use existing fixture names in the spec. If the duplicate person setup uses a different query than `Pierre`, keep the same assertions and replace only the fixture label.

- [ ] **Step 6: Run resolver tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "choice ref|ambiguous people|selected people"
```

Expected: fails because resolver choices have no `choiceRef`, and provided `choiceRefs` are ignored.

- [ ] **Step 7: Implement deterministic choice refs and selected-choice resolution**

In `server/src/services/agent-asset-search-filter-resolver.service.ts`, import:

```ts
import { createHash } from 'node:crypto';
```

Add helpers:

```ts
const choiceRefKinds = new Set(['person', 'tag', 'album', 'space', 'cameraMake', 'cameraModel', 'lensModel']);

const normalizeChoiceRefQuery = (query: string) => query.trim().toLocaleLowerCase();

const stableChoiceRefToken = (parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 22);
```

Add a private method:

```ts
private buildChoiceRef(
  sessionId: string,
  kind: AgentResolvedAssetSearchFilterKind,
  query: string,
  candidate: { id?: string; value: string },
  searchFilter: Partial<AgentSearchAssetsFilters>,
): string {
  const token = stableChoiceRefToken([
    sessionId,
    kind,
    normalizeChoiceRefQuery(query),
    candidate.id ?? null,
    candidate.value,
    searchFilter,
  ]);
  return `choice:${kind}:${token}`;
}
```

Change `matchVisibleCandidates()` to accept `sessionId` and pass it to `choiceForIdCandidate()`. Change `choiceForIdCandidate()` to accept `sessionId`, `query`, and return `choiceRef`.

Before ordinary candidate matching in named filters, check `filter.choiceRefs`. For each query/candidate, compute the same choice ref and select candidates whose refs are present. If every provided ref maps to a candidate, return matched results and populate resolved filters. If any ref is unknown, return a non-matched result with no search filter and message `Selected <kind> choice is no longer available`.

Keep the implementation small: support `choiceRefs` for named ID-backed filters (`people`, `tags`, `albums`) in this slice. Existing space workflow clarification remains covered by message blocks and can use text fallback until a later slice adds reusable space target refs.

- [ ] **Step 8: Re-run resolver tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "choice ref|ambiguous people|selected people"
```

Expected: selected resolver tests pass.

## Task 3: Web Clarification Card Rendering

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-message-clarification-ui.ts`
- Create: `web/src/routes/(user)/assistant/agent-message-clarification-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing web helper tests**

Create `web/src/routes/(user)/assistant/agent-message-clarification-ui.spec.ts`:

```ts
import { buildAgentClarificationChoiceReply, getAgentClarificationInitials } from './agent-message-clarification-ui';

describe('agent-message-clarification-ui', () => {
  it('builds a safe follow-up reply that carries the choice ref, query, kind, and label', () => {
    expect(
      buildAgentClarificationChoiceReply(
        { kind: 'person', query: 'Pierre' },
        { choiceRef: 'choice:person:abcDEF1234567890', label: 'Pierre M.' },
      ),
    ).toBe('Use choice:person:abcDEF1234567890 for person "Pierre" (Pierre M.).');
  });

  it('builds initials fallback without leaking the choice token', () => {
    expect(getAgentClarificationInitials('Pierre M.')).toBe('PM');
    expect(getAgentClarificationInitials('choice:person:abcDEF1234567890')).toBe('C');
  });
});
```

- [ ] **Step 2: Run helper tests and verify red**

Run:

```bash
pnpm --dir web exec vitest --run "src/routes/(user)/assistant/agent-message-clarification-ui.spec.ts"
```

Expected: fails because the helper file does not exist.

- [ ] **Step 3: Implement helper**

Create `web/src/routes/(user)/assistant/agent-message-clarification-ui.ts`:

```ts
export type AgentClarificationReplyBlock = {
  kind: string;
  query: string;
};

export type AgentClarificationReplyChoice = {
  choiceRef: string;
  label: string;
};

export const buildAgentClarificationChoiceReply = (
  block: AgentClarificationReplyBlock,
  choice: AgentClarificationReplyChoice,
) => `Use ${choice.choiceRef} for ${block.kind} "${block.query}" (${choice.label}).`;

export const getAgentClarificationInitials = (label: string) => {
  const words = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  const initials = words.map((word) => word[0]?.toLocaleUpperCase()).join('');
  return initials || '?';
};
```

- [ ] **Step 4: Re-run helper tests and verify green**

Run:

```bash
pnpm --dir web exec vitest --run "src/routes/(user)/assistant/agent-message-clarification-ui.spec.ts"
```

Expected: selected tests pass.

- [ ] **Step 5: Write failing chat-panel rendering tests**

In `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`, add i18n mock keys:

```ts
assistant_clarification_choices_label: 'Clarification choices',
assistant_clarification_choice_thumbnail_alt: '{label} preview',
assistant_clarification_choice_unavailable: 'No preview',
assistant_clarification_send_choice: 'Use {label}',
```

Add tests:

```ts
const makeClarificationMessage = (): AgentMessageResponseDto => ({
  ...makeMessage('message-clarification', AgentMessageRole.Assistant, 'fallback'),
  content: {
    blocks: [
      {
        type: 'clarification',
        kind: 'person',
        query: 'Pierre',
        summary: 'I found two people named Pierre.',
        textFallback: 'Which Pierre should I use?',
        choices: [
          {
            choiceRef: 'choice:person:abcDEF1234567890',
            label: 'Pierre M.',
            description: '12 matching photos',
            thumbnailAssetId: '00000000-0000-4000-8000-000000000010',
          },
          {
            choiceRef: 'choice:person:defABC1234567890',
            label: 'Pierre',
            thumbnailAssetId: null,
          },
        ],
      },
    ],
  } as AgentMessageResponseDto['content'],
});

it('renders persisted clarification choices with thumbnails and text fallback', async () => {
  sdkMock.getAgentSessionMessages.mockResolvedValue([makeClarificationMessage()]);

  render(AgentSessionChatPanel, { props: { session } });

  expect(await screen.findByText('I found two people named Pierre.')).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Clarification choices' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Use Pierre M.' })).toBeInTheDocument();
  expect(screen.getByText('12 matching photos')).toBeInTheDocument();
  expect(screen.getByAltText('Pierre M. preview')).toHaveAttribute('src', expect.stringContaining('/api/assets/'));
  expect(screen.getByText('No preview')).toBeInTheDocument();
});

it('sends the safe choice ref as the next user message when a clarification choice is clicked', async () => {
  sdkMock.getAgentSessionMessages.mockResolvedValue([makeClarificationMessage()]);
  sdkMock.appendAgentSessionMessage.mockResolvedValue(
    makeMessage('reply', AgentMessageRole.User, 'Use choice:person:abcDEF1234567890 for person "Pierre" (Pierre M.).'),
  );

  render(AgentSessionChatPanel, { props: { session } });
  await fireEvent.click(await screen.findByRole('button', { name: 'Use Pierre M.' }));

  expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
    id: session.id,
    agentMessageCreateDto: {
      content: {
        blocks: [
          {
            type: AgentMessageTextBlockType.Text,
            text: 'Use choice:person:abcDEF1234567890 for person "Pierre" (Pierre M.).',
          },
        ],
      },
    },
  });
});
```

- [ ] **Step 6: Run chat-panel tests and verify red**

Run:

```bash
pnpm --dir web exec vitest --run "src/routes/(user)/assistant/agent-session-chat-panel.spec.ts" -t "clarification"
```

Expected: fails because the SDK does not include clarification block types yet and the component ignores non-text message blocks.

- [ ] **Step 7: Add i18n keys**

In `i18n/en.json`, add near the assistant chat/message keys:

```json
"assistant_clarification_choices_label": "Clarification choices",
"assistant_clarification_choice_thumbnail_alt": "{label} preview",
"assistant_clarification_choice_unavailable": "No preview",
"assistant_clarification_send_choice": "Use {label}",
```

- [ ] **Step 8: Update chat-panel rendering**

In `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`:

- import `getAssetMediaUrl` from `$lib/utils`;
- import `AssetMediaSize` and `AgentMessageClarificationBlockType` from `@immich/sdk`;
- import the helper functions from `./agent-message-clarification-ui`;
- replace the `textForMessage()`-only rendering path with block-aware rendering.

Add:

```ts
const hasRenderableMessageBlocks = (message: AgentMessageResponseDto) =>
  message.content.blocks.some(
    (block) =>
      block.type === AgentMessageTextBlockType.Text || block.type === AgentMessageClarificationBlockType.Clarification,
  );

const sendClarificationChoice = async (
  block: { kind: string; query: string },
  choice: { choiceRef: string; label: string },
) => {
  if (isResponsePending || composerDisabled) {
    return;
  }
  draft = buildAgentClarificationChoiceReply(block, choice);
  await sendMessage();
};
```

In the message article, render each block:

```svelte
{#each message.content.blocks as block, blockIndex (`${message.id}-${blockIndex}`)}
  {#if block.type === AgentMessageTextBlockType.Text}
    {#if message.role === AgentMessageRole.Assistant}
      {@render assistantMarkdown(parseAssistantMarkdown(block.text))}
    {:else}
      {block.text}
    {/if}
  {:else if message.role === AgentMessageRole.Assistant && block.type === AgentMessageClarificationBlockType.Clarification}
    <div class="space-y-3 whitespace-normal">
      <div>
        <p class="text-sm text-slate-950 dark:text-neutral-100">{block.summary}</p>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{block.textFallback}</p>
      </div>
      <div role="group" aria-label={$t('assistant_clarification_choices_label')} class="grid gap-2">
        {#each block.choices as choice (choice.choiceRef)}
          <button
            type="button"
            class="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white p-2 text-left shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900"
            aria-label={$t('assistant_clarification_send_choice', { values: { label: choice.label } })}
            disabled={isResponsePending || composerDisabled}
            onclick={() => sendClarificationChoice(block, choice)}
          >
            <span class="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-neutral-800 dark:text-neutral-300">
              {#if choice.thumbnailAssetId}
                <img
                  class="size-full object-cover"
                  src={getAssetMediaUrl({ id: choice.thumbnailAssetId, size: AssetMediaSize.Thumbnail })}
                  alt={$t('assistant_clarification_choice_thumbnail_alt', { values: { label: choice.label } })}
                  loading="lazy"
                  draggable="false"
                />
              {:else}
                <span aria-hidden="true">{getAgentClarificationInitials(choice.label)}</span>
                <span class="sr-only">{$t('assistant_clarification_choice_unavailable')}</span>
              {/if}
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium text-slate-950 dark:text-neutral-50">{choice.label}</span>
              {#if choice.description}
                <span class="block truncate text-xs text-gray-500 dark:text-gray-400">{choice.description}</span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
{/each}
```

Keep the existing article max-width and role behavior. Do not render choice refs visibly.

- [ ] **Step 9: Regenerate OpenAPI TypeScript SDK**

Run:

```bash
pnpm --dir server build
pnpm --dir server run sync:open-api
make open-api-typescript
```

Expected: generated OpenAPI and TypeScript SDK include `AgentMessageClarificationBlock`, `AgentMessageClarificationBlockType`, `AgentMessageClarificationChoice`, `AgentChoiceRef`, and `choiceRefs`.

- [ ] **Step 10: Re-run chat-panel tests and verify green**

Run:

```bash
pnpm --dir web exec vitest --run "src/routes/(user)/assistant/agent-message-clarification-ui.spec.ts" "src/routes/(user)/assistant/agent-session-chat-panel.spec.ts" -t "clarification"
```

Expected: selected web tests pass.

## Task 4: Full Slice Verification

**Files:**

- All files from Tasks 1-3.

- [ ] **Step 1: Run server verification**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-message.dto.spec.ts src/repositories/agent-runner.repository.spec.ts src/dtos/agent-asset-source.dto.spec.ts src/dtos/agent-tool.dto.spec.ts src/services/agent-asset-search-filter-resolver.service.spec.ts
pnpm --dir server run check
```

Expected: all selected server tests and TypeScript check pass.

- [ ] **Step 2: Run web verification**

Run:

```bash
pnpm --dir web exec vitest --run "src/routes/(user)/assistant/agent-message-clarification-ui.spec.ts" "src/routes/(user)/assistant/agent-session-chat-panel.spec.ts"
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
```

Expected: selected web tests and checks pass.

- [ ] **Step 3: Verify generated SDK drift**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Git status includes only Slice 10 files and generated SDK/OpenAPI artifacts.

## Task 5: Review Gates, Commit, And Push

**Files:**

- Modify: `docs/superpowers/plans/2026-05-23-pi-agent-declarative-planning-sources-slice-10.md`
- All Slice 10 source/test/generated files.

- [ ] **Step 1: Run spec-compliance review**

Dispatch a review subagent with this prompt:

```text
Spec-compliance review for Slice 10. Review the uncommitted changes in /home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm against docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md Slice 10 and docs/superpowers/plans/2026-05-23-pi-agent-declarative-planning-sources-slice-10.md. Focus on whether clarification blocks render ambiguous choices with optional thumbnails, choice refs avoid raw internal IDs, selected choice refs can be reused in the next declarative source-aware tool call, reload is preserved through persisted message content, text-only fallback works, and the changes avoid Slice 11 prompt/docs and Slice 12 activity scope. Do not edit files. Return APPROVED or CHANGES_REQUESTED with file/line findings and verification commands.
```

- [ ] **Step 2: Run code-quality review**

Dispatch a separate review subagent with this prompt:

```text
Code-quality review for Slice 10. Review the uncommitted changes in /home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm for bugs, runtime issues, bad Zod validation, unsafe choice-ref generation, stale generated SDK artifacts, Svelte rendering regressions, brittle tests, and accessibility issues. Focus on server message DTOs, runner stream validation, declarative resolver choiceRefs, generated OpenAPI TypeScript SDK, and assistant chat clarification rendering. Do not edit files. Return APPROVED or CHANGES_REQUESTED with concrete file/line findings and commands/results.
```

- [ ] **Step 3: Fix review findings**

If either review returns `CHANGES_REQUESTED`, apply the smallest fix, re-run the affected tests from Task 4, and repeat both review prompts until both return `APPROVED`.

- [ ] **Step 4: Commit Slice 10**

Run:

```bash
git add docs/superpowers/plans/2026-05-23-pi-agent-declarative-planning-sources-slice-10.md \
  server/src/dtos/agent-message.dto.ts \
  server/src/types/agent-message.types.ts \
  server/src/dtos/agent-message.dto.spec.ts \
  server/src/repositories/agent-runner.repository.ts \
  server/src/repositories/agent-runner.repository.spec.ts \
  server/src/types/agent-tool.types.ts \
  server/src/dtos/agent-tool.dto.ts \
  server/src/dtos/agent-tool.dto.spec.ts \
  server/src/types/agent-asset-source.types.ts \
  server/src/dtos/agent-asset-source.dto.ts \
  server/src/dtos/agent-asset-source.dto.spec.ts \
  server/src/services/agent-asset-search-filter-resolver.service.ts \
  server/src/services/agent-asset-search-filter-resolver.service.spec.ts \
  open-api/immich-openapi-specs.json \
  open-api/typescript-sdk/src/fetch-client.ts \
  open-api/typescript-sdk/build/fetch-client.js \
  open-api/typescript-sdk/build/fetch-client.d.ts \
  web/src/routes/\(user\)/assistant/agent-message-clarification-ui.ts \
  web/src/routes/\(user\)/assistant/agent-message-clarification-ui.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts \
  i18n/en.json
git commit -m "feat: render Pi clarification choices"
```

- [ ] **Step 5: Push Slice 10**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` is pushed.

## Plan Review

- Slice 10 TDD is explicit: every server, resolver, and web behavior starts with a failing test and expected red command.
- All Slice 10 spec edge cases are covered: ambiguous people choices, optional thumbnails, safe choice refs, follow-up tool calls, reload persistence, and text-only fallback.
- The plan avoids Slice 11 broad prompt/docs work except required generated OpenAPI TypeScript SDK artifacts for web compilation.
- The plan avoids Slice 12 activity/observability polish.
