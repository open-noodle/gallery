# Slice G1 — `move_photos_between_albums` (agent-runner only)

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-reorg-sharing-people-design.md` (Phase G1).
Scope: a new hybrid workflow that composes the already-mapped `album.removeAssets` +
`album.addAssets` into one reviewable plan. **No server change, no new op, no new scope.**

TDD throughout: write the `.test.mjs` cases first, watch them fail (module missing),
implement the workflow, go green, then wire registry/manifest/evals.

## Files

1. `agent-runner/src/strict-workflows/workflows/move-photos-between-albums.mjs` (new)
2. `agent-runner/src/strict-workflows/workflows/move-photos-between-albums.test.mjs` (new)
3. `agent-runner/src/strict-workflows/registry.mjs` (edit — import + register)
4. `agent-runner/src/strict-workflows/manifest.mjs` (edit — add entry)
5. `agent-runner/src/strict-workflows/manifest.generated.json` (regenerate)
6. `agent-runner/eval/scenarios/classification-recall.mjs` (edit — add recall case)
7. `agent-runner/eval/scenarios/slot-fidelity.mjs` (edit — add slots case)
8. `agent-runner/eval/scenarios/classification-negatives.mjs` (edit — add decline case)
9. `agent-runner/eval/scenarios/l3-readonly.mjs` (edit — add L3 routing + plan case)

Do **not** run server prettier on any `agent-runner/**` file (double-quote churn; it is
not prettier-gated). Match the existing single-quote style by hand.

## Step 1 (RED): write `move-photos-between-albums.test.mjs`

Mirror `remove-photos-from-album.test.mjs` structure. Use `makeContractClient` from
`./contract-fixtures.mjs`. Cases (exact):

**identity**

- `kind === 'move_photos_between_albums'`, `flow === 'hybrid'`, `typeof run === 'function'`.

**match()**

- `'move my newest 20 photos from Drafts to Keepers'` →
  `{ slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' } }`.
- `'move my photos from 2024 from the Trips album to the Italy album'` →
  `{ slots: { sourceDescription: 'my photos from 2024', fromAlbumRef: 'Trips', toAlbumRef: 'Italy' } }`
  (multi-"from" source binds the FINAL `from <album> to <album>`).
- `'move my newest 20 to Keepers'` (no `from`) → `undefined`.
- `'move the best ones from Drafts to Keepers'` (subjective source) → `undefined`.
- `'move my recent trip photos from Drafts to Keepers'` (recent-trip source) → `undefined`.
- `'add my newest 20 photos to Keepers'` (no `move` verb) → `undefined`.
- `''` → `undefined`.

**parseSlots()**

- `{ sourceDescription: 'my newest 20 photos', fromAlbumRef: 'the Drafts album', toAlbumRef: 'the Keepers album' }`
  → `{ sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' }`.
- missing `fromAlbumRef` → `null`; missing `toAlbumRef` → `null`; empty `sourceDescription` → `null`.
- strips trailing punctuation from `sourceDescription`.

**execution** (drive against `makeContractClient`)

- planned happy path: `makeContractClient({ albums: [{ id: 'alb-A', albumName: 'Drafts' }, { id: 'alb-B', albumName: 'Keepers' }] })`,
  slots `{ sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' }`.
  Assert: `outcome.status === 'planned'`; the `proposeAlbumOperations` call's `operations`
  deep-equals (order matters):
  ```js
  [
    {
      type: 'album.removeAssets',
      targetKind: 'existing_album',
      targetId: 'alb-A',
      assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
    },
    {
      type: 'album.addAssets',
      targetKind: 'existing_album',
      targetId: 'alb-B',
      assetSource: { kind: 'selectionHandle', selectionHandleId: 'handle-1' },
    },
  ];
  ```
  Assert no raw `assetIds` in `JSON.stringify(client.calls)`. Assert `searchAssets` ran
  (metadata mode, `limit:20`, no `query`). Assert `resolveAssetSearchFilters` NOT called
  (recency source).
- A==B decline: slots `{ sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'the Drafts album' }`
  → `outcome.status === 'needs_input'`; `listAlbums`/`searchAssets`/`proposeAlbumOperations`
  NOT called; text matches `/same album/i`.
- empty source: `makeContractClient({ albums: [...A,B], handleAssetCount: 0 })` →
  `needs_input`; `proposeAlbumOperations` NOT called.
- from-album not found: `makeContractClient({ albums: [{ id: 'alb-B', albumName: 'Keepers' }] })`,
  fromAlbumRef `Drafts` → `needs_input`; no `searchAssets`/propose.
- to-album not found: albums has only Drafts → `needs_input`; no propose.
- ambiguous from-album (two `Drafts`) → `needs_input`; no propose.
- subjective source `'the good ones'` → `handoff_open`; no `searchAssets`/propose.
- `searchAssets` throws → `failed`.
- `proposeAlbumOperations` returns `{ status: 'error' }` (`planResult` override) → `failed`;
  text does not match `/prepared|moved \d/i`.
- success copy: text matches `/move/i`, includes `20`, `Drafts`, `Keepers`; `successSummary`
  deep-equals `{ workflowKind: 'move_photos_between_albums', fromAlbumName: 'Drafts', toAlbumName: 'Keepers', assetCount: 20 }`.
- singular copy: `handleAssetCount: 1` → text contains `1 matching photo` not `1 photos`.

Run `node --test src/strict-workflows/workflows/move-photos-between-albums.test.mjs` →
expect RED (module not found / assertions fail).

## Step 2 (GREEN): write `move-photos-between-albums.mjs`

Model it on `remove-photos-from-album.mjs` + `add-photos-to-album.mjs`. Full content:

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'move_photos_between_albums';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) =>
  clean(v)
    .replace(/[.?!]+$/u, '')
    .trim();

const normalizeAlbumRef = (value) =>
  clean(value)
    .replace(/^(?:the|my|this|that)\s+/i, '')
    .replace(/\s+album$/i, '')
    .trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
const sourceIsOwnedElsewhere = (s) => SUBJECTIVE_PATTERN.test(s) || tripSourcePattern.test(s);

// "move <source> from <fromAlbum> to <toAlbum>". Greedy source binds the FINAL
// "from … to …" so a date source containing "from" (e.g. "my photos from 2024")
// is preserved. Both from and to are REQUIRED (bare "move … to …" never matches).
const MOVE_PATTERN =
  /\bmove\s+(?<source>.+)\s+from\s+(?<fromAlbum>.+?)\s+to\s+(?<toAlbum>[^.?!]+?)(?:\s+album)?[.?!]*$/i;

const tryMatch = (prompt) => {
  const m = MOVE_PATTERN.exec(prompt);
  if (!m?.groups) return undefined;
  const sourceDescription = cleanSource(m.groups.source);
  const fromAlbumRef = normalizeAlbumRef(m.groups.fromAlbum);
  const toAlbumRef = normalizeAlbumRef(m.groups.toAlbum);
  if (!sourceDescription || !fromAlbumRef || !toAlbumRef) return undefined;
  if (sourceIsOwnedElsewhere(sourceDescription)) return undefined;
  return { sourceDescription, fromAlbumRef, toAlbumRef };
};

const resolveAlbum = async ({ client, albumRef, signal }) => {
  const ref = normalizeAlbumRef(albumRef);
  const result = await client.call('listAlbums', {}, { signal });
  const albums = Array.isArray(result?.albums) ? result.albums : [];
  const matches = albums.filter((a) => clean(a?.albumName).toLowerCase() === ref.toLowerCase());
  return { ref, matches };
};

export const movePhotosBetweenAlbumsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    const fromAlbumRef = normalizeAlbumRef(rawSlots?.fromAlbumRef);
    const toAlbumRef = normalizeAlbumRef(rawSlots?.toAlbumRef);
    if (!sourceDescription || !fromAlbumRef || !toAlbumRef) return null;
    return { sourceDescription, fromAlbumRef, toAlbumRef };
  },

  async run({ client, slots, signal }) {
    const sourceDescription = cleanSource(slots?.sourceDescription);
    const fromRef = normalizeAlbumRef(slots?.fromAlbumRef);
    const toRef = normalizeAlbumRef(slots?.toAlbumRef);

    // Same-album guard BEFORE any tool call (never a no-op plan).
    if (fromRef && toRef && fromRef.toLowerCase() === toRef.toLowerCase()) {
      return needsInput({
        text: `"${fromRef}" and "${toRef}" are the same album — tell me a different destination album to move into.`,
      });
    }

    // Resolve both albums (none/ambiguous → ask).
    const from = await resolveAlbum({ client, albumRef: fromRef, signal });
    if (from.matches.length === 0) {
      return needsInput({
        text: `I could not find an album called "${from.ref}". Which album should I move them out of?`,
      });
    }
    if (from.matches.length > 1) {
      return needsInput({ text: `Multiple albums are called "${from.ref}". Which one should I move them out of?` });
    }
    const to = await resolveAlbum({ client, albumRef: toRef, signal });
    if (to.matches.length === 0) {
      return needsInput({ text: `I could not find an album called "${to.ref}". Which album should I move them into?` });
    }
    if (to.matches.length > 1) {
      return needsInput({ text: `Multiple albums are called "${to.ref}". Which one should I move them into?` });
    }
    const fromAlbum = from.matches[0];
    const toAlbum = to.matches[0];
    const fromAlbumName = clean(fromAlbum.albumName) || from.ref;
    const toAlbumName = clean(toAlbum.albumName) || to.ref;

    // Resolve the source (subjective → handoff; empty → ask).
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
        text: `I could not find any photos matching "${sourceDescription}" to move. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAlbumOperations',
        {
          summary: `Move matching photos from "${fromAlbumName}" to "${toAlbumName}".`,
          operations: [
            {
              type: 'album.removeAssets',
              targetKind: 'existing_album',
              targetId: fromAlbum.id,
              assetSource: { kind: 'selectionHandle', selectionHandleId },
            },
            {
              type: 'album.addAssets',
              summary: 'Add matching photos.',
              targetKind: 'existing_album',
              targetId: toAlbum.id,
              assetSource: { kind: 'selectionHandle', selectionHandleId },
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
      successText: `I prepared a plan to move ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} from "${fromAlbumName}" to "${toAlbumName}". Any that are not already in "${fromAlbumName}" are simply added to "${toAlbumName}". Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, fromAlbumName, toAlbumName, assetCount },
    });
  },
});
```

Note: `album.addAssets` carries an optional per-op `summary` (matches `add_photos_to_album`);
`album.removeAssets` carries none (matches the contract fixture validator, which forbids
extra keys on removeAssets only via the shared validator — it does not reject `summary`,
but keep removeAssets minimal to match `remove_photos_from_album`). Verify the fixture
accepts both ops (it validates `album.removeAssets` strictly and `album.addAssets`
loosely). Run the test file → expect GREEN.

## Step 3: register in `registry.mjs`

- Add `import { movePhotosBetweenAlbumsWorkflow } from './workflows/move-photos-between-albums.mjs';`
- Insert `movePhotosBetweenAlbumsWorkflow,` into `WORKFLOW_FACTORIES` **before**
  `removePhotosFromAlbumWorkflow` and `addPhotosToAlbumWorkflow` (so the `move … from … to …`
  shape is classified before the add/remove regexes). Place it just before
  `removePhotosFromAlbumWorkflow` in the list.
- Add a comment in the ordering block: `move_photos_between_albums` BEFORE
  `remove_photos_from_album`/`add_photos_to_album` (distinct `move … from … to …` shape;
  requires both `from` and `to`).

## Step 4: add the manifest entry in `manifest.mjs`

Insert a `Object.freeze({ … })` entry (place near `remove_photos_from_album`):

```js
Object.freeze({
  kind: 'move_photos_between_albums',
  flow: 'hybrid',
  title: 'Move photos between albums',
  classifierDescription:
    'User wants to MOVE a metadata-describable set of photos out of one album and into another (remove from album A, add to album B) in a single step. Requires both a source album ("from X") and a destination album ("to Y").',
  positiveExamples: Object.freeze([
    'Move my newest 20 photos from Drafts to Keepers',
    'Move my 2024 photos from the Trips album to the Italy album',
    'Move my Berlin photos from Drafts to Berlin Weekend',
  ]),
  negativeExamples: Object.freeze([
    'Add my newest 20 photos to Keepers',
    'Remove my newest 20 photos from Drafts',
    'Move the best ones from Drafts to Keepers',
  ]),
  slots: Object.freeze({
    sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to move.' }),
    fromAlbumRef: Object.freeze({ type: 'string', required: true, description: 'The album to move photos out of.' }),
    toAlbumRef: Object.freeze({ type: 'string', required: true, description: 'The album to move photos into.' }),
  }),
  requiredReadTools: Object.freeze(['listAlbums', 'resolveAssetSearchFilters', 'searchAssets']),
  planTool: 'proposeAlbumOperations',
  supportsContinuation: false,
  matrixRow: Object.freeze({
    capability: 'Move photos between albums',
    tier: 'Solid now',
    workflowOrBoundary:
      'Pi resolves the source + both albums; Gallery owns the compound album.removeAssets + album.addAssets plan (requires both from and to; same-album declines).',
  }),
}),
```

## Step 5: regenerate `manifest.generated.json`

From `agent-runner/`:

```bash
node -e "import('./src/strict-workflows/manifest.mjs').then(m=>{require('fs').writeFileSync('./src/strict-workflows/manifest.generated.json', JSON.stringify(m.WORKFLOW_MANIFEST, null, 2)+'\n');})"
```

(The agent-runner `manifest.test.mjs` "matches the committed JSON mirror" case is the
gate — it deep-equals the parsed JSON against `WORKFLOW_MANIFEST`, so structure is what
matters; the regen above produces it.)

## Step 6: add eval scenarios

**`classification-recall.mjs`** — add near the album workflows:

```js
{
  id: 'recall.move.basic',
  category: 'recall',
  prompt: 'move my newest 20 photos from Drafts to Keepers',
  expect: { kind: 'move_photos_between_albums', slotsSurvive: true, slots: { fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' } },
},
```

**`slot-fidelity.mjs`** — add:

```js
{
  id: 'slots.move.from-to',
  category: 'slots',
  prompt: 'move my newest 20 photos from Drafts to Keepers',
  expect: { kind: 'move_photos_between_albums', slots: { sourceDescription: 'my newest 20 photos', fromAlbumRef: 'Drafts', toAlbumRef: 'Keepers' } },
},
```

**`classification-negatives.mjs`** — add (no-`from` move is not a move; the LLM should not
fabricate a move when only a destination is given):

```js
{ id: 'neg.move.no-from', category: 'negatives', prompt: 'move my newest 20 photos to Keepers', expect: { kind: 'none' } },
```

**`l3-readonly.mjs`** — add a routing case and a plan-proposed case (the plan is
data-dependent: the newest-N must be in the from-album, so gate `planProposed` on `SEEDED`,
mirroring `l3.plan.remove.recency`):

```js
{
  // move_photos_between_albums routing: the "move … from … to …" shape reaches the
  // new workflow live (regex fast-path; distinct move verb + mandatory from/to).
  id: 'l3.recall.move',
  category: 'l3.recall',
  prompt: 'move my newest 20 photos from {album} to {album2}',
  expect: { kind: 'move_photos_between_albums' },
},
{
  // move end-to-end: recency → album.removeAssets + album.addAssets — proposed,
  // never applied. Strongly data-dependent (newest-N must already be in {album}),
  // so SEEDED gates the plan assertion like l3.plan.remove.recency.
  id: 'l3.plan.move.recency',
  category: 'l3.plan',
  prompt: 'move my newest 20 photos from {album} to {album2}',
  expect: { kind: 'move_photos_between_albums', planProposed: SEEDED ? true : undefined },
  threshold: 0.5,
},
```

**IMPORTANT — `{album2}` token:** check `agent-runner/eval/config.mjs` / the L3 driver for
how `{album}` is substituted. If only `{album}` exists, EITHER (a) add an `{album2}`
substitution (second-most-populated album) in the driver, OR (b) simplify the L3 prompts to
use two literal album names the seeded/personal stack is known to have, OR (c) if no second
album can be guaranteed, drop `l3.plan.move.recency` to a routing-only `l3.recall.move`
using a single `{album}` and a literal destination (e.g. `to Keepers`). Pick whichever the
driver supports; document the choice in a comment. Routing must not depend on the albums
existing (classification is pre-lookup), so `l3.recall.move` always holds.

## Step 7: verify GREEN

```bash
cd agent-runner && node --test 'src/**/*.test.mjs'
```

Expect all green including the new file and the `manifest.test.mjs` mirror case. Confirm the
total test count increased and `fail 0`.

Optionally (if the local classifier at 127.0.0.1:8080 is up) run `pnpm -C agent-runner eval`
for L1; if the model is not running, the unit suite + scenario definitions are the slice's
gate (L1/L3 live execution is environment-gated).

## Step 8: commit

```bash
git add agent-runner/ docs/superpowers/plans/2026-06-05-pi-agent-reorg-sharing-people-slice-1-move.md
git commit -m "feat(agent): move_photos_between_albums workflow (G1) — compound remove+add"
```

## Out of scope for this slice

No server changes. No new op/scope. No capability-matrix `.md` regen (deferred to a
consolidated docs step once the server is built for a later slice; the agent-runner
`manifest.generated.json` mirror IS regenerated here and is the per-slice gate).

## Done when

- `node --test 'src/**/*.test.mjs'` green, count up by the new cases, `fail 0`.
- `manifest.test.mjs` mirror case green (JSON regenerated).
- Registry routes `move … from … to …` to `move_photos_between_albums` and does NOT steal
  add/remove prompts (verified by the new negative + the existing add/remove suites staying
  green).
- Committed.
