# Pi Agent Metadata Trip Album Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Pi to handle metadata-only trip album requests by searching Gallery metadata, drafting album operations, and avoiding preview/original escalation.

**Architecture:** Use the existing Gallery MCP read tools and album operation plan tools. The runner system prompt becomes the behavioral contract for trip-album requests, while server MCP registry tests lock the metadata filter surface that makes the workflow possible. No new write tools are added; Gallery remains the only component that applies approved plans.

**Tech Stack:** Node test runner for `agent-runner`, NestJS/Vitest server unit tests, Gallery MCP tool registry, Pi runtime system prompt.

---

## Scope

This plan implements the approved design in `docs/superpowers/specs/2026-05-17-pi-agent-metadata-trip-album-design.md`.

In scope:

- Add runner prompt contract coverage for metadata-only trip album behavior.
- Update the Pi system prompt so trip album requests use metadata tools and end in `mcp_gallery_proposeAlbumOperations`.
- Ensure the MCP `searchAssets` tool advertises the existing trip-useful metadata filters.
- Keep previews and originals out of the metadata-only trip workflow.

Out of scope:

- New backend discovery tools.
- Direct write or apply tools exposed to Pi.
- Preview/original-based visual album selection.
- Tags, ratings, archive/delete, rotation, or metadata-edit operations.

## File Structure

- `agent-runner/src/pi-runtime.test.mjs` - runner prompt contract tests.
- `agent-runner/src/pi-runtime.mjs` - Pi system prompt behavior.
- `server/src/services/agent-mcp-tool-registry.service.spec.ts` - MCP tool metadata/schema contract tests.
- `server/src/services/agent-mcp-tool-registry.service.ts` - search tool description if the new registry test exposes missing wording.

Do not touch the unrelated untracked file `server/src/services/agent-runner-flow.integration.spec.ts`.

---

### Task 1: Add Metadata Trip Album Runner Prompt Contract

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`

- [ ] **Step 1: Write the failing prompt contract test**

In `agent-runner/src/pi-runtime.test.mjs`, in the existing test named `constructs the Pi resource loader with concrete runtime paths`, add these assertions after the existing assertion for `mcp_gallery_proposeAlbumOperations`:

```js
assert.equal(calls.loaders[0].systemPrompt.includes('metadata-only trip album requests'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes('use mcp_gallery_searchAssets with location and taken-date metadata'),
  true,
);
assert.equal(calls.loaders[0].systemPrompt.includes('use mcp_gallery_readAssetMetadata for candidate assets'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes('do not call mcp_gallery_readAssetPreviews or mcp_gallery_readAssetOriginals'),
  true,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('If a metadata-only trip search returns more than 250 candidate assets'),
  true,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('ask one concise follow-up question to narrow the date range or location'),
  true,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('A chat-only answer is not enough for album creation requests'),
  true,
);
```

- [ ] **Step 2: Run the runner prompt test and verify it fails**

Run:

```bash
pnpm --dir agent-runner exec node --test --test-name-pattern "constructs the Pi resource loader" src/pi-runtime.test.mjs
```

Expected: FAIL because the new trip-album prompt phrases are not present.

- [ ] **Step 3: Add the minimal prompt instructions**

In `agent-runner/src/pi-runtime.mjs`, add these entries to the `systemPrompt` array after the current line that starts `Use Gallery read tools to inspect`:

```js
  'For metadata-only trip album requests, use mcp_gallery_searchAssets with location and taken-date metadata, then use mcp_gallery_readAssetMetadata for candidate assets before planning.',
  'For metadata-only trip album requests, do not call mcp_gallery_readAssetPreviews or mcp_gallery_readAssetOriginals. If metadata is insufficient, ask one concise follow-up question instead of escalating to media reads.',
  'If a metadata-only trip search returns more than 250 candidate assets without a clearly bounded date range and location match, ask one concise follow-up question to narrow the date range or location before proposing operations.',
  'When a user asks you to create or fill an album and metadata candidates are found, call mcp_gallery_proposeAlbumOperations with album.create and album.addAssets operations. A chat-only answer is not enough for album creation requests.',
```

Keep the existing broader read-tool instruction intact. The broad instruction still allows preview/original tools for other workflows; the new trip-specific instruction narrows this workflow.

- [ ] **Step 4: Run the runner prompt test and verify it passes**

Run:

```bash
pnpm --dir agent-runner exec node --test --test-name-pattern "constructs the Pi resource loader" src/pi-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add agent-runner/src/pi-runtime.test.mjs agent-runner/src/pi-runtime.mjs
git commit -m "$(cat <<'EOF'
Teach Pi metadata trip album behavior
EOF
)"
```

---

### Task 2: Lock The MCP Metadata Filter Surface

**Files:**

- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`

- [ ] **Step 1: Write the failing or confirming registry test**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, add this test near the existing `tools/list` or tool definition tests:

```ts
it('advertises trip-album metadata filters on searchAssets', () => {
  const searchTool = sut.listTools().find((tool) => tool.name === AgentToolName.SearchAssets);

  expect(searchTool).toBeDefined();
  expect(searchTool?.description).toContain('date');
  expect(searchTool?.description).toContain('place');
  expect(searchTool?.inputSchema).toEqual(
    expect.objectContaining({
      properties: expect.objectContaining({
        filters: expect.objectContaining({
          properties: expect.objectContaining({
            takenAfter: expect.any(Object),
            takenBefore: expect.any(Object),
            city: expect.any(Object),
            state: expect.any(Object),
            country: expect.any(Object),
            isNotInAlbum: expect.any(Object),
          }),
        }),
        limit: expect.any(Object),
      }),
    }),
  );
});
```

If this test already passes without production changes, keep it as a contract test. If it fails only because the description lacks one of the words, apply Step 3. If it fails because the schema lacks filters, stop and investigate the DTO schema before changing the registry.

- [ ] **Step 2: Run the registry test**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs run src/services/agent-mcp-tool-registry.service.spec.ts -t 'trip-album metadata filters'
```

Expected: PASS if the existing search tool already exposes the needed filter schema. A description-only failure is acceptable in RED and should be fixed in Step 3.

- [ ] **Step 3: Update the search tool description only if the test failed on wording**

If Step 2 failed because the description did not include the expected trip-album concepts, update the `SearchAssets` definition in `server/src/services/agent-mcp-tool-registry.service.ts` to:

```ts
    description: `Search the photo library by taken date, place, city, state, country, camera metadata, favorites, media type, rating, tags, albums, whether assets are not in an album, and result limit.${approvedRequestInstruction}`,
```

Do not change the DTO schema in this task unless the investigation proves the existing filters are not present.

- [ ] **Step 4: Run the registry test again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs run src/services/agent-mcp-tool-registry.service.spec.ts -t 'trip-album metadata filters'
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

If only the spec changed:

```bash
git add server/src/services/agent-mcp-tool-registry.service.spec.ts
git commit -m "$(cat <<'EOF'
Cover Pi trip album metadata filters
EOF
)"
```

If the registry description also changed:

```bash
git add server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts
git commit -m "$(cat <<'EOF'
Cover Pi trip album metadata filters
EOF
)"
```

---

### Task 3: Run Focused Verification

**Files:**

- Verify: `agent-runner/src/pi-runtime.test.mjs`
- Verify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Verify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Run focused runner tests**

Run:

```bash
pnpm --dir agent-runner exec node --test --test-name-pattern "constructs the Pi resource loader|approval-required|approval context|multiple Pi text chunks|continues an existing runner session" src/pi-runtime.test.mjs src/server.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 2: Run focused MCP server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs run src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: all tests in both files pass.

- [ ] **Step 3: Check diff hygiene**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: `git diff --check` prints no output. `git status --short --branch` shows only intentional committed changes ahead of origin and the pre-existing untracked `server/src/services/agent-runner-flow.integration.spec.ts` if it is still present.

- [ ] **Step 4: Commit any verification-only fixes**

If Task 3 required test or implementation fixes, commit only those touched files:

```bash
git add agent-runner/src/pi-runtime.test.mjs agent-runner/src/pi-runtime.mjs server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts
git commit -m "$(cat <<'EOF'
Stabilize metadata trip album contracts
EOF
)"
```

If Task 3 required no file changes, do not create an empty commit.

## Self-Review

- Spec coverage: Task 1 covers metadata-only behavior, no preview/original escalation, proposal requirement, broad-result guard, and follow-up question behavior. Task 2 covers the existing metadata filter surface. Task 3 covers focused verification.
- Placeholder scan: no placeholder task remains; each code change has an exact snippet and command.
- Type consistency: all referenced tool names match existing `mcp_gallery_*` names and `AgentToolName.SearchAssets`.
