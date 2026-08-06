# Slice I3 — `person.merge` op + `merge_people` workflow

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-reorg-sharing-people-design.md` (Phase I3).

A person-targeted reviewable op `person.merge` (kept person + source person ids), wrapping
`PersonService.mergePerson`, and a `merge_people` workflow. **High risk + irreversibility
disclosure** (faces reassigned, source person deleted; not cleanly undoable). Reuses the
`managePeople` scope (I2). This is the final slice; mirror I2's `person.update` op closely.

## Reference patterns (mirror)

- Op schema: I2's `personUpdateOperationSchema` (Person target, `validatePersonTarget`,
  `targetId` + payload) — mirror with a merge payload + High risk.
- Apply: I2's `applyPersonUpdateOperation` — mirror, calling `personService.mergePerson`.
- Scope: I2's `managePeople` check in `validateWriteScope` — EXTEND it to also cover
  `PersonMerge` (one combined condition).
- Workflow + resolution: I2's `person-resolver.mjs` + `rename-person.mjs`; the two-person
  (sequential) resolution mirrors `manage-space-members.mjs`'s two-stage continuation.
- `PersonService.mergePerson(auth, id, { ids })` (person.service.ts ~1174): merges
  `sourcePersonIds` INTO `id` (the kept person).

## Part A — Server

### A1. enum

`src/enum.ts`: `AgentOperationType.PersonMerge = 'person.merge'`.

### A2. `src/dtos/agent-operation.dto.ts`

- `personMergePayloadSchema = z.strictObject({ sourcePersonIds: z.array(uuid).min(1).max(50) })`.
- `personMergeOperationSchema` (mirror `personUpdateOperationSchema`):
  `{ type: literal(PersonMerge), summary, targetKind: PersonTargetKindSchema, targetId: uuid.optional(), riskLevel: default High, enabled, payload: personMergePayloadSchema }`
  `.superRefine((op, ctx) => { validatePersonTarget(op, ctx); if (op.targetId && op.payload?.sourcePersonIds?.includes(op.targetId)) ctx.addIssue({ ... 'cannot merge a person into itself' }); })`.
- Add to `AgentGalleryOperationInputSchema` union (next to `personUpdateOperationSchema`).

### A3. `src/services/agent-operation-plan.service.ts`

- `validateWriteScope`: extend the managePeople gate →
  `if ((type === AgentOperationType.PersonUpdate || type === AgentOperationType.PersonMerge) && !writeScope.managePeople) throw …`.
- Apply switch: `case AgentOperationType.PersonMerge: return this.applyPersonMergeOperation(auth, operation);`.
- `applyPersonMergeOperation`:
  ```ts
  const payload = this.requireObjectPayload(operation.payload) as { sourcePersonIds: string[] };
  await this.personService.mergePerson(auth, operation.targetId as string, { ids: payload.sourcePersonIds });
  return this.appliedOperation(operation.id, {
    personId: operation.targetId,
    mergedPersonIds: payload.sourcePersonIds,
  });
  ```

### A4. Server unit tests (RED first)

- `agent-operation.dto.spec.ts`: accepts a valid `person.merge` op (Person target + targetId +
  `sourcePersonIds`); rejects empty `sourcePersonIds`; rejects self-merge
  (`targetId ∈ sourcePersonIds`); rejects an `assetSource`; default risk High.
- `agent-operation-plan.service.spec.ts`: apply calls
  `personService.mergePerson(auth, <targetId>, { ids: <sourcePersonIds> })` (mock asserts
  shape); `managePeople: false` → propose blocked AND apply blocked; `true` → allowed; risk High.

(No `agent-session.service.spec.ts` change — `managePeople` already snapshot-tested in I2.)

## Part B — agent-runner

### B1. `workflows/merge-people.mjs` (`merge_people`)

- Patterns: `merge <A> into <B>`, `merge <A> and <B>`. (For "and", ask which to keep, OR keep
  the SECOND by convention — pick the convention: keep the LAST-named, document it.) For
  "into", keep = B (the "into" target), source = A.
- Resolve BOTH via the shared `person-resolver` (sequential, mirroring
  `manage-space-members.mjs`'s two-stage: resolve the source A first; ambiguous → continuation;
  then resolve the kept B; ambiguous → continuation). not_found on either → needsInput.
- Same-person guard: if A and B resolve to the same personId → decline ("those are the same
  person").
- Propose via `proposeAlbumOperations`:
  `[{ type: 'person.merge', summary: 'Merge … (irreversible)', targetKind: 'person', targetId: keepPersonId, riskLevel: 'high', payload: { sourcePersonIds: [sourcePersonId] } }]`.
- `gatePlanResult` success text DISCLOSES irreversibility ("This permanently merges … and cannot
  be undone — review before applying."); `successSummary { workflowKind: 'merge_people',
keepName, mergeName }`.

### B2. tests `merge-people.test.mjs`

Mirror `manage-space-members.test.mjs` + the resolver branches: identity; match for "into" and
"and" forms; "merge these two people" (no names) → needsInput; decline cross-intents; run:
both matched → person.merge op (exact payload: targetId=keep, sourcePersonIds=[source], risk
high, no raw face data); A ambiguous → continuation; B ambiguous → continuation; either
not_found → needsInput; same-person → decline; plan error → failed; success copy discloses
irreversibility + summary.

### B3. registry + manifest + evals

- `registry.mjs`: register `mergePeopleWorkflow` with the other people workflows (disjoint
  `merge` verb → order free). Ordering comment. Handle `disambiguation.test.mjs` gate.
- `manifest.mjs`: entry (`flow: 'hybrid'`, `planTool: 'proposeAlbumOperations'`,
  `requiredReadTools: ['searchPeople']`, `supportsContinuation: true`, matrixRow capability
  "Merge people", tier "Solid now"). Regenerate `manifest.generated.json`.
- evals:
  - `classification-recall.mjs`: `recall.person.merge` ("merge Alejandra into Karina" →
    `merge_people`, slots survive).
  - `slot-fidelity.mjs`: `slots.person.merge` (keep + merge slots).
  - `classification-negatives.mjs`: `neg.person.merge-nonames` is a run-time needs*input not a
    routing negative; instead add a negative that "merge duplicate photos" / "merge the albums"
    does NOT route to `merge_people` (it has no person object) — assert `none`/`cleanup*\*`.
  - `l3-readonly.mjs`: `l3.recall.person.merge` (routing). Plan-proposed: VisualOrganizer grants
    `managePeople`, so add `l3.plan.person.merge` with `planProposed: SEEDED ? true : undefined`
    (data-dependent: needs two resolvable people). The read-only audit is LOAD-BEARING here —
    merge is irreversible, so the audit must confirm the plan was proposed and NEVER applied.

## Part C — regen + verify

1. `pnpm -C server build`.
2. `pnpm -C server sync:open-api && make open-api` (TS + Dart). VERIFY `person.merge` lands in
   BOTH SDKs (grep `person.merge` / `personPeriodMerge` under mobile/openapi). `make
open-api-dart` if needed (Java 21).
3. `pnpm -C server test -- --run src/services/agent-operation-plan.service.spec.ts src/dtos/agent-operation.dto.spec.ts` → GREEN.
4. `cd agent-runner && node --test 'src/**/*.test.mjs'` → GREEN, count up.
5. `make check-server`, `make lint-server`, `make check-web` → green.
6. Server prettier only on edited server `.ts`. Never on `agent-runner/**`.

## Commit

```bash
git add server/ agent-runner/ open-api/ mobile/openapi/ docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md docs/superpowers/plans/2026-06-05-pi-agent-reorg-sharing-people-slice-6-merge-people.md web/
git commit -m "feat(agent): person.merge op + merge_people workflow (I3) — High-risk irreversible merge"
```

## Done when

- `person.merge` op parses (Person target, sourcePersonIds), rejects self-merge, applies to
  `PersonService.mergePerson`, gated on `managePeople`, **High risk**.
- `merge_people` routes, resolves both people (ambiguous → durable continuation; not_found →
  ask; same-person → decline), proposes with an irreversibility disclosure.
- Server + agent-runner suites green; build/check/lint/web green; OpenAPI TS + Dart regenerated
  (verified) and committed.

## Out of scope

- Face reassignment ("this face is actually Bob"). Multi-way merge UX beyond A-into-B.
