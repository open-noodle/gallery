# Trash + Duplicate Cleanup — Slice 3 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-trash-and-duplicate-cleanup-design.md`
Slice: 3 — agent-runner `trash_assets` workflow (router + reversible trash plan).

Builds on Slices 1–2 (server `asset.trash` op + fixture). Mirrors
`untag_assets`'s `run()` (proposeAlbumOperations operation) and `archive_assets`'s
source handling.

## Goal

Route trash/delete phrasing to a `trash_assets` workflow that resolves a bounded
source and proposes ONE reversible, High-risk `asset.trash` operation.

## Design

Trash uses **explicit** trash verbs — never bare "remove" (that belongs to
`remove_photos_from_album`) and never "tag" removal (`untag_assets`). It declines
album/space-level deletion (no album-delete workflow exists).

New module `agent-runner/src/strict-workflows/workflows/trash-assets.mjs`:

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'trash_assets';
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) =>
  clean(v)
    .replace(/[.?!]+$/u, '')
    .trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
// Album/space-level deletion is out of scope (trash operates on assets, not containers).
const containerSourcePattern = /\b(?:album|space)$/i;
// "delete the X tag from Y" is untag territory; "<source> from <album/space>" is remove_photos.
const removalFramePattern = /\btag\s+from\b|\bfrom\s+(?:the\s+)?[\w\s]+\b(?:album|space)\b/i;
const declinesSourceFastPath = (s) =>
  SUBJECTIVE_PATTERN.test(s) || tripSourcePattern.test(s) || containerSourcePattern.test(s);

// trash/bin <source> ; delete <source> ; move/send/put <source> to (the) trash/bin
const TRASH_BIN_PATTERN = /\b(?:trash|bin)\s+(?<source>.+)$/i;
const DELETE_PATTERN = /\bdelete\s+(?<source>.+)$/i;
const MOVE_TO_TRASH_PATTERN =
  /\b(?:move|send|put|throw)\s+(?<source>.+?)\s+(?:in|into|to)\s+(?:the\s+)?(?:trash|bin|recycle\s*bin)\b/i;

const PATTERNS = [MOVE_TO_TRASH_PATTERN, TRASH_BIN_PATTERN, DELETE_PATTERN];

export const trashAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    for (const pattern of PATTERNS) {
      const m = pattern.exec(text);
      if (m?.groups?.source) {
        const sourceDescription = cleanSource(m.groups.source);
        if (!sourceDescription || declinesSourceFastPath(sourceDescription) || removalFramePattern.test(text)) {
          return undefined;
        }
        return { slots: { sourceDescription } };
      }
    }
    return undefined;
  },
  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    return sourceDescription ? { sourceDescription } : null;
  },
  async run({ client, slots, signal }) {
    const sourceDescription = clean(slots?.sourceDescription);
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Move matching photos to Trash.`,
          operations: [
            {
              type: 'asset.trash',
              summary: 'Move matching photos to Trash (recoverable).',
              targetKind: 'asset_batch',
              assetSource: { kind: 'selectionHandle', selectionHandleId },
              riskLevel: 'high',
            },
          ],
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeAlbumOperations',
      successText: `I prepared a plan to move ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} to Trash. They can be restored from Trash. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
```

(Confirm `failed`/`handoffOpen`/`needsInput`/`gatePlanResult`/`safeFailureText`
signatures against `untag-assets.mjs` and match them. Tune the regex under TDD so
all the cases below pass — the test cases are the contract.)

### registry.mjs

Import `trashAssetsWorkflow`; register it adjacent to `archiveAssetsWorkflow`
(both source-state workflows). Trash's distinct verbs (trash/delete/bin/move-to-
trash) mean it does not collide with `remove_photos_from_album` ("remove … from")
or `untag_assets` ("remove … tag"). Extend the order comment.

### manifest.mjs (+ mirror) + matrix Flow Ownership row

- Manifest entry: `kind:'trash_assets'`, `flow:'hybrid'`, `title:'Trash photos (recoverable)'`,
  `classifierDescription:` "User wants to move a metadata-describable set of photos
  to the recoverable Trash (trash/delete/bin a recency/date/type or named-entity
  source). Reversible; album/space deletion and subjective sources are out of
  scope.", positive ["Trash my newest 20 photos","Delete my 2024 screenshots",
  "Move my newest 50 photos to the trash","Bin my blurry shots from last weekend"],
  negative ["Delete the Family album","Remove my newest 20 from the Italy album",
  "Remove the Travel tag from my newest 20","Trash the best ones"],
  slots `{ sourceDescription required }`,
  `requiredReadTools:['resolveAssetSearchFilters','searchAssets']`,
  `planTool:'proposeAlbumOperations'`, `supportsContinuation:false`,
  `matrixRow:{ capability:'Trash photos', tier:'Solid now', flow:'Hybrid' }`.
- Regenerate the mirror (`sync-strict-workflow-manifest.mjs`).
- **Matrix Flow Ownership row** (REQUIRED so `agent-capability-matrix.spec.ts`'s
  per-entry agreement test stays green): add a `| Trash photos | Hybrid | … |` row
  to the Flow Ownership Matrix (`docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`),
  e.g. "`trash_assets`: Pi resolves the source; Gallery owns the High-risk,
  reversible `asset.trash` plan (recoverable Trash); album/space deletion and
  subjective sources hand off." Then regen the generated block
  (`sync:agent-capabilities`) and prettier the doc. (The fuller matrix move out of
  "Needs New MCP Tool" lands in Slice 7.)

## TDD steps

### Task 1: failing tests (red) — `trash-assets.test.mjs`

`match` accepts (slots.sourceDescription): "trash my newest 20 photos", "delete my
newest 50 photos", "move my newest 20 to the trash", "bin my 2024 videos",
"send these to the bin". `match` accepts (routes; resolver may handoff later):
"delete all my screenshots".

`match` rejects (undefined): "delete the Family album" (container), "remove my
newest 20 from the Italy album" (no trash verb → remove_photos), "remove the
Travel tag from my newest 20" (untag), "trash the best ones" (subjective),
"archive my newest 20" (archive, no trash verb).

`parseSlots`: round-trips; missing source → null.

`run` (contract fixture): happy path resolves source → proposes ONE valid
`asset.trash` op (asset_batch, selectionHandle, riskLevel high, NO payload) →
gated; success text says "Trash" + "restored". Assert the op passes
`validateOperations` (the Slice-2 fixture). Empty selection → needs_input (no
plan). Resolver handoff/needs_input/empty propagated. Plan-tool failure → failed.

### Task 2: implement (green)

Add the module, registry, manifest (+ mirror), and the matrix Flow Ownership row +
generated-block regen. Green:

```bash
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run src/services/agent-capability-matrix.spec.ts
```

(Server already built this session; if `sync:agent-capabilities` needs a rebuild,
run `pnpm -C server build` first. Prettier the matrix doc to a fixed point.)

## Edge cases (covered above)

- Trash requires an explicit trash verb (never bare "remove").
- Album/space-level deletion declines (no container delete).
- "delete … tag from …" / "… from … album" declines (untag / remove_photos own them).
- Subjective / trip sources decline.
- Empty selection → needs_input (no empty trash plan).
- The proposed op is High risk, no payload, reversible.

## Acceptance

- `trash-assets.test.mjs` green; full agent-runner suite green.
- Manifest mirror + matrix generated block regenerated; "Trash photos" Flow
  Ownership row added; `agent-capability-matrix.spec.ts` green; matrix prettier-clean.
- The proposed op validates against the Slice-2 fixture (riskLevel high, no payload).

## Commit

`feat(agent): add trash_assets workflow (reversible asset.trash over a resolved source)`
