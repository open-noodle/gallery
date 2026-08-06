# Phase B — Forward geocoder (place name → coordinates) — impl-loop plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-capability-roadmap.md` (Phase B).
Branch: `explore/pi-agent-brainstorm`. Builds on shipped Phase A.

## Autonomous decisions (Open Contract Questions)

- **OQ-B1 (ranking + ambiguity).** `geodata_places` has **no population column** (verified). Rank purely by
  trigram similarity. Forward lookup: `WHERE f_unaccent(name) % f_unaccent($q)` ordered by
  `similarity(f_unaccent(name), f_unaccent($q)) DESC, char_length(name) ASC, population? n/a`, limit 25, then
  dedupe to distinct `(name, admin1Name, countryCode)` places. Decision logic (in the **service**, fed by repo rows):
  - `not_found` when no rows or best similarity `< 0.30`.
  - `matched` when the best distinct place's similarity `>= 0.30` AND it is unambiguous: either exactly one
    distinct place survives, OR the top distinct place's similarity exceeds the 2nd distinct place by `>= 0.15`.
  - `ambiguous` otherwise → up to 5 `choices`, each labelled `"<name>, <admin1Name?>, <countryCode>"` with its
    own lat/lng so a follow-up can pick one.
- **OQ-B2 (tool shape).** A **dedicated `resolveLocation` MCP read tool** mirroring `resolveAssetSearchFilters`
  (cleaner than overloading the search-filter tool).

## Integration map (current code — verified)

- Read-tool template `resolveAssetSearchFilters` end-to-end:
  - enum: `server/src/enum.ts:107` `ResolveAssetSearchFilters = 'resolveAssetSearchFilters'` in `enum AgentToolName` (102–127).
  - registry: `server/src/services/agent-mcp-tool-registry.service.ts:216-220` (read-tools array, `schema` from `AgentReadToolRequestSchemas`).
  - handler: `server/src/services/agent-tool.service.ts:295` method, dispatch case `:478`, descriptor `:1474`.
  - DTOs: `server/src/dtos/agent-tool.dto.ts` request `:543-600`, schema-map entry `:696`, response `:1124-1138`, request Dto class `:1300`, response Dto `:1339`.
  - contract: `server/src/services/agent-mcp-tool-contract.service.ts:846` object + `:1244` list entry.
  - docs: `server/src/services/agent-mcp-docs.service.ts` (`AGENT_MCP_GENERATED_DOC_RELATIVE_PATH = 'docs/superpowers/generated/pi-agent-mcp-tools.md'`); sync via `server/src/bin/sync-agent-mcp-docs.ts`.
- Geo: `server/src/repositories/map.repository.ts` — concrete `class MapRepository` (no interface file), `reverseGeocode(point)` at `:228`. GIN trigram index `f_unaccent(name) gin_trgm_ops` exists (`:450`). Columns: `name, latitude, longitude, countryCode, admin1Name, admin2Name, alternateNames`.
- Metadata workflow: `agent-runner/src/strict-workflows/workflows/update-asset-metadata.mjs` `LOCATION_RE` `:51-52`, parse `:87-89`, validate `:177-180`.
- Op payload: `server/src/dtos/agent-operation.dto.ts` `assetUpdateMetadataPayloadShape:442` (lat `:464`, lng `:469`), both-required refine `:500`, `updateMetadataOperationSchema:554`.

## Slice B1 — `resolveLocation` server read tool (TDD)

**Goal.** A `geodata_places` forward-lookup repo method + a `resolveLocation(query)` read tool returning
`{ status: 'matched'|'ambiguous'|'not_found', latitude?, longitude?, label?, choices? }`.

### Tests first (expected red)

1. `server/src/repositories/map.repository.spec.ts` (or a **medium** test
   `server/test/medium/specs/...` if the repo method needs a real DB) — repo method `searchPlaces(query, limit)`:
   - Add a focused **medium** test that INSERTs a handful of `geodata_places` rows (Paris/FR, Paris/US-TX,
     Tokyo/JP, accented `Zürich`) and asserts: `searchPlaces('Paris')` returns both Paris rows ordered by
     similarity then name length; `searchPlaces('Tokyo')` returns Tokyo; `searchPlaces('Pariss')` (fuzzy) still
     matches Paris via trigram; `searchPlaces('zurich')` matches `Zürich` (unaccent); `searchPlaces('zzzqqq')`
     returns `[]`. Use the medium harness (`newMediumService`/`getRepository`) — the `geodata_places` table
     exists in the test schema even when empty, so fixture INSERTs are safe. If `MapRepository` is not yet
     registered in `test/medium.factory.ts`, register it (simple `new MapRepository(db)`).
2. `server/src/services/agent-tool.service.spec.ts` — handler `resolveLocation`:
   - matched: repo returns a single strong Paris row → `{ status:'matched', latitude, longitude, label:'Paris, Île-de-France, FR' }`.
   - ambiguous: repo returns two top places with near-equal similarity → `{ status:'ambiguous', choices:[...] }` (≤5, each with lat/lng+label).
   - not_found: repo returns `[]` → `{ status:'not_found' }`.
   - fuzzy: 'Pariss' → repo returns Paris rows → matched.
   - empty/whitespace query → `not_found` (or validation error — assert the chosen behavior; prefer `not_found`).
   - similarity below 0.30 floor → `not_found` even if a row is returned.
   - gap rule: top sim 0.95 vs 2nd 0.50 → matched; 1.0 vs 1.0 (two exact Paris) → ambiguous.

Run red: `pnpm -C server test -- --run src/services/agent-tool.service.spec.ts src/repositories/map.repository.spec.ts` (and the medium spec via `pnpm -C server test:medium`). Assert real errors (method/tool missing).

### Implementation (smallest green)

- `MapRepository.searchPlaces(query: string, limit = 25)`: Kysely query on `geodata_places`,
  `where(sql`f_unaccent(name) % f_unaccent(${query})`)`, select name/latitude/longitude/countryCode/admin1Name/
  admin2Name and `sql<number>`similarity(f_unaccent(name), f_unaccent(${query}))`.as('similarity')`,
  order by similarity desc, char_length(name) asc, limit. Decorate `@GenerateSqlQueries()` if the repo uses it; run `make sql` if so.
- enum `AgentToolName.ResolveLocation = 'resolveLocation'` (`server/src/enum.ts`).
- DTOs in `agent-tool.dto.ts`: `AgentResolveLocationToolRequestSchema` `{ query: z.string().trim().min(1) }`
  (+ map entry in `AgentReadToolRequestSchemas`), `AgentResolveLocationToolResponseSchema`
  `{ status: enum, latitude?, longitude?, label?, choices?: [{ latitude, longitude, label, countryCode }] }`,
  request/response Dto classes.
- Handler `resolveLocation(auth, sessionId, dto)` in `agent-tool.service.ts` implementing the decision logic
  above (dedupe distinct `(name, admin1Name, countryCode)`, thresholds 0.30 / 0.15 gap, ≤5 choices, labels).
  Add dispatch case + descriptor.
- Register in `agent-mcp-tool-registry.service.ts` read-tools array.
- Contract object in `agent-mcp-tool-contract.service.ts` + list entry (title, description, usage,
  argumentModes, ≥2 examples: matched + ambiguous).
- Regen docs/SDK: `pnpm -C server build && node ...sync-agent-mcp-docs` (or the documented sync) +
  `pnpm sync:open-api && make open-api`. Regen capability-matrix generated block if it references read tools.

### Edge cases (named tests, above)

accented names; alternate names (best-effort — primary `name` match is enough for MVP, note alternateNames as a
follow-up); empty query → not_found; very small towns absent → not_found; two exact homonyms → ambiguous.

### Gates + commit

`make lint-server && make check-server && make check-web`; `pnpm -C server test` green; OpenAPI/SDK regenerated.
Commit `feat(agent): resolveLocation forward geocode read tool (B1)`; push.

## Slice B2 — `update_asset_metadata` accepts place names (agent-runner, TDD)

**Goal.** Parse "set location/place on `<source>` to `<placeName>`"; in `run`, call `resolveLocation`; matched →
inject lat/lng into `asset.updateMetadata`; ambiguous/not_found → `needsInput`.

### Tests first (`update-asset-metadata.test.mjs`)

- match accepts: "set the location on my newest 20 to Paris", "set place on these to Tokyo".
- existing coordinate path ("...to lat 48.8 and lon 2.3") still parses unchanged (regression).
- run: place 'Paris' → client.resolveLocation stub returns matched → proposes `asset.updateMetadata` with the
  resolved lat/lng over the resolved selection.
- run: 'Parisxyz' → resolveLocation not_found → `needs_input` disclosing the place wasn't found.
- run: ambiguous → resolveLocation ambiguous → `needs_input` listing choices.
- place + explicit coords both given → prefer explicit coords (documented decision); don't call resolveLocation.
- place name that is also a person/album noun → don't misroute (negative: "set Paris as the album cover" must
  NOT route here — covered by existing routing, add a negative match test).
- empty selection → needs_input.

Run red: `node --test agent-runner/src/strict-workflows/workflows/update-asset-metadata.test.mjs` (via mise PATH).

### Implementation

- Add a `PLACE_RE` (e.g. `set (?:the )?(?:location|place) on <source> to <placeName>`), parse to
  `{ field:'location', placeName, source }`. In `run`, when `placeName` present and no explicit coords, call
  `client.resolveLocation({ query: placeName })`; matched → set latitude/longitude on the updateMetadata payload;
  ambiguous/not_found → `needsInput`. Keep the numeric path intact (prefer explicit coords if both).
- Add `resolveLocation` to the workflow's `requiredReadTools` in `manifest.mjs` if such metadata is tracked.

### L1 (required — routing/slot change)

- Add recall scenarios in `agent-runner/eval/scenarios/classification-recall.mjs`: "set the location on my newest
  20 to Paris" → `update_asset_metadata`; keep the existing coordinate-path recall.
- Add a negative protecting neighbors (place-name source must not steal album/space routing).
- `node agent-runner/eval/run.mjs --runs 5`; if regressions are only the new intended rows, re-seed
  `node agent-runner/eval/run.mjs --accept`. Baseline must end at 100%.

### Gates + commit

agent-runner `node --test` green; L1 100% re-seeded. Commit `feat(agent): place-name location edits via resolveLocation (B2)`; push.

## Slice B3 — Hardening: matrix + L3 scenarios

- Capability matrix (`docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md` + generated block via
  `server/src/bin/sync-agent-capabilities.ts`): move "Place-name-to-coordinate metadata edits" out of
  "Needs New MCP Tool"; note `resolveLocation` in read tools; update the metadata Core Capability row.
  Keep `agent-capability-matrix.spec.ts` green (regen generated block + update the line-~56 "Next expansion
  candidates" assertion — it currently names "a forward geocoder", which is now shipped, so pick the next
  candidate from the spec, e.g. screenshots/sharing).
- L3 scenarios in `agent-runner/eval/scenarios/l3-readonly.mjs`: `l3.recall.geocode` ("set my newest 20 to Paris"
  → `update_asset_metadata`) and a propose-only `l3.plan.geocode` gated `planProposed: config.l3.seeded ? true : undefined`.
  (Actual L3 run is deferred to the consolidated end-of-roadmap RC + run.)

### Gates + commit

`make check-server` (matrix spec), agent-runner tests green. Commit `test(agent): geocode matrix + L3 scenarios (B3)`; push.
