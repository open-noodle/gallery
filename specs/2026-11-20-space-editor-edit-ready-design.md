# Space Editor edit completion

Issue: [Gallery 1321](https://github.com/open-noodle/gallery/issues/1321).

## Behavior and cause

An authorized Space Editor can save another member's crop/rotation or image adjustment, but the web editor waits for `AssetEditReadyV2` before closing. The worker sent that event only to the asset owner. The save succeeded while the initiating editor timed out and reported failure.

Keep Immich's owner notification and forward the same supported event to the initiating Gallery user. This acknowledges an existing authorized operation; it does not grant a new editing capability, so no opt-in setting is needed. Do not broadcast to the whole space: other members did not initiate the operation and need no completion payload.

## Job and delivery contract

The fork's internal `IAssetEditJob` extends the existing entity job with optional `initiatorId`. The server derives it from authenticated non-owner requests after the existing edit authorization. Owners retain the old `{ id }` payload, and shared links never create a user-room subscription. Crop/rotation, reset, adjustment/reset and video trim/reset all carry the metadata. Video thumbnail delegation preserves it when queuing the final trim job.

The completion hook sends the existing owner event first. For a distinct initiating user it loads a non-deleted account and calls central `checkAccess(Permission.AssetRead)` again, using current database state. Completion uses read access: an Editor downgraded to Viewer may still receive the result of an already-authorized edit, while a removed member must not. A job's stored identity is not an access grant.

The existing viewer-scoped `AssetRepository.getByIds` supplies the initiating user's `isFavoriteForUser` and projected trim duration. Never copy the owner's favorite bit into the editor event. The original owner event is unchanged. `clientSendByClient` sends the extra event only to Gallery sockets, without a stock-client payload. This reuses the existing Gallery/stock classifier and websocket event schema.

## Delivery truth table

Rows describe the initiating user at completion. The asset belongs to another space member and has no alternate album/partner access. The owner always retains the original notification.

| Initiator | Timeline | Archive | Hidden | Locked | Trashed | Asset detached | Membership removed | Account deleted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Space Owner | send | send | deny | deny | deny | deny | deny | deny |
| Space Editor | send | send | deny | deny | deny | deny | deny | deny |
| Space Viewer | send | send | deny | deny | deny | deny | deny | deny |
| Non-member | deny | deny | deny | deny | deny | deny | deny | deny |
| Server admin, non-member | deny | deny | deny | deny | deny | deny | deny | deny |

`showInTimeline` true/false does not affect direct read access. Each row applies to both thumbnail and trim completion. An initiator who retains some other central read grant (for example an explicitly shared album) can still receive the event. Missing assets/projections and legacy jobs without an initiator produce no forwarded event. Owner-as-initiator does not duplicate the event. Stock sockets and other space members receive no forwarded event.

## Compatibility and layering

There is no migration, endpoint change or public DTO change. Old queued jobs and old workers continue their owner-only behavior. A new worker accepts old jobs; an old worker ignores the optional field on new jobs. A mixed-worker deployment can retain the old timeout until all workers are upgraded. Existing Gallery web/mobile clients decode the existing event; new web clients against old servers retain the existing limitation. Stock Immich owner notifications remain unchanged, and stock clients receive no new cross-owner event.

All new delivery logic lives in `server/src/gallery/`; upstream services have narrow producer/consumer hooks and a metadata spread. Against Immich v3.4.2, upstream-file divergence grows as follows (added/deleted lines):

| File | Before | After |
| --- | --- | --- |
| `server/src/services/asset.service.ts` | +162 / -35 | +170 / -37 |
| `server/src/services/job.service.ts` | +33 / -3 | +34 / -4 |
| `server/src/services/media.service.ts` | +110 / -32 | +114 / -33 |
| `server/src/types.ts` | +34 / -6 | +36 / -7 |

These are calls/type substitutions or propagation through the existing fork video seam; the event projection and delivery policy stay in the fork helper.

## Verification

Unit regressions exercise real JobService completion for both job types, legacy/self jobs, missing users/projections, access revocation, both favorite directions, the stock-client exclusion argument, authenticated job metadata and video delegation. Existing asset/job/media/Gallery asset suites remain applicable.

The database medium matrix runs real JobService with real access, asset, edit and user repositories. It enumerates the table, both timeline preferences and both completion jobs, snapshots the outcome grid, verifies viewer favorite/trim projections, and compares asset/edit/favorite/trim rows before and after every delivery. Expectations come from the table above. Removing the delivery access gate must make the matrix fail; the mutation run and restored run are recorded in the PR validation results.

The API websocket regression covers rotation, rotation reset, adjustment and adjustment reset by a Space Editor. It connects owner, Gallery editor, stock editor and Gallery viewer sockets; requires owner and initiating editor completion within the client's ten-second wait; checks distinct favorite bits; and rejects broadcasts to stock/non-initiating sockets.

Local static checks and unit tests do not require a database. Database medium and websocket E2E checks require Docker and run in CI when the local Docker daemon is unavailable.
