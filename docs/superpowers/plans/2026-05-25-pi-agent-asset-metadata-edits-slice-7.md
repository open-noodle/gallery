# Pi Agent Metadata Capability Matrix Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Pi agent capability matrix so explicit batch asset metadata edits are documented as supported, while place-name-to-coordinate resolution remains a clearly missing capability.

**Architecture:** Treat this as a docs-and-regression slice. The existing `server/src/services/agent-capability-matrix.spec.ts` reads the markdown matrix directly, so add focused assertions there before editing `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`. No production code changes are needed.

**Tech Stack:** Markdown docs, Vitest docs regression in the server package.

---

## Files

- Modify: `server/src/services/agent-capability-matrix.spec.ts`
  - Add a test that locates the `Batch asset metadata edits` row, asserts it is `Solid now`, and asserts it documents `asset.updateMetadata`, supported fields, and coordinate clarification behavior.
  - Assert the `Needs New MCP Tool` section no longer lists generic `Metadata edits`, but still lists place-name-to-coordinate resolution.
- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
  - Add `proposeAssetBatchFromSearch` and `asset.updateMetadata` to the current capability surface.
  - Add the `Batch asset metadata edits` core matrix row.
  - Replace the stale generic `Metadata edits` missing-tool row with `Place-name-to-coordinate metadata edits`.
  - Add metadata-edit smoke prompts.

## Task 1: Capability Matrix Regression

**Files:**

- Modify: `server/src/services/agent-capability-matrix.spec.ts`

- [ ] **Step 1: Write the failing docs regression**

Add this test inside `describe('Pi agent capability matrix', ...)`:

```ts
it('documents explicit batch asset metadata edits as solid while place-name geocoding remains missing', () => {
  const markdown = readMatrix();

  const metadataEditRow = markdown.split('\n').find((line) => line.includes('Batch asset metadata edits'));
  expect(metadataEditRow).toBeDefined();
  expect(metadataEditRow).toContain('Solid now');
  expect(metadataEditRow).toContain('asset.updateMetadata');
  expect(metadataEditRow).toContain('description');
  expect(metadataEditRow).toContain('rating');
  expect(metadataEditRow).toContain('date/time');
  expect(metadataEditRow).toContain('timezone');
  expect(metadataEditRow).toContain('latitude/longitude');
  expect(metadataEditRow).toMatch(/ask.*coordinates|coordinates.*ask/i);

  for (const prompt of [
    'Set the description on the 5 newest photos to Test batch.',
    'Clear the rating from this album.',
    'Shift these scanned photos forward by 2 hours.',
    'Set these photos to latitude 48.8566 and longitude 2.3522.',
    'Set these photos to Paris.',
  ]) {
    expect(markdown).toContain(prompt);
  }

  const needsNewToolHeadingIndex = markdown.indexOf('## Needs New MCP Tool');
  expect(needsNewToolHeadingIndex).not.toBe(-1);
  const needsNewToolSection = markdown.slice(needsNewToolHeadingIndex);
  expect(needsNewToolSection).not.toContain('| Metadata edits ');
  expect(needsNewToolSection).toContain('Place-name-to-coordinate metadata edits');
  expect(needsNewToolSection).toMatch(/forward geocoder|geocod/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts -t 'explicit batch asset metadata edits'
```

Expected: FAIL because the matrix still has no `Batch asset metadata edits` row and the `Needs New MCP Tool` section still has the stale generic `Metadata edits` row.

## Task 2: Matrix Update

**Files:**

- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`

- [ ] **Step 1: Update the current capability surface**

In **Current planning tools**, add this bullet after `summarizePlan`:

```md
- `proposeAssetBatchFromSearch`: proposes reviewable favorite, archive, tag,
  metadata, or rotate operations from a declarative or previous search source.
```

In **Current reviewable operation types**, replace the asset line with:

```md
- Assets: `asset.rotate`, `asset.setFavorite`, `asset.setArchive`,
  `asset.addTag`, `asset.removeTag`, `asset.updateMetadata`.
```

- [ ] **Step 2: Add the core matrix row**

Add this row after `Add or remove tags`:

```md
| Batch asset metadata edits | “Set the description on the 5 newest photos to Test batch.” | Solid now for explicit supported fields | Search or inspect the target set, then propose `asset.updateMetadata` through `proposeAssetBatchFromSearch` or `proposeAlbumOperations`. Supports description, rating, date/time, timezone, and explicit latitude/longitude. | Shows field-level before/after metadata, selected count, representative assets, and coordinate warnings before apply; asks for coordinates instead of guessing place names. | Description update; clear rating; absolute date/time; relative timestamp shift; timezone update; explicit coordinates; place name asks for coordinates; latitude without longitude asks for longitude; apply keeps chat open. |
```

- [ ] **Step 3: Update the missing-tool section**

In **Needs New MCP Tool**, replace:

```md
| Metadata edits | No date/time/location/title/description edit operations. | `asset.updateMetadata` with field-level preview and validation. |
```

with:

```md
| Place-name-to-coordinate metadata edits | No forward geocoder for turning names such as “Paris” into coordinates. | Forward-geocoding resolver with ambiguity handling before `asset.updateMetadata`. |
```

- [ ] **Step 4: Add metadata smoke prompts**

Append these items to **Recommended Product Smoke Prompts** after item 17:

```md
18. “Set the description on the 5 newest photos to Test batch.”
19. “Clear the rating from this album.”
20. “Shift these scanned photos forward by 2 hours.”
21. “Set these photos to latitude 48.8566 and longitude 2.3522.”
22. “Set these photos to Paris.”
```

## Task 3: Verification And Commit

**Files:**

- Modified test and matrix docs from Tasks 1-2.

- [ ] **Step 1: Run focused docs regression**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run lightweight repository checks**

Run:

```bash
git diff --check
git diff -- docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md server/src/services/agent-capability-matrix.spec.ts
```

Expected: No whitespace errors. Diff is limited to the matrix and regression test.

- [ ] **Step 3: Commit and push Slice 7**

Run:

```bash
git add docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md server/src/services/agent-capability-matrix.spec.ts docs/superpowers/plans/2026-05-25-pi-agent-asset-metadata-edits-slice-7.md
git commit -m "docs: update pi metadata capability matrix"
git push
```

Expected: Commit succeeds and branch `explore/pi-agent-brainstorm` is pushed.

## Plan Review

- Spec coverage: Covers Slice 7 by adding the capability matrix row and a regression preventing explicit metadata edits from returning to generic `Needs new tool`.
- TDD coverage: The docs regression is written and run red before the markdown update.
- Edge cases: Keeps place-name-to-coordinate resolution listed as missing, and smoke prompts include both explicit coordinates and place-name clarification.
- Scope: No production implementation changes; only docs plus the docs regression.
