# Slice I2 — `person.update` op + rename / birthdate / hide workflows

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-reorg-sharing-people-design.md` (Phase I2).

A new person-targeted reviewable op `person.update` (name / birthDate / isHidden), a new
`managePeople` write-scope, and three hybrid workflows (`rename_person`,
`set_person_birthdate`, `hide_person`) that resolve a person via the I1 `searchPeople` tool —
with durable candidate disambiguation reusing the Phase-D helper. **All reversible → Low risk.**

## Reference patterns (read + mirror)

- Op schema: `shareLinkCreateAlbumOperationSchema` (dto ~685, album-targeted, `targetId` +
  payload, `validateAlbumTarget`) — mirror it for a **Person** target.
- Apply: `applyShareLinkCreateAlbumOperation` (plan service ~3196 area) — mirror for person.
- Scope: `manageStacks` wiring from G2 (write-scope type + 3 presets + `validateWriteScope`).
- Disambiguation: `rename-or-describe-space.mjs` / `manage-space-members.mjs` (space candidate
  continuation via `candidate-disambiguation.mjs` — `buildCandidateContinuation` /
  `resumeFromCandidates`). Mirror the SPACE pick for a PERSON pick.
- Person service: `PersonService.update(auth, id, { name?, birthDate?, isHidden? })`
  (person.service.ts ~417). `PersonUpdateDto.birthDate` already rejects future dates.

## Part A — Server

### A1. enum + target kind

- `src/enum.ts`: `AgentOperationType.PersonUpdate = 'person.update'`; and add
  `AgentOperationTargetKind.Person = 'person'` to the target-kind enum (~193).

### A2. write-scope `managePeople`

Mirror `manageStacks` exactly: add `managePeople: boolean` to the write-scope type; add to
`legacyWriteScopeDefaults` (false), Careful (false), VisualOrganizer (**true**), LocalPowerUser
(**true**) in `agent-session.service.ts`.

### A3. `src/dtos/agent-operation.dto.ts`

- `personUpdatePayloadSchema` = `z.strictObject({ name: z.string().trim().min(1).max(852).optional(), birthDate: z.iso.date().nullable().optional().refine(future-check), isHidden: z.boolean().optional() }).superRefine(at-least-one-field)`. Match the `PersonUpdateDto` field semantics (read `src/dtos/person.dto.ts`: name length, birthDate is an ISO **date**, future rejected; reuse its constraints). Require ≥1 field (mirror `validateAssetUpdateMetadataPayload`).
- `PersonTargetKindSchema = z.literal(AgentOperationTargetKind.Person)` (mirror
  `ExistingAlbumTargetKindSchema` ~160).
- `validatePersonTarget(operation, ctx)` mirroring `validateAlbumTarget` (~999): require
  `targetKind === Person` and a non-empty `targetId` (the person id); forbid
  `assetSource`/`assetIds`/`assetSelectionHandleId`/`temporaryTargetId`.
- `personUpdateOperationSchema` (mirror `shareLinkCreateAlbumOperationSchema`):
  `{ type: literal(PersonUpdate), summary, targetKind: PersonTargetKindSchema, targetId: uuid.optional(), riskLevel: default Low, enabled, payload: personUpdatePayloadSchema }`
  `.superRefine(validatePersonTarget)`. Add to `AgentGalleryOperationInputSchema` union (~698).

### A4. `src/services/agent-operation-plan.service.ts`

- Inject `private readonly personService: PersonService` (import from
  `src/services/person.service`).
- `validateWriteScope` (~1955 area): add
  `if (type === AgentOperationType.PersonUpdate && !writeScope.managePeople) throw new BadRequestException('Agent permission policy does not allow managing people');`.
- Apply switch (~2811): `case AgentOperationType.PersonUpdate: return this.applyPersonUpdateOperation(auth, operation);`.
- `applyPersonUpdateOperation`:
  ```ts
  const payload = this.requireObjectPayload(operation.payload) as {
    name?: string;
    birthDate?: string | null;
    isHidden?: boolean;
  };
  await this.personService.update(auth, operation.targetId as string, {
    name: payload.name,
    birthDate: payload.birthDate,
    isHidden: payload.isHidden,
  });
  return this.appliedOperation(operation.id, { personId: operation.targetId });
  ```
  Confirm `PersonUpdateDto` accepts a partial `{ name? , birthDate?, isHidden? }` (it does —
  all optional). person.update is NOT a batch action → no `getAssetBatchWorkflow*` cases.

### A5. Server unit tests (RED first)

- `agent-operation.dto.spec.ts`: accepts a valid `person.update` op (Person target + targetId +
  payload with one field); rejects empty payload; rejects future `birthDate`; rejects an
  `assetSource`; default risk Low.
- `agent-operation-plan.service.spec.ts`: apply calls `personService.update(auth, <targetId>,
{ name | birthDate | isHidden })` (mock asserts shape; one test per field); `managePeople:
false` → propose blocked AND apply blocked (`/managing people/`); `true` → allowed.
- `agent-session.service.spec.ts`: preset snapshot `managePeople` true in VO+LPU, false in
  Careful + legacy default.

## Part B — agent-runner

### B1. shared person resolver `strict-workflows/person-resolver.mjs`

A helper `resolvePerson({ client, name, signal, nowMs, kind, extra })`:

- Calls `searchPeople({ name })`. Returns one of:
  - `{ status: 'matched', personId, name }`
  - `{ status: 'needs_input', text }` for not_found ("I couldn't find a person named "X".")
  - `{ status: 'candidates', continuation, text }` for ambiguous — build via
    `buildCandidateContinuation({ kind, candidates: choices.map(c => ({ id: c.personId, label: c.name })), nowMs, ...extra })` and a numbered-list prompt (mirror the space workflows' candidate copy).
- A companion `resumePersonFromCandidates(...)` mirroring the space `resumeFromCandidates` use,
  so a next-turn "the first one" / a name / a number resolves the pick. Mirror
  `rename-or-describe-space.mjs`'s continuation handling exactly.

Unit test `person-resolver.test.mjs`: matched / not_found / ambiguous(continuation) /
resume-by-ordinal / resume-by-name.

### B2. three workflows + tests

`workflows/rename-person.mjs` (`rename_person`), `workflows/set-person-birthdate.mjs`
(`set_person_birthdate`), `workflows/hide-person.mjs` (`hide_person`). Each:

- Regex match (see below), resolve the person via the shared resolver (ambiguous → candidate
  continuation; not_found → needs_input), then propose `person.update` via
  `proposeAlbumOperations`:
  `[{ type: 'person.update', summary, targetKind: 'person', targetId: personId, riskLevel: 'low', payload: {<field>} }]`.
- `gatePlanResult` success + `successSummary { workflowKind, personName, ... }`.

Patterns + payload:

- `rename_person`: `rename <person> to <newName>` → `payload: { name: newName }`. Decline album/
  space rename (require a person object, no `album`/`space` noun → those route to the existing
  rename workflows, which are ordered first).
- `set_person_birthdate`: `set <person>'s (birthday|birthdate|date of birth) to <date>` → parse
  `<date>` (ISO `YYYY-MM-DD`, or natural "May 1 1990" / "1 May 1990") → `payload: { birthDate }`.
  Unparseable/ambiguous/future → needsInput. (Reuse a small date parser; reject future dates.)
- `hide_person`: `hide <person>` → `payload: { isHidden: true }`; `unhide|show <person>` →
  `payload: { isHidden: false }`. For unhide, the resolver must find a HIDDEN person — pass a
  flag so the read tool path can include hidden (NOTE: I1's `searchPeople` excludes hidden; for
  unhide, EITHER add an optional `includeHidden` to the searchPeople request now, OR resolve
  unhide by name with a server tweak. SIMPLEST for this slice: add an optional
  `includeHidden: boolean` to the `searchPeople` request schema + descriptor (getByName
  withHidden) and have hide_person's unhide arm pass it. Add a server test for the
  includeHidden path. Keep withHidden:false the default.)

Tests per workflow mirror `rename-or-describe-space.test.mjs` + the resolver branches:
identity; match incl. cross-verb declines (album/space rename → no match; "hide the Family
album" → no match); parseSlots; run: matched → person.update op (exact payload, no raw face
data); ambiguous → candidate continuation; not_found → needsInput; date parsing matrix
(birthdate); unhide polarity; plan error → failed; success copy + summary.

### B3. registry + manifest + evals

- `registry.mjs`: register the three workflows; ordering — they require a person object and the
  literal verb (`rename … to`, `set …'s birthday`, `hide …`). Place AFTER
  `rename_or_describe_album`/`rename_or_describe_space` so container nouns win their refs. Add
  ordering comments. Handle the `disambiguation.test.mjs` gate (add routing cases).
- `manifest.mjs`: three entries (`flow: 'hybrid'`, `planTool: 'proposeAlbumOperations'`,
  `requiredReadTools: ['searchPeople']`, `supportsContinuation: true` for the durable pick,
  matrixRows). Regenerate `manifest.generated.json`.
- evals:
  - `classification-recall.mjs`: `recall.person.rename`, `recall.person.birthdate`,
    `recall.person.hide`, `recall.person.unhide` (each routes + slots survive).
  - `slot-fidelity.mjs`: `slots.person.rename` (`{ newName }`), `slots.person.birthdate`.
  - `classification-negatives.mjs`: `neg.person.rename-album` ("rename the Family album to X" →
    `none`/album), `neg.person.hide-album`.
  - `l3-readonly.mjs`: `l3.recall.person.rename` / `.birthdate` / `.hide` (routing). Plan-
    proposed: the eval preset (VisualOrganizer) grants `managePeople`, so these CAN propose
    live — add `l3.plan.person.rename` with `planProposed: SEEDED ? true : undefined`
    (data-dependent: needs a resolvable person). Read-only audit confirms nothing applied.

## Part C — regen + verify

1. `pnpm -C server build`.
2. `pnpm -C server sync:open-api && make open-api` (TS + Dart). VERIFY `person.update` +
   `AgentOperationTargetKind` `person` land in BOTH SDKs (grep `person.update` /
   `personPeriodUpdate` in mobile). `make open-api-dart` if needed (Java 21).
3. `pnpm -C server test -- --run src/services/agent-operation-plan.service.spec.ts src/services/agent-session.service.spec.ts src/services/agent-tool.service.spec.ts src/dtos/agent-operation.dto.spec.ts` → GREEN (agent-tool.service.spec covers the includeHidden path).
4. `cd agent-runner && node --test 'src/**/*.test.mjs'` → GREEN, count up.
5. `make check-server`, `make lint-server`, `make check-web` → green.
6. Server prettier only on edited server `.ts`. Never on `agent-runner/**`.

## Commit

```bash
git add server/ agent-runner/ open-api/ mobile/openapi/ docs/superpowers/plans/2026-06-05-pi-agent-reorg-sharing-people-slice-5-person-update.md
git commit -m "feat(agent): person.update op + rename/birthdate/hide workflows (I2) + managePeople scope"
```

## Done when

- `person.update` op parses (Person target), applies to `PersonService.update`, gated on
  `managePeople` at propose + apply, Low risk.
- The three workflows route, decline album/space rename, resolve a person (ambiguous →
  durable continuation; not_found → ask), and propose the correct single-field payload.
- includeHidden path proven (unhide resolves a hidden person).
- Server + agent-runner suites green; build/check/lint/web green; OpenAPI TS + Dart regenerated
  (verified) and committed.

## Out of scope

- `person.merge` (ships in I3). Face reassignment, isFavorite/color edits.
