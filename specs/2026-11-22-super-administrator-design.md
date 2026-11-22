# Selected-account super-administration

Proposal for [issue 916](https://github.com/open-noodle/gallery/issues/916). The reported inability to correct another user's uploaded photo is the starting example; the requested feature is now broader than metadata editing.

Status: design and executable policy prototype for maintainer review. The prototype is deliberately not connected to authentication, controllers, access grants or the UI. It grants no live permission. Its unit acceptance grid is not a replacement for the real-service database matrices and mutation checks required below before integration.

## Decisions from the request

- A separate role is granted to selected accounts. Ordinary administrators are not automatically promoted.
- The role controls other users' libraries, albums and Spaces, including content the administrator cannot ordinarily see.
- The additional authority excludes locked content and permanent deletion of assets.
- Existing account ownership, Space membership and ordinary administrator behavior remain the default.

This is a cross-user administrative role, not a change to what album ownership or Space editorship means. It must not be implemented as `isAdmin || allowed`, by inventing Space memberships, or by silently replacing the actor with the asset owner.

## Permission model

The new role grants administrative authority over unlocked content. Existing owner permissions continue through their existing paths. A missing role, unsupported client capability or missing configuration is not a grant.

| Operation on another user's content | Ordinary administrator | Selected super-administrator |
| --- | --- | --- |
| Browse unlocked Timeline, Archive and Hidden assets | Existing sharing rules | Allowed |
| View and download an unlocked asset | Existing sharing rules | Allowed |
| Change description, taken date, location or rating | Existing owner/Space editor rules | Allowed |
| Edit image/video content and request reprocessing | Existing owner/Space editor rules | Allowed |
| Share unlocked content | Existing sharing rules | Allowed, retaining the real publishing actor |
| Archive, unarchive, hide or unhide unlocked content | Existing owner rules | Allowed |
| Move unlocked content to trash or restore it | Existing owner rules | Allowed |
| Manage albums and Space settings/membership | Existing album/Space roles | Allowed |
| Manage external-library settings and scans | Existing administrator rules | Allowed |
| Read, download, modify, share or unlock another user's Locked content | No additional grant | Denied |
| Permanently delete another user's asset or empty another user's trash | No additional grant | Denied |
| Grant or revoke the new role | Not allowed | Allowed, subject to bootstrap/recovery rules |

Deleting an album or Space removes a collection, not the underlying original assets. Library deletion, account deletion, retention changes and automation need explicit treatment wherever they could indirectly destroy assets. An interface that hides “permanently delete” while leaving an equivalent server action available does not enforce the exclusion.

The exclusions describe the new cross-user content authority. Server operators still control the installation and its database, and the existing account-management powers must be documented accurately rather than implying a new confidentiality boundary against the host operator.

## Role assignment and account protection

Store the role as a Gallery-owned fact keyed to the existing user id; do not add a role column to Immich's user table or redefine `isAdmin`. Require a live, active administrator account as well as the explicit role assignment. An assignment on a deleted, disabled or demoted account grants nothing.

The installation operator bootstraps the first role through a server-local CLI. Subsequent grants and revocations are performed by an existing super-administrator, and recorded with actor, target and time. Ordinary administrators cannot grant themselves the role. Revocation is enforced on the next request rather than only at the next login. Recovery remains available to the installation operator.

The account boundary needs more than a new role flag. Today an ordinary administrator can reset another administrator's password/PIN or change their email. Those paths, demotion/deletion of a super-administrator account, and authentication configuration changes that could enable account takeover must respect the new boundary. Preserve ordinary administrative functions while protecting the new privileged identities and role assignments. API keys and shared links must never inherit authority from the identity of a link owner or from a spoofed client header.

## Administrative context and UI

Provide an explicit super-administration context with a persistent banner identifying the real actor. It offers cross-user browsing and management without depending on album ownership or Space membership. Locked assets must be excluded in the server's listing, search, thumbnail, download, original-file, edit, sharing and websocket paths; the UI is not the enforcement boundary.

Retain actual ownership in every result and write. In particular, administrative stacking must not create a stack owned by the administrator over another user's assets, and administrative actions must not accidentally run the administrator's workflows as the asset owner. Private per-user state such as favorites needs an explicit subject rather than silently writing the wrong user's row.

Ordinary views continue to use the existing permissions. New UI controls fail closed against an older server and do not infer this authority from `isAdmin`, an album role, Space membership or a cached client-side assertion.

## Audit

Record the real administrative actor, operation, target ids, subject/owner and timestamp. Audit entries must distinguish a normal owner edit from a cross-user administrative action. Record role grants, role revocations, administrative-context entry/exit and content changes. Do not log credentials, file bytes or location/description values into ordinary diagnostic logs.

A denied operation leaves no partial write, no new sharing grant, no queued mutation and no success audit entry. Bulk requests containing an excluded Locked asset or a forbidden permanent-delete operation are refused before any part of the requested write runs.

## Compatibility and layering

Keep new services, policies, repositories, controllers and UI under Gallery namespaces. Upstream files receive narrow registration or delegation hooks. Record every new fork foreign key to an upstream key, register migrations in the Gallery ledger and account for their removal in revert-to-Immich. Role/audit rollback semantics must be explicit; the underlying assets and metadata retain Immich's meaning.

All new response fields are optional. Old Gallery and stock Immich clients retain their existing behavior and receive no new required enum values or sync types. A newer web client against an older Gallery or stock server hides the super-administration context. Administrative access never changes the stored asset owner or requires a stock client to understand the new role.

## Verification required before enabling the role

An independent truth table must drive a real-service database matrix covering normal user, ordinary administrator, selected super-administrator, revoked/deleted/demoted role holder, non-member, every Space role, shared-link sessions and API-key sessions. Cross those with ownership/sharing, Timeline/Archive/Hidden/Locked/trash state, the administrative-context state and every supported operation.

Check both discovery and direct-id access, read and mutation, single and bulk requests, and real database state after denials. Pin exact outcome grids and mutation-check removal of each role, Locked-content, permanent-delete, account-protection and assignment gate. Exercise credential-reset and authentication-configuration takeover attempts, ownership preservation, real-actor audit attribution, and workflow/job side effects.

Client tests must prove the role is visible only to selected accounts, the current administrative context is obvious, unsupported servers fail closed, and ordinary administrators retain their usual views and controls. Measure every changed upstream file against the pinned Immich base and report growth or shrinkage in the PR.

## Prototype boundary

`server/src/gallery/utils/super-administrator-policy.ts` expresses only the proposed additional grant. It requires an active administrator, a separate current role assignment, an authenticated interactive session and an explicit administrative context. Unknown operations, missing facts, API keys and shared links fail closed. A request that includes Locked content or permanently deletes assets never receives this additional grant, even when a parent operation such as library management is otherwise allowed.

The companion acceptance test uses a separately written operation list and outcome mask over eight actor states, administrative context on/off, Locked content present/absent, permanent deletion present/absent, and fifteen operations: 960 combinations. These are proposal acceptance checks; no production role storage, assignment endpoint, account-protection gate, management UI or audit store is claimed to exist in this draft.

All three proposal files are under Gallery-owned paths. No upstream Immich file, response schema, database object, generated SDK or user-facing string changes, and no existing authorization rule changes.
