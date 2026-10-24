# Space editors managing members

Status: design, 2026-10-24.

## Why

Today only a space owner can add members to a shared space or change a member's role
(`SharedSpaceService.addMember` / `updateMember` require `SharedSpaceRole.Owner`). In a busy family
or group space the owner becomes a bottleneck: editors already add photos and albums, but every new
person has to go through the owner. The owner wants to delegate that, but a change to who controls
membership is a security-relevant change, so it is **opt-in**: nothing changes on upgrade until an
admin or a space owner turns it on.

## What gets built

Two permissions an owner can delegate to the space's **editors**:

1. **Add members** (`editorsCanAddMembers`)
2. **Change members between viewer and editor** (`editorsCanChangeRoles`)

### How the two combine for an editor

| Add members | Change roles | The editor can…                                                                   |
| ----------- | ------------ | --------------------------------------------------------------------------------- |
| off         | off          | nothing new (today's behaviour)                                                   |
| on          | off          | add people as viewers; any other requested role is rejected (403)                 |
| off         | on           | switch existing non-owner members between viewer and editor; cannot add anyone    |
| on          | on           | add people (as viewers, see below), then switch existing members viewer ↔ editor  |

Always forbidden for editors, whatever the settings: granting or removing the owner role, changing
an owner's role (the creator or a promoted co-owner), changing their own role, removing other
members, deleting the space, and changing the two settings themselves. Owners keep every power they
have today, and their effective permissions are always "on". Viewers and non-members gain nothing;
a server admin who is not a member of the space gets no bypass (unchanged: `requireMembership`).

A role change to the same role (viewer → viewer) by a permitted editor is accepted as today's owner
no-op is; by an editor without the permission it is rejected like any other role change.

### Server level (admin)

Two admin settings, both **default `false`**, editable in Administration → Settings → Server and
through the config file (`IMMICH_CONFIG_FILE`, string booleans accepted via `galleryConfigBool`):

```json
"server": { "spaceEditorsCanAddMembers": false, "spaceEditorsCanChangeRoles": false }
```

They sit next to the fork's existing `server.mergePeopleAcrossOwners` policy switch, in
`GalleryServerExtension` / `galleryServerDefaults` (`server/src/gallery/dtos/config.dto.ts`). Upstream's
`config.dto.ts` already spreads both, so **the server config needs no change to any upstream file**.
No `visibility` meta (admin-only), like `mergePeopleAcrossOwners`. The service reads them with
`this.getConfig({ withCache: true })` at request time.

### Space level (owner)

Each space stores each permission as a tri-state: **server default** (`null`), **on** (`true`),
**off** (`false`). Existing and new spaces start at `null`. The effective value is
`spaceValue ?? serverValue`, so:

- flipping the server setting changes every space still on "server default";
- an owner's explicit on/off always wins over the server setting (owner's decision: "they can be
  overridden per-space").

Only the owner can change a space's two settings. Extend the existing `isOwnerOnlySettingsUpdate`
check in `SharedSpaceService.update` (which already covers `faceRecognitionEnabled` / `petsEnabled`)
with the two new fields, using `!== undefined` so that an editor sending `null` (reset to server
default) is also rejected. A mixed payload from an editor is rejected outright, not partially applied.

### Clients (web and mobile, both in this change)

- **Owner**: the members screen shows the two settings, each as "Server default (currently on/off)" /
  "On" / "Off".
- **Editor with a permission**: gets the add-member button and/or the viewer ↔ editor role menu for
  non-owner members other than themselves.
- **The add flow keeps today's shape (owner's decision, option A):** neither client has a role picker
  when adding; every new member, owner-added or editor-added, starts as a viewer and is promoted
  afterwards from the members screen. No picker is built. The server still enforces the API rule:
  an editor's `POST` with `role: editor` is allowed only when both permissions are on, and
  `role: owner` is never allowed for an editor. Adding a user group (web) is a client-side loop over
  `addMember`, so it follows the same rule with no extra work.
- **Editor without, and viewers**: the screen looks as it does today.
- The server enforces every rule on every request regardless of what a client shows.
- Clients gate on the caller's **effective permissions from the server**, never on the role alone.
  Mobile `space_members.page.dart` gates on `isOwner` today (role menu, add button, tap handler);
  those checks become "owner, or editor with the permission".

Web: `web/src/routes/(user)/spaces/[spaceId]/members/+page.svelte`, `SpaceAddMemberModal.svelte`,
`SpaceMembersModal.svelte`. Mobile: `space_members.page.dart`, `space_member_selection.page.dart`.

### Who invited whom (in scope, owner's decision)

Once editors can add people, the owner needs to see which editor brought someone in. The server
already stores `invitedById` in the `member_join` activity data (`SharedSpaceService.addMember`), but
no client shows it.

- `getActivities` resolves `invitedById` to the inviter's current display name (same pattern as the
  live `albumName` resolution for album link/unlink), and returns it in the activity data.
- The web activity feed (`web/src/lib/components/spaces/space-activity-feed.svelte`) shows a join with
  a known inviter as, for example, "Anna added Ben as viewer". Joins without an inviter (space
  creation, older rows) or whose inviter account no longer resolves keep today's "{name} joined as
  {role}".
- Role changes need nothing new: `member_role_change` is already logged with the actor as `userId`
  and already rendered by the feed, so an editor's role change shows who made it.
- Mobile has no space activity feed today; building one is out of scope.

### Unchanged

- Every side effect of `addMember` (album grant reconcile, face match, identity reconciliation,
  metadata backfill) runs exactly as for an owner add.
- The API-key scopes on the endpoints (`Permission.SharedSpaceMemberCreate` / `SharedSpaceMemberUpdate`
  in `shared-space.controller.ts`) stay as they are; they gate what a key may call, not the space role.

## Backwards compatibility

- **Old Gallery app, new server**: the app keeps gating on `isOwner`, so editors see today's screen.
  The server accepts editor requests per the settings, so nothing breaks. New REST fields are additive.
- **New Gallery app, old server**: the new response fields are absent. Clients must treat a missing
  effective permission as "not permitted" and a missing tri-state as "don't show the owner controls"
  (fail closed), so the screen looks exactly like today.
- **Sync stream**: the `SharedSpacesV1` payload is built from an explicit column list
  (`gallery-sync.repository.ts`), so the new columns do not leak into it; do not add them. Changing a
  setting bumps `updatedAt`/`updateId` and re-sends the unchanged row, which is harmless.
- **Stock Immich server on a Gallery database**: unaffected; `shared_space` is a fork table.
- **Settings off by default**: an upgraded server behaves exactly as today until an admin or owner
  opts in.

## Constraints

- **Keep fork code separate from upstream code** (the owner asked for this twice; it is also CLAUDE.md
  rule 5). Everything server-side is fork-owned per `docs/fork/ownership.yml` (shared-space service,
  controller, repository, DTOs, tables) or already in a fork namespace (`src/gallery/dtos/config.dto.ts`).
  The upstream files touched:
  - `server/src/dtos/config.dto.ts`: **none** (the `GalleryServerExtension` spread and
    `galleryServerDefaults` already exist).
  - `server/src/database.ts`: **none**. Do not add the columns to its hand-written `SharedSpace` type;
    `SharedSpaceRepository.getById` selects from the table class, which picks the columns up.
  - `web/src/routes/admin/system-settings/ServerSettings.svelte`: **one line**, rendering a new fork
    component under `web/src/lib/gallery/` that holds the two toggles (bound to `configToEdit.server`,
    saved by the section's existing `SettingButtonsRow keys={['server']}`). The existing inline
    `mergePeopleAcrossOwners` toggle is left where it is.
  - Settings search (`web/src/lib/gallery/admin-settings-search.svelte.ts`, fork file) indexes one
    source file per section, so the `server` section must also index the new component, or "space" /
    "members" won't find the toggles.
  - New mobile code that is not part of an existing space page goes under `mobile/lib/gallery/`.
  - The PR reports the diff of `ServerSettings.svelte` against the upstream tag (expected: +1 line).
- **Immich tables untouched.** The two nullable boolean columns go on the fork's `shared_space` table
  (`shared-space.table.ts`), added by a new fork migration in `server/src/schema/migrations-gallery/`
  numbered above the newest existing one (`1799000000000`) and appended to that folder's `ORDER`
  manifest. The table decorators must match the migration (`migrations:generate` produces no diff).
  Its `down()` drops the two columns: there is no older home to move the data back to, and dropping
  loses only these new settings. No table or function is created, so `scripts/revert-to-immich.sql`
  needs no change (it already drops `shared_space`); the revert spec must stay green.
- **Non-admins can't read admin config**, so the space response (`mapSpace`, used by get and list)
  carries what a client needs: the space's raw tri-state values (owners only need them, but they are
  harmless for any member), the current server defaults (for the "currently on/off" label), and the
  caller's effective permissions. Exact field names and shape are the builder's call.
- **i18n**: every new string goes in `i18n/gallery/en.json` plus the nine maintained locales
  (`de fr it nl pl es ru zh_Hans zh_Hant`), matching each file's register.
- OpenAPI regenerated (TypeScript SDK + Dart) and `mise sql` re-run if repository queries change.

## Tests the change needs

### The role matrix (the RBAC guarantee)

The repository's two oracles do **not** cover this change: `access-oracle.medium.spec.ts` snapshots
`checkAccess` per `Permission`, and `rbac-oracle.medium.spec.ts` snapshots viewer-scoped reads. Space
membership mutations are gated by `requireRole` inside `SharedSpaceService`, which neither reaches.
So the change adds its own exhaustive matrix, following the precedent of
`server/test/medium/specs/services/shared-space-hide-timeline-role-matrix.spec.ts` (real
`SharedSpaceService` + real repositories over the medium DB, so the role gate is genuinely exercised).

New file: `server/test/medium/specs/services/shared-space-member-management-role-matrix.spec.ts`.

**Dimensions**, every combination enumerated, none hand-picked:

| Dimension                  | Values                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Actor                      | creator owner, promoted co-owner, editor, viewer, non-member user, non-member server admin |
| Server `addMembers`        | off, on                                                                                    |
| Server `changeRoles`       | off, on                                                                                    |
| Space `addMembers`         | null, true, false                                                                          |
| Space `changeRoles`        | null, true, false                                                                          |
| Operation                  | see below                                                                                  |

Operations:

- **addMember**, requested role ∈ {omitted, viewer, editor, owner}, target ∈ {non-member, existing member}.
- **updateMember**, target ∈ {creator owner, co-owner, editor, viewer, self} × new role ∈ {owner, editor, viewer}.
- **removeMember** of another member (regression: still owner-only).
- **update** (space settings) setting each new field to {null, true, false}, alone and mixed with an
  editor-level field such as `name` (regression for the whole-payload rejection).
- **get / getAll**: the effective permissions and tri-state values the response reports for the actor.

That is 6 × 36 × (8 + 15 + 1 + 6 + 1) cases, cheap at the service layer. Requirements on the spec:

- **Enum-driven**: the actor and role lists come from `Object.values(SharedSpaceRole)` plus the
  non-member actors, so a new role adds rows and fails until reviewed (the same idea as the access
  oracle iterating `Permission`).
- **Independent expected outcome**: expectations come from a small truth table written in the spec,
  not from importing the production helper, so a bug in the helper can't agree with itself.
- **Snapshot of the full outcome grid** (allowed / 403 / 400 per case, plus the post-state role), so
  any future change to who can do what shows up as a reviewed snapshot diff (`-u`), like the oracles.
- **Post-state checked**: for every allowed case, the member row has the expected role; for every
  rejected case, the membership table is unchanged (no partial write).
- **Mutation-checked**: as in the hide-timeline matrix, the "denied" assertions are observed failing
  once with the gate removed, so none pass vacuously.
- The existing `access-oracle` and `rbac-oracle` snapshots must stay **unchanged** (this change grants
  no new read scope).

### Other tests

- Service unit tests (`shared-space.service.spec.ts`) for tri-state resolution in isolation (`null`
  follows server both ways, explicit value wins both ways), config read failure paths, and the
  `invitedById` → name resolution in `getActivities` (resolved, missing inviter, no inviter).
- Config: `galleryServerDefaults` gives false for both; `IMMICH_CONFIG_FILE` string booleans parse;
  the admin config round-trips through `PUT /system-config`.
- API e2e (`e2e/src/specs/server/api/shared-space.e2e-spec.ts`): one end-to-end path through HTTP per
  operation (admin enables the server setting, editor adds a member; owner overrides off, editor gets
  403), proving the config and the controller wiring that the medium matrix bypasses.
- Migration: `migrations:generate` clean after `migrations:run`; `down()` then `up()` round-trips.
- Web component tests: owner controls (three states, "currently on/off" label), permitted editor,
  plain editor, viewer, and a response with the new fields absent (old server → today's screen); the
  activity feed's inviter line with and without an inviter; the admin toggles render and bind.
- Mobile widget/unit tests for the same gating states, including fields absent.

## Non-goals

- A per-person override ("super-editor" / manager role): considered and dropped as too much
  machinery for a narrow gap; co-owner already covers it.
- Separate promote and demote switches (merged into one, so an editor can undo their own change).
- Editors removing members.
- Any change for stock Immich clients (they have no spaces).
- A role picker in the add-member flow (owner chose to keep viewer-first adds).
- A space activity feed on mobile.

## Left to the builder

- How the inviter name travels (a field inside activity `data`, or a typed field on the activity DTO).
- Field names on the response DTO and the update DTO (the update accepts `null` to return a setting to
  "server default").
- Exact placement and look of the owner's controls on web and mobile members screens, following each
  screen's existing setting patterns.
- Whether the effective-permission check is a small helper inside `shared-space.service.ts` or a
  `src/gallery/utils/` module.
