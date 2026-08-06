# Assistant Photo-first Plan Review UI Design

## Context

The assistant plan flow is functionally useful, but the current review surface reads like an operations debugger. It uses rectangular buttons, dense rows, and technical details in the main path. For photo-heavy plans, the user is really approving a visual selection, so the affected photos should be the first thing they see.

This design updates the chat and plan review UI while keeping the existing plan behavior intact. The approved mockup is:

- `docs/superpowers/mockups/2026-05-23-assistant-photo-first-plan-review.html`

## Goals

- Make photo-related plans feel native to Gallery by putting thumbnails at the center of the review.
- Replace blocky controls with rounded pill and icon-style controls that match the rest of the product.
- Keep technical context available, but optional and visually secondary.
- Let users open a modal photo review surface from `Review photos` or `Change selection`.
- Let users collapse an active plan inside the chat without losing the key plan summary.
- Improve activity timeline blocks so they read as progress and evidence, not raw log rows.

## Non-Goals

- Change the underlying plan execution semantics.
- Add new agent capabilities or new plan operation types.
- Replace the existing chat flow with a separate full-screen workflow.
- Build a full photo editor inside plan review.
- Persist collapsed UI state across browser sessions in the first implementation.

## Approved Direction

Use a photo-first review sheet embedded in the assistant chat. Text messages remain conversational and relatively narrow, but plan review cards may use a wider content column so the photo evidence can breathe.

The plan sheet has three layers:

1. A plain-language plan header with safety summary and rounded controls.
2. A prominent photo stage for plans that affect assets.
3. Compact change rows with separate optional technical details.

Photo selection review happens in a modal. This keeps the chat readable while giving the user enough room to inspect and adjust hundreds of photos.

## Chat Page

The assistant page keeps the current structure: session sidebar, session header, transcript, and bottom composer. The visual treatment changes:

- Header actions use rounded pill buttons instead of squared controls.
- The current plan appears as a large rounded sheet inside the transcript.
- Text messages stay constrained for readability.
- Plan cards may be wider than text messages.
- The active plan has a `Collapse plan` control.
- Collapsed plans show a compact summary row with a few thumbnails, change count, selected photo count, and safety summary.
- Expanding restores the full plan sheet in place.

The collapsed state is local UI state. It does not change plan selection, operation enablement, or apply eligibility.

## Photo-first Plan Review

When a plan includes photo or video assets, the expanded plan must always show thumbnails before the operation list. The user should never need to open technical details to see the affected photos.

The photo stage includes:

- A large representative thumbnail mosaic or strip.
- A visible total selected asset count.
- Match context such as date range, location, people, or smart search terms when available.
- A primary `Review photos` action.
- A safety summary such as `No photos will be deleted`.

For very large selections, the embedded view remains bounded. It shows representative thumbnails and an overflow count. The full set is reviewed in the modal with virtualization.

If thumbnails cannot load, the card falls back to counts and metadata, but the layout should still reserve the photo-review area so the plan remains visually predictable.

## Photo Review Modal

Both `Review photos` and `Change selection` open the same modal review surface for photo-affecting operations.

The modal includes:

- Title and summary of the selected destination or operation.
- Search within the affected asset set.
- Filter chips for available context, such as date, location, people, tags, and smart-search query.
- A virtualized thumbnail grid.
- Clear selected and excluded states on each tile.
- Quick actions such as select all, hide removed, reset selection, and clear all where supported.
- A side summary with selected count, removed count, and why the photos matched.
- Optional technical details behind a small disclosure.

Closing the modal returns the user to the plan sheet with updated selected counts. The modal does not apply the plan; it only changes the pending selection.

## Change Rows

Plan changes remain grouped by destination. Rows should be concise and human-readable:

- `Create shared space "South Africa with Pierre and Aurelia - Jan 2026"`
- `Add 733 photos`
- `Set cover photo`
- `Remove 8 photos`

Each row includes:

- Included/excluded state.
- Selected and total counts when assets are involved.
- A rounded `Change selection` action for asset operations.
- A rounded `Technical details` disclosure for raw context.

Photo review and technical details are separate controls. Opening technical details must not be required to inspect or adjust photos.

## Technical Details

Technical details remain available for debugging and support, but they should be visually secondary.

Use small rounded disclosure buttons labeled `Technical details`. Expanded content should use compact low-contrast panels for:

- Operation ID.
- Tool or executor name.
- Raw operation parameters.
- Dependency information.
- Validation errors.
- Evidence handles or search sources.

Technical details default to collapsed.

## Activity Timeline

The activity preview becomes a timeline rail instead of stacked utility boxes.

Expanded activity shows:

- A rounded activity card.
- A vertical rail with status dots.
- One row per meaningful step.
- Plain-language step titles.
- Counts and statuses in small rounded pills.
- Optional technical details per step.

Compact activity should summarize progress in one or two lines with the most relevant counts. The timeline should avoid exposing raw tool names unless the user expands technical details.

## Apply Area

The apply controls move into a rounded dock at the bottom of the plan sheet.

The dock shows:

- Selected change count.
- Selected asset count.
- Any important warning summary.
- Secondary revision action.
- Primary apply action.

The dock should feel connected to the plan sheet, not like a generic full-width form footer.

## Responsive Behavior

Desktop:

- Plan sheet can use a wider transcript column.
- Photo stage uses a mosaic plus summary rail.
- Modal uses grid plus side summary.

Tablet and mobile:

- Plan sheet stacks into a single column.
- Thumbnail mosaic becomes a smaller responsive grid.
- Modal stacks the summary below the grid.
- Pill controls wrap without overlapping.
- The collapsed plan summary stacks cleanly with thumbnails first.

## Accessibility

- Plan collapse uses a real button with `aria-expanded`.
- Photo review modal uses `role="dialog"` and an accessible title.
- Modal closes via explicit close button and Escape.
- Thumbnail selection tiles expose pressed/selected state.
- Technical detail disclosures use accessible buttons or native disclosure semantics.
- Focus should move into the modal when it opens and return to the triggering button when it closes.
- Apply remains disabled when required validations fail.

## Component Impact

Expected frontend areas:

- `agent-session-chat-panel.svelte`: allow wider plan cards, plan collapse state, refined transcript spacing.
- `agent-session-header.svelte`: rounded action controls.
- `agent-operation-plan-review-panel.svelte`: updated plan sheet frame and collapse affordance.
- `agent-plan-evidence-ledger.svelte`: photo-first layout and updated summary structure.
- `agent-plan-destination-card.svelte`: destination grouping with larger photo stage.
- `agent-plan-thumbnail-strip.svelte`: representative mosaic or enhanced strip.
- `agent-plan-operation-row.svelte`: separate photo review action from technical details.
- `agent-plan-item-review.svelte`: reusable modal/grid content for photo selection.
- `agent-plan-technical-details.svelte`: rounded disclosure styling.
- `agent-plan-apply-bar.svelte`: rounded apply dock.
- `agent-activity-block.svelte`: timeline rail presentation.

No backend plan contract changes are required for the first UI pass.

## Testing

Add focused frontend coverage for:

- Photo-affecting plans show thumbnails in the expanded plan without opening technical details.
- `Review photos` opens the modal.
- `Change selection` opens the same modal.
- Technical details expand independently from photo review.
- Collapsing a plan hides the full plan body and shows the compact summary.
- Expanding a collapsed plan restores the full plan.
- Selection changes in the modal update plan counts without applying the plan.
- Activity expanded mode renders the timeline rows and optional details.

Manual verification should include desktop and mobile screenshots in dark mode, because this change is primarily visual.
