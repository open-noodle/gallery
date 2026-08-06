# Slice 2 — Preset-gated tool listing

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-prompt-token-optimization-design.md` (Slice 2).
Make `tools/list` session-aware so tools the session can never use are hidden (smaller catalog
for restricted presets + honest advertising). Call-time enforcement stays (defense in depth).
Server vitest. TDD.

## Reference (verified)

- `AgentMcpToolRegistryService.listTools()` (`agent-mcp-tool-registry.service.ts:419`) — fixed
  26-tool array, cloned per call.
- `AgentMcpService.handle(auth, sessionId, request)` (`agent-mcp.service.ts:103`) — for
  `tools/list` (line 120-122) returns `{ tools: this.toolRegistry.listTools() }`. It has
  `auth` + `sessionId` but does NOT currently resolve the session for the list path.
- Permission snapshot: `session.permissionPlanSnapshot` with `read.previews`, `read.originals`
  (`types/agent-session.types.ts:22-35`), `assetScope.sharedSpaces`. The owned-session getter
  used elsewhere (grep `getOwnedSession` in agent-mcp.service / agent-tool.service / the
  session repository) returns the session incl. `permissionPlanSnapshot`.

## Implementation

### 1. `AgentMcpToolRegistryService.listTools(snapshot?)`

Add an OPTIONAL `snapshot` param. **No arg → return all 26 tools** (preserves Slice 1's
`CATALOG_TOKENS_BASELINE` test). With a snapshot, filter out tools the session can never use:

```ts
listTools(snapshot?: AgentSessionPermissionSnapshot): AgentMcpToolDefinition[] {
  const cloned = this.tools.map((tool) => cloneTool(tool));
  if (!snapshot) return cloned;
  const drop = new Set<AgentToolName>();
  if (!snapshot.read.originals) drop.add(AgentToolName.ReadAssetOriginals);
  if (!snapshot.read.previews) drop.add(AgentToolName.ReadAssetPreviews);
  if (!snapshot.assetScope.sharedSpaces) {
    drop.add(AgentToolName.ListSpaces);
    drop.add(AgentToolName.ReadSpace);
    drop.add(AgentToolName.SearchUsers);
  }
  return cloned.filter((tool) => !drop.has(tool.name));
}
```

Import the snapshot type from `src/types/agent-session.types.ts`. The filtered list keeps the
original relative order (subset of the fixed array) → cache-stable per preset.

### 2. Thread the snapshot in `AgentMcpService.handle()` (tools/list path)

For `request.method === 'tools/list'`: resolve the session's snapshot and pass it:

```ts
const snapshot = (await (<ownedSessionGetter>(auth, sessionId)))?.permissionPlanSnapshot;
return { tools: this.toolRegistry.listTools(snapshot) };
```

Use the SAME owned-session resolution the call path already uses (find it — likely
`this.sessionService.getOwnedSession` / a repository getter). If resolution throws for an
invalid session, let it surface as it does for tool calls (don't silently fall back to the
full list — an unknown session shouldn't get tools).

## Tests (RED first)

`agent-mcp-tool-registry.service.spec.ts`:

- `listTools()` (no arg) still returns all 26 in order (baseline unchanged — Slice 1 test
  still green).
- `listTools(snapshot)` with a **Careful-like** snapshot (`read.originals:false`,
  `read.previews:false`, `assetScope.sharedSpaces:false`) → excludes
  `readAssetOriginals`, `readAssetPreviews`, `listSpaces`, `readSpace`, `searchUsers`; all
  other tools present; order preserved.
- `listTools(snapshot)` with a **LocalPowerUser-like** snapshot (all true) → all 26.
- Token-size: `estimateCatalogTokens(listTools(carefulSnapshot)).tokens < CATALOG_TOKENS_BASELINE`
  (import both from the Slice-1 helper). Assert the dropped tools' names are absent from the
  serialized payload.

`agent-mcp.service.spec.ts`:

- a `tools/list` request for a session with a restricted snapshot returns the filtered set
  (mock the session getter to return a snapshot); a full-access session returns all 26.
- regression: tool-CALL denial for `readAssetOriginals`/previews/space tools is unchanged
  (existing tests stay green).

Build the snapshot fixtures from the real preset definitions where practical (read
`agent-session.service.ts` presets) OR hand-build minimal snapshots with the three relevant
flags — either is fine; assert against the actual flags.

## Verify

```bash
pnpm -C server test -- --run src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp.service.spec.ts
make check-server && make lint-server
```

No OpenAPI change (no API DTO touched). No agent-runner change. Run server prettier on edited
server `.ts`.

## Commit

```bash
git add server/ docs/superpowers/plans/2026-06-05-pi-agent-token-opt-slice-2-preset-gating.md
git commit -m "feat(agent): preset-gate tools/list — hide unusable tools per session (token-opt slice 2)"
```

## Done when

- `tools/list` hides originals/previews/space tools for sessions that can't use them; full
  access still sees all 26; no-arg `listTools()` unchanged (Slice 1 baseline intact).
- Token-size for a restricted preset is measurably below baseline; gated tool names absent
  from the payload.
- Call-time enforcement unchanged (regression green). check-server + lint-server green.
- Report the Careful-preset catalog token count (vs the 52,350 baseline).
