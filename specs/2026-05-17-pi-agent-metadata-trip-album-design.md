# Pi Agent Metadata Trip Album Design

Status: approved design, pending implementation plan
Date: 2026-05-17
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm`
Branch: `explore/pi-agent-brainstorm`

## Problem

Pi can already use Gallery MCP read tools and album operation planning tools, but the assistant still needs a clear first hybrid workflow that proves it can investigate a user request, draft a structured plan, and let Gallery apply only explicitly approved changes.

The target request is:

```text
Make an album for me of photos of my recent trip to South Africa.
```

For the first slice, Pi should solve this using metadata only. It should not request preview or original-file access while handling this workflow.

## Goals

- Let Pi build a trip-album proposal from asset metadata.
- Reuse the existing `searchAssets`, `readAssetMetadata`, `listAlbums`, `proposeAlbumOperations`, and apply-plan flow.
- Keep the agent out of direct writes. Pi drafts operations; Gallery applies approved operations.
- Avoid preview/original approval prompts for this metadata-only slice.
- Make success observable through chat, action audit cards, and the existing plan review UI.

## Non-Goals

- Do not add a direct album creation or asset mutation tool to the agent loop.
- Do not use previews or originals for trip album selection in this slice.
- Do not add generic tag, rating, archive, delete, rotation, or metadata-edit operations.
- Do not add a broad abstract collection-planning framework before validating the trip-album flow.
- Do not silently add hundreds of weakly matched assets to a proposal without narrowing.

## User Flow

1. The user asks Pi to make an album for a trip.
2. Pi uses Gallery MCP metadata tools before answering.
3. Pi searches readable assets by metadata such as location and taken date.
4. Pi reads metadata for candidate asset IDs.
5. Pi drafts a structured album operation plan:
   - create a new album with a suggested title;
   - add selected assets to the new album;
   - summarize why those assets match.
6. The chat response summarizes the draft in plain language.
7. The existing plan review UI shows the proposed create/add operations.
8. The user applies approved operations through the server-owned apply action.
9. Gallery creates the album and adds only approved assets.

If metadata is insufficient, Pi should ask one concise follow-up question, such as a date range or location hint. It should not invent assets or escalate to previews in this slice.

## Tool Behavior

Pi should prefer the existing tool surface:

- `searchAssets` for candidate discovery.
- `readAssetMetadata` for selected candidate details.
- `listAlbums` when it needs to avoid duplicate album names or understand existing album context.
- `proposeAlbumOperations` to save the structured proposal.

Pi should not call:

- `readAssetPreviews`
- `readAssetOriginals`

for the metadata-only trip album workflow.

The instructions should be explicit that user requests to create or fill an album must end with a structured operation proposal when candidates are found. A plain chat answer describing what Pi would do is not enough.

## Candidate Quality Guard

Pi should avoid proposing overly broad trip albums.

If the candidate set is larger than 250 assets, Pi should ask for a narrowing hint unless the metadata is clearly bounded by a strong date range and location match. This guard is intended to prevent a broad location query from adding every historical photo with matching metadata.

The threshold is intentionally simple for the first slice. It can be made configurable later if needed.

## Review And Apply Behavior

The operation plan remains the source of truth.

The plan review UI should continue to show the structured operations and enabled state. For this workflow, operation summaries should carry the useful rationale: album title, candidate count, date range, and location match when available.

Pi should distinguish draft and applied states:

- Before apply: "I drafted this album plan."
- After apply succeeds: the UI and follow-up chat may report that the album was applied.

Pi should not claim that the album exists before the apply result exists.

## Error Handling

- If no candidates are found, Pi should say that metadata did not find matching assets and ask for a date or location hint.
- If the metadata result is too broad, Pi should ask for a narrower date range or trip clue.
- If `proposeAlbumOperations` is denied or fails, Pi should report that it could not create the proposal, not claim the album is ready.
- If apply later partially fails, the existing apply flow should report applied, skipped, and failed operation IDs.

## Testing

Add focused coverage around the agent behavior and existing server flows:

- A trip-album prompt with metadata-only permissions causes Pi to use `searchAssets` and `readAssetMetadata`.
- The same prompt does not cause calls to `readAssetPreviews` or `readAssetOriginals`.
- When candidates exist, Pi calls `proposeAlbumOperations` with create-album and add-assets operations.
- When no candidates exist, Pi asks for a useful narrowing hint instead of proposing an empty or invented album.
- When candidates exceed the broad-result threshold without strong bounds, Pi asks for narrowing.
- Applying the approved plan creates the album and adds only approved assets through the existing apply service.
- Read and planning tool calls remain visible as audited action cards in chat.

## Implementation Approach

Start with prompt and runner behavior tests. Use the existing MCP tools and operation plan flow unless tests prove the current `searchAssets` filters cannot express the needed metadata queries.

If the current metadata filters are insufficient, add only the narrow filter support needed for trip albums, such as taken-date range or location text matching. Do not introduce a trip-specific discovery tool in the first pass.

## Open Decisions

No open product decisions remain for this slice. Metadata-only behavior, no preview/original escalation, existing review/apply UI, and the 250-asset broad-result guard are part of the approved design.
