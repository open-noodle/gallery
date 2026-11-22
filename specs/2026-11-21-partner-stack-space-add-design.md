# Adding partner stacks to a Space

Issue: [Gallery 1330](https://github.com/open-noodle/gallery/issues/1330).

## Failure and intended behavior

`SharedSpaceService.addAssets` expands selected assets to their live Timeline/Archive stack siblings, then requires owner-or-partner share access on the entire expansion. Partner access admits Timeline and Hidden assets, so an automatically included Archive sibling rejects a valid Timeline selection and every other asset in the batch.

Keep explicit selections strict: every requested id must pass the existing owner-or-partner check, or the entire request fails before any write. Treat automatically expanded siblings as candidates, and include only those passing the identical check. An archived partner sibling is omitted; a shareable sibling still accompanies the selection. Deduplicate requested and expanded ids and preserve their order. Insertion, activity counts and face-match jobs all use the permitted result.

The expansion query retains its existing live Timeline/Archive visibility restriction. Hidden and Locked siblings are never pulled in automatically, and trashed siblings remain excluded. Removing assets keeps its existing expansion behavior. This fixes a failed operation on assets the caller could already share; it does not introduce a new grant, so no opt-in setting is needed.

## Independent authorization truth table

Space role is checked first. A Space Owner or Editor may attempt an add. A Viewer, non-member, or server admin who is not a member may not, even for assets they own. Server administration is not a Space role.

The following table applies only to Owner/Editor actors. Every test batch also includes an unrelated, actor-owned asset to detect partial writes. `stack` includes the selected assets and the sibling; `selected` includes only the selected assets; `deny` leaves the database and job queue unchanged.

| Caller’s relationship to the stack owner | Sibling state | Automatic sibling | Explicitly selected sibling |
| --- | --- | --- | --- |
| Owns stack | Timeline | stack | stack |
| Owns stack | Archive | stack | stack |
| Owns stack | Hidden | selected | stack |
| Owns stack | Locked | selected | deny |
| Owns stack | Trashed | selected | outside this change’s explicit-selection matrix |
| Partner, shared by owner to caller | Timeline | stack | stack |
| Partner, shared by owner to caller | Archive | selected | deny |
| Partner, shared by owner to caller | Hidden | selected | stack |
| Partner, shared by owner to caller | Locked | selected | deny |
| Partner, shared by owner to caller | Trashed | selected | outside this change’s explicit-selection matrix |
| Stranger | Any tested state | deny | deny |

The selected stack seed is Timeline in every cell. Explicit Hidden selection retains the existing share policy; it is different from pulling a Hidden sibling in without selection. Locked ownership checks continue to use `hasElevatedPermission: false`. Explicit trash policy is unchanged. There is no setting that changes this share predicate: partner `inTimeline` controls display, not sharing. Both values are tested separately, as are recognition enabled/disabled for queued work.

The matrix enumerates all three Space roles plus non-member and admin non-member, three ownership relations, five automatic-sibling states and four explicit-sibling states: 135 cells with an observed outcome snapshot. Each cell invokes the real service and real access, stack and Space repositories. Denied cells compare Space, asset, membership and activity rows before/after and assert no queued work; allowed cells verify exact membership, attribution, activity counts and face jobs. Additional boundaries cover read-only album/Space access, reversed/revoked partner sharing, deleted sharing owner, missing explicit ids and idempotence.

Mutation checks run only on a disposable CI checkout in the user's fork: restore the pre-fix sources to reproduce the bug, remove the explicit-selection gate, remove the optional-sibling filter, and remove the Space-role gate. Each mutation must fail on behavioral assertions, followed by a passing restored run. No mutated application source is published.

## Compatibility and layering

The request/response, database schema, generated clients and settings are unchanged. Old Gallery clients against the fixed server gain the corrected add behavior. New clients against old servers retain the old 400 failure for this case. Stock Immich apps and servers do not expose Gallery's Space endpoint and are unaffected; no fork object is added for rollback.

The share predicate and required/optional selection rule live in `server/src/gallery/utils/access-grants.ts`. Its existing Space-service caller now uses the returned permitted ids. The Space service and its existing unit spec are fork-owned files, absent from Immich v3.4.2; the new database spec lives in `server/test/medium/specs/gallery/`. No upstream Immich file changes, so upstream divergence does not grow.
