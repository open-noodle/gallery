# Slice 11 — e2e: manual flow + cross-engine invariant

Spec: §7, §8. Branch: `feat/face-manual-review`. Depends on slices 1-10.

File: `e2e/src/specs/web/face-cleanup.e2e-spec.ts` (the only e2e spec touching this feature). It is
`test.describe.serial`, so both tests land here together and **a failure early skips everything
after it** — when diagnosing, read the DOM snapshot in the `e2e-web-test-results` artifact and the
server logs in `e2e-web-docker-logs`, not the job stdout (which is Docker build output).

## Environment

Run against the **e2e stack on :2285**, never a `make dev` stack on :2283 — :2283 has been observed
serving 0-byte bodies, which surfaces as bogus "element not found" failures. Rebuild the stack rather
than reusing a stale one; BuildKit can serve a stale web layer, and the `immich-e2e` project is a
machine-wide singleton.

## Seeding gotcha (this has bitten this feature before)

`utils.createFace` links faces with `face_identity_face.source='manual'`
(`e2e/src/utils.ts:529-530`). The verdict layer **excludes human-placed faces from flagging**, so a
naively seeded face will not behave like a machine-clustered one. The existing `seedFlaggedScan`
helper downgrades to `'ml'` for this reason, and has a `preserveSource` escape hatch used by the
durability tests. For manual review the faces must look machine-clustered — downgrade to `'ml'`.

`waitForQueueFinish` needs the **admin** token (the queue endpoint is admin-only; a non-admin token
403s) and can return "done" before a job is even enqueued — poll the post-condition, not the queue.

## Test 1 — manual flow end to end

1. seed a person with faces and **no scan at all**
2. `/admin/face-cleanup` → chooser renders; manual card is enabled (no scan running)
3. → `/admin/face-cleanup/people`, pick the owner, click the person
4. the manual review page lists **all** the person's faces
5. select faces and apply: **move to another person**, **lock**, **not a face** (accept the
   destructive confirm)
6. assert durable DB state, not UI text:
   - moved face: `asset_face.personId` = destination, `face_identity_face.source='manual'`
   - locked face: `source='manual'` on the reviewed person's identity
   - detached face: `asset_face.deletedAt` set, `personId` null, identity link gone

## Test 2 — cross-engine invariant (the point of the feature)

After test 1's decisions, run a scan and assert the manual decisions are honoured exactly as guided
ones would be:

- the **locked** face is NOT re-flagged
- the **detached** face stays gone
- the **moved** face is not re-proposed

Assert **durable DB state**, not re-scan ordering: two scans stamped the same `now()` make
`getLatestScan` nondeterministic, which has already produced a flaky test on this feature. Prefer
asserting the verdict/link rows over asserting what a second scan surfaced.

## Verify

Run the web e2e project against :2285. If a test fails, read the artifacts named above before
changing anything — and never accept "retry and it passes"; fix the root cause.

## Commit

`test(e2e): cover the manual face-review flow and its cross-engine invariant`
