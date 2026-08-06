# Pi Agent Space Capabilities Design

Status: draft for review
Date: 2026-05-19
Branch: `explore/pi-agent-brainstorm`

## Context

The Pi assistant can already propose reviewable operation plans for shared
spaces:

- `space.create`
- `space.addAssets`
- `space.removeAssets`
- `space.updateDetails`

The gap is that Pi cannot reliably work with existing spaces from a normal user
prompt like “add these photos to Family” because the MCP read surface does not
expose space lookup/read tools. Pi can only target a space if it already has the
raw space id. Member management is also missing from the operation-plan surface,
even though Gallery already has first-party APIs for adding, removing, and
updating shared-space members.

This spec turns the space rows from the capability matrix into four vertical
slices that can be planned and implemented independently with TDD.

## Goals

- Let Pi resolve visible shared spaces by name without asking users for raw ids.
- Let Pi inspect enough space detail to avoid bad plans, including duplicate
  asset additions and accidental removals.
- Make add/remove photo workflows for existing spaces work from natural prompts.
- Make existing space detail updates work from natural prompts.
- Add reviewable plan support for member management.
- Keep all writes behind Gallery operation-plan review and apply.
- Keep MCP contracts, prompt docs, generated docs, and validation hints as the
  source of truth for smaller models.
- Use TDD for every implementation slice, including unit, contract, service,
  UI, and assistant-flow regression tests where applicable.

## Non-Goals

- Do not add direct mutation MCP tools.
- Do not bypass space permissions or operation-plan review.
- Do not implement space deletion.
- Do not implement bulk “add all assets” through Pi in this spec.
- Do not add linked-library management for spaces.
- Do not add people/face search in spaces; that should be a later people-search
  capability.
- Do not expose member emails or other sensitive member fields unless they are
  already visible to the authenticated user and needed for disambiguation.

## Recommended Direction

Add a read-side MCP space surface first, then use it to make the existing
planning surface reliable.

The core read tools should be:

- `listSpaces`: returns visible shared-space summaries.
- `readSpace`: returns one visible shared space with asset ids and member
  summaries.

The planning surface should stay plan-only. Existing `space.addAssets`,
`space.removeAssets`, and `space.updateDetails` operations should continue to be
created through `proposeAlbumOperations` / `reviseProposedOperations`. Member
changes should add new operation types that also go through the same plan review
and apply pipeline.

This keeps the mental model simple for Pi:

1. Read spaces.
2. Read/search candidate photos.
3. Propose a plan.
4. Let Gallery apply after user review.

## Data And Permission Model

`listSpaces` and `readSpace` must use the same authenticated session user and
permission gates as the rest of the agent read tools. They should only expose
spaces visible to that user.

Space write operations must be gated by explicit agent write-scope flags, not
only by the final shared-space service call. Existing flags cover create,
add-assets, remove-assets, and update-details. Member management should add
separate write-scope flags for add-member, remove-member, and update-member-role
so permission presets can allow or deny those actions independently.

The space read response should be purpose-built for Pi rather than reusing a
large UI DTO wholesale. It should include:

- `id`
- `name`
- `description`
- `color`
- `createdById`
- `assetCount`
- `thumbnailAssetId`
- `recentAssetIds`
- `assetIds` for `readSpace`, bounded by the same practical limits used by plan
  operations
- member summaries for `readSpace`, with user id, display name, role, and
  optional avatar/color fields

`readSpace` should return all asset ids up to 10,000, matching the current
operation-plan asset-id limit. If a space contains more than 10,000 assets, the
tool must return a clear truncation flag and total count. Large-space pagination
is a follow-up, but the first implementation must not silently pretend that a
partial asset list is complete.

## Slice 1: Space Lookup And Read MCP Tools

### Scope

Add `listSpaces` and `readSpace` MCP read tools.

`listSpaces` should return visible shared-space summaries. `readSpace` should
take `spaceId` and return details, asset ids, and member summaries for one
visible shared space.

This slice should also add MCP tool contracts, examples, common mistakes,
generated docs, prompt cheat-sheet updates, and activity labels.

### User Capability

Pi can answer and prepare for prompts like:

- “What spaces do I have?”
- “How many photos are in Family?”
- “Use the Family space for this plan.”

### TDD Requirements

Start with failing tests for:

- MCP `tools/list` includes `listSpaces` and `readSpace` with object
  `inputSchema`.
- Valid `listSpaces` and `readSpace` examples parse and execute.
- `listSpaces` returns only spaces visible to the session user and does not
  include full asset lists.
- `readSpace` requires `spaceId`.
- `readSpace` rejects non-visible spaces.
- `readSpace` returns asset ids, member summaries, and truncation metadata using
  the purpose-built Pi response shape.
- Approval retry for both tools uses only `toolCallId`.
- Invalid argument shapes return model-actionable correction hints.
- Generated MCP docs include the new tools and examples.
- Activity preview shows user-readable labels such as `Listing spaces` and
  `Reading space details`.

### Edge Cases

- User has zero visible spaces.
- Two spaces have the same or very similar names.
- Space name includes punctuation or emoji.
- Space exists but user is no longer a member.
- Space has no assets.
- Space has many assets and the response is truncated.
- Space has members but member metadata must be redacted.

## Slice 2: Add And Remove Photos In Existing Spaces

### Scope

Make existing-space add/remove asset plans reliable from natural prompts.

The operation types already exist:

- `space.addAssets`
- `space.removeAssets`

This slice should update MCP planning examples, validation hints, generated docs,
plan review labels, applied-plan cards, and assistant-flow tests so Pi uses
`listSpaces` / `readSpace` before proposing existing-space asset changes.

### User Capability

Pi can handle prompts like:

- “Add my latest Berlin photos to the Family space.”
- “Remove screenshots from the Project space.”
- “Add these selected photos to the space we were just discussing.”

### TDD Requirements

Start with failing tests for:

- Planning examples for add/remove existing-space assets use
  `targetKind: "existing_space"` and `targetId`.
- Validation rejects album target kinds for space operations with actionable MCP
  correction hints.
- Assistant flow lists spaces, resolves the intended space, searches/reads
  candidate assets, proposes a space asset plan, shows a plan card, applies it,
  shows the applied-plan card, and leaves chat open.
- Apply calls the existing shared-space asset add/remove service path with only
  the selected asset ids.
- Disabled operations and user-excluded assets are not applied.
- `space.addAssets` excludes assets already in the space when `readSpace`
  returned a complete asset list.
- `space.removeAssets` only proposes assets that are in the space when
  `readSpace` returned a complete asset list.
- Partial/truncated `readSpace` asset lists produce a cautious plan or a
  clarifying response instead of pretending membership is complete.

### Edge Cases

- Existing space name is ambiguous.
- No matching space is found.
- No matching assets are found.
- All candidate assets are already in the space.
- None of the requested removal assets are in the space.
- User lacks permission to add or remove assets from that space.
- Plan apply partially succeeds because some assets became inaccessible.
- Large asset selections are capped and represented with counts/thumbnails.

## Slice 3: Update Existing Space Details

### Scope

Make existing-space detail update plans reliable from natural prompts.

The operation type already exists:

- `space.updateDetails`

This slice should ensure Pi can resolve the space, propose a clear field-level
plan, and show/apply it with human wording.

### User Capability

Pi can handle prompts like:

- “Rename Family to Family 2026.”
- “Change the Family space description to ‘Photos for everyone’.”
- “Make the Vacation space blue.”

### TDD Requirements

Start with failing tests for:

- Planning examples cover rename, description update, and color update.
- DTO validation rejects empty update payloads with a model-actionable hint.
- Assistant flow resolves a visible space by name and proposes
  `space.updateDetails`.
- Apply calls the existing shared-space update service path with only allowed
  fields: name, description, and color.
- Field overrides reject unsupported fields such as thumbnail, pets, face
  recognition, linked libraries, and deletion.
- Plan review shows changed fields without exposing operation ids by default.
- Inline field edits for space details persist into apply payloads when the
  review UI supports editable fields.
- Applied-plan card summarizes the changed fields.

### Edge Cases

- Space name is ambiguous.
- Requested new name equals the existing name.
- Description is cleared versus left unchanged.
- Color value is invalid.
- User lacks update permission.
- Space is deleted or membership changes before apply.
- Multiple detail fields change in one operation.

## Slice 4: Space Member Management Plans

### Scope

Add reviewable plan support for shared-space member changes.

New operation types should be added:

- `space.addMembers`
- `space.removeMembers`
- `space.updateMemberRole`

These operations must go through the same plan review/apply pipeline as album,
space asset, and asset-batch operations.

Pi will need enough read context to identify existing members from `readSpace`.
Adding a member by name/email requires user lookup support. Slice 4 includes a
narrow `searchUsers` MCP read tool unless an equivalent user lookup surface
already exists when implementation starts. The tool should return only fields
the current user is allowed to see and only enough data to disambiguate: user id,
display name, optional email when already visible, and avatar/color metadata.

### User Capability

Pi can handle prompts like:

- “Add Alex to the Family space as an editor.”
- “Remove Chris from the Project space.”
- “Make Sam a viewer in Vacation.”

### TDD Requirements

Start with failing tests for:

- DTO schemas for the three member operation types.
- Operation-plan validation requires existing-space target ids for member
  operations.
- Agent write-scope validation denies member operations unless the session has
  the matching member-management flag.
- Add-member payload requires a user id and role.
- Remove-member payload requires user ids.
- Update-role payload requires user ids and target role.
- `searchUsers` MCP contract, examples, and generated docs exist when no
  equivalent lookup tool is available.
- `searchUsers` returns only fields allowed for disambiguation and redacts
  private fields by default.
- Planning contract examples cover add, remove, and role update.
- Validation rejects direct member mutation tool names and points Pi to
  reviewable plans.
- Apply service calls the existing shared-space member service methods.
- Apply rejects removing the current user and removing the last owner/admin.
- Disabled member operations are not applied.
- Plan review labels are human-readable: `Add Alex as editor`, `Remove Chris`,
  `Change Sam to viewer`.
- Assistant flow resolves the space, resolves or asks for the member, proposes a
  member plan, applies it, shows applied history, and keeps chat open.

### Edge Cases

- User lookup returns multiple matches.
- User lookup returns no matches.
- Target user is already a member.
- Removing the current user is disallowed through Pi in the first version.
- Removing the last owner/admin is rejected.
- Updating a member to the same role is a no-op.
- User lacks member-management permission.
- Member list changes before apply.
- Emails or private user fields are not exposed in chat unless already visible.

## Cross-Slice UX Requirements

- Permission requests should use low-information wording, with technical details
  expandable.
- Activity preview should show what Pi is doing in plain language:
  `Finding spaces`, `Checking Family`, `Preparing a space plan`.
- Plan review should group space operations under space destination cards.
- Space destination cards should show name, type, selected asset/member counts,
  representative thumbnails where available, and warnings for permission or
  stale-state issues.
- Applied-plan cards should remain in chat and the session should continue after
  apply.
- Ambiguous names should trigger a clarifying chat response, not a guessed plan.

## Cross-Slice Testing Strategy

Each slice must follow TDD:

1. Write failing focused tests for the slice contract.
2. Implement the smallest server/runtime/UI changes needed.
3. Run focused tests until green.
4. Add assistant-flow regression coverage for the user-visible path.
5. Run the nearby MCP, operation-plan, assistant UI, and generated-doc checks.

Minimum test categories:

- MCP contract tests.
- DTO validation tests.
- Service permission tests.
- Agent write-scope and permission-preset tests.
- Operation-plan creation and apply tests.
- Plan item selection, disabled-operation, and field-override tests.
- Generated docs/prompt sync tests.
- Assistant chat/plan/apply UI tests.
- Privacy/redaction tests for member and user lookup responses.
- Edge-case tests listed in each slice.

## Suggested Implementation Order

1. **Slice 1: Space lookup/read MCP tools.**
   This unlocks natural language space resolution.
2. **Slice 2: Existing-space add/remove assets.**
   This delivers the highest-value user workflow using existing operation types.
3. **Slice 3: Existing-space detail updates.**
   This is smaller and benefits from the lookup/read foundation.
4. **Slice 4: Member management plans.**
   This is the broadest slice because it adds new operation types and may need
   user lookup.

## Design Decisions

- `readSpace` returns asset ids up to 10,000 and reports truncation explicitly.
- Slice 4 includes `searchUsers` if no equivalent user lookup MCP tool exists.
- Removing the current user through Pi is not supported in the first version.
- Removing the last owner/admin is rejected server-side.
- Space detail updates are limited to name, description, and color in the first
  version. Thumbnail, face recognition, pets, linked libraries, and deletion stay
  out of scope.
