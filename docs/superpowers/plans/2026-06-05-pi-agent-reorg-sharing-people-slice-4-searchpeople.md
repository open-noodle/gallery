# Slice I1 — `searchPeople` read tool (people resolution foundation)

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-reorg-sharing-people-design.md` (Phase I1).

A new scrubbed read tool that resolves a person NAME → id, returning
`matched / ambiguous / not_found`. **Mirror `resolveLocation` at every wiring site.** Backed by
the EXISTING `PersonRepository.getByName(userId, name, { withHidden })` (trigram search, line 549) — **no new repository query, no new medium test** (getByName is already covered). This
slice is server + contract-fixtures only; the workflows that consume it ship in I2/I3.

## Reference: `resolveLocation` wiring sites (mirror each for `searchPeople`)

- `src/enum.ts` — `AgentToolName.ResolveLocation`.
- `src/types/agent-tool.types.ts` — `AgentResolveLocationResult` / `…Choice` (lines ~420–430).
- `src/dtos/agent-tool.dto.ts` — request schema (~692), `AgentReadToolRequestSchemas` registry
  (~713/728), result schema (~1303–1330), response schema (~1332–1343).
- `src/services/agent-tool.service.ts` — `mapRepository` injection (~263), `resolveLocation`
  method (~308), `resolveLocationDescriptor` (~1542), `decideLocation` (~1583), resume switch
  case (~494).
- `src/services/agent-mcp-tool-registry.service.ts` — registration (~216).
- `src/services/agent-mcp-tool-contract.service.ts` — contract entry (description + examples).

## Part A — Server

### A1. enum + types

- `src/enum.ts`: `AgentToolName.SearchPeople = 'searchPeople'`.
- `src/types/agent-tool.types.ts`: add
  ```ts
  export type AgentSearchPeopleChoice = { personId: string; name: string; thumbnailAssetId: string | null };
  export type AgentSearchPeopleResult =
    | { status: 'not_found' }
    | { status: 'matched'; personId: string; name: string; thumbnailAssetId: string | null }
    | { status: 'ambiguous'; choices: AgentSearchPeopleChoice[] };
  ```

### A2. DTO + schemas (`src/dtos/agent-tool.dto.ts`)

- Request schema (mirror `AgentResolveLocationToolRequestSchema` ~692): a single `name`
  string field (`z.string().trim().min(1).max(200).optional()` — optional so the retry/resume
  path works like resolveLocation's `query`), plus the shared `toolCallId`. Register in
  `AgentReadToolRequestSchemas` under `[AgentToolName.SearchPeople]`.
- Result schema (mirror `AgentResolveLocationResultSchema` ~1312): discriminated on `status`
  with `not_found` / `matched` ({ personId, name, thumbnailAssetId nullable }) / `ambiguous`
  ({ choices: array(...).max(5) }).
- Response schema (mirror `AgentResolveLocationToolResponseSchema` ~1332): success wraps
  `{ people: AgentSearchPeopleResultSchema }` (mirror the `{ location: … }` wrapper).
- Export `AgentSearchPeopleToolRequestDto` / `AgentSearchPeopleToolResponseDto`.

### A3. `src/services/agent-tool.service.ts`

- Inject `private readonly personRepository: PersonRepository` (import from
  `src/repositories/person.repository`) next to `mapRepository`.
- `searchPeople(auth, sessionId, dto)` → `this.runReadTool(auth, sessionId, dto, this.searchPeopleDescriptor())` (mirror `resolveLocation` ~308).
- `searchPeopleDescriptor()` (mirror `resolveLocationDescriptor` ~1542):
  - `toolName: AgentToolName.SearchPeople`, `dataClass: AgentToolDataClass.Metadata`,
    limits/counts/validateAccess all mirror resolveLocation (count 0, no access gate — owner
    scoping is enforced by getByName's `ownerId` filter).
  - `execute`: `const name = request.name ?? ''; if (!name) return { people: { status: 'not_found' } };`
    `const rows = await this.personRepository.getByName(auth.user.id, name, { withHidden: false });`
    `return { people: this.decidePeople(rows, name) };`
  - `responseSummary` / `responseMetadata` mirror resolveLocation (status-based).
- `decidePeople(rows, query)` (mirror `decideLocation`):
  - `if (rows.length === 0) return { status: 'not_found' };`
  - Normalize for exact match: `const norm = (s) => s.trim().toLowerCase();`
  - `const exact = rows.filter((r) => norm(r.name) === norm(query));`
  - `if (exact.length === 1) return { status: 'matched', personId: exact[0].id, name: exact[0].name, thumbnailAssetId: exact[0].faceAssetId };`
  - `if (exact.length > 1) return ambiguous(exact.slice(0, 5));`
  - else (fuzzy candidates only): `return ambiguous(rows.slice(0, 5));`
  - where `ambiguous(list) = { status: 'ambiguous', choices: list.map((r) => ({ personId: r.id, name: r.name, thumbnailAssetId: r.faceAssetId })) }`.
  - **Scrubbed**: only `personId`, `name`, `faceAssetId` (an asset id, NOT `thumbnailPath`). No
    embeddings, no file paths.
- Resume switch (~494): add `case AgentToolName.SearchPeople: { return this.searchPeople(auth, session.id, { toolCallId: toolCall.id }); }`.

### A4. registry + contract

- `src/services/agent-mcp-tool-registry.service.ts` (~216): register `SearchPeople` with its
  request schema (mirror the `ResolveLocation` block).
- `src/services/agent-mcp-tool-contract.service.ts`: add a contract entry — name
  `searchPeople`, a description ("Resolve a person by name to an id; returns matched / ambiguous
  (candidate list) / not_found. Scrubbed: id, name, thumbnail asset id — no face data."), and
  request/response examples. Mirror the `resolveLocation` contract entry exactly in shape.

### A5. Server unit tests (RED first)

- `src/services/agent-tool.service.spec.ts` (mirror the `resolveLocation returns matched…`
  tests ~8351): mock `personRepository.getByName`:
  - single exact-name row → `matched` (personId/name/thumbnailAssetId).
  - two rows with the SAME exact name → `ambiguous` (2 choices).
  - rows that are only fuzzy matches (no exact) → `ambiguous` (≤5 choices).
  - `getByName` returns `[]` → `not_found`.
  - empty/absent `name` (retry path) → `not_found` without calling getByName.
  - scrubbed: assert the result contains NO `thumbnailPath`/`embedding` keys (only personId,
    name, thumbnailAssetId).
- `src/services/agent-mcp-tool-contract.service.spec.ts`: the contract now includes
  `searchPeople` with the expected shape (mirror the resolveLocation assertion).
- If `agent-mcp-tool-registry.service.spec.ts` has a secret-leak / completeness scan, update it
  to include `searchPeople` (H1 hit a similar guard).

Run `pnpm -C server test -- --run src/services/agent-tool.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts` → RED → implement → GREEN.

## Part B — agent-runner contract fixture

`agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`: add a `searchPeople`
handler so I2/I3 workflow tests can drive it. Config-gated like `resolveResults`:

```js
// in makeContractClient config: people = [], peopleResult (optional explicit result)
searchPeople: (args) => {
  const name = String(args?.name ?? '').trim();
  if (peopleResult !== undefined) return { people: peopleResult };
  if (!name) return { people: { status: 'not_found' } };
  const matches = people.filter((p) => p.name.toLowerCase() === name.toLowerCase());
  if (matches.length === 1) return { people: { status: 'matched', personId: matches[0].id, name: matches[0].name, thumbnailAssetId: matches[0].faceAssetId ?? null } };
  if (matches.length > 1) return { people: { status: 'ambiguous', choices: matches.map((p) => ({ personId: p.id, name: p.name, thumbnailAssetId: p.faceAssetId ?? null })) } };
  return { people: { status: 'not_found' } };
},
```

Add `people = []` and `peopleResult` to the `makeContractClient` config destructure. No new
agent-runner test file in this slice (the handler is exercised by I2/I3) — but add ONE small
test in a new `contract-fixtures.searchpeople.test.mjs` (or extend an existing fixtures test)
asserting the handler returns matched/ambiguous/not_found, so the fixture is covered now.

## Part C — regen + verify

1. `pnpm -C server build`.
2. `pnpm -C server sync:open-api && make open-api` (TS + Dart). VERIFY `searchPeople` lands in
   `open-api/typescript-sdk/src/fetch-client.ts` AND `mobile/openapi` (grep both). Run
   `make open-api-dart` explicitly if needed (Java 21 available).
3. `pnpm -C server test -- --run src/services/agent-tool.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts` → GREEN.
4. `cd agent-runner && node --test 'src/**/*.test.mjs'` → GREEN, count up.
5. `make check-server`, `make lint-server`, `make check-web` → green.
6. Server prettier only on edited server `.ts`. Never on `agent-runner/**`.

## Commit

```bash
git add server/ agent-runner/ open-api/ mobile/openapi/ docs/superpowers/plans/2026-06-05-pi-agent-reorg-sharing-people-slice-4-searchpeople.md
git commit -m "feat(agent): searchPeople read tool (I1) — name → person id resolution"
```

## Done when

- `searchPeople` is a registered read tool returning matched/ambiguous/not_found, owner-scoped,
  excludes hidden people, scrubbed to id/name/thumbnailAssetId.
- Server unit + contract tests green; agent-runner fixture handler covered; build/check/lint/web
  green; OpenAPI TS + Dart regenerated (verified) and committed.

## Out of scope

- Person-resolution helper + workflows (ship in I2/I3).
- `withHidden: true` (only the unhide path in I2 resolves hidden people — handled there via a
  separate getByName call with withHidden true).
