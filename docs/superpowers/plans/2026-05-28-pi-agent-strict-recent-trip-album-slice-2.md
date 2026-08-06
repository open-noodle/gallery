# Pi Agent Strict Recent Trip Album Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic strict-workflow router that recognizes generic recent-trip album creation requests and extracts `albumName` plus optional `placeHint`.

**Architecture:** Create a small `agent-runner/src/strict-workflows.mjs` module that has no MCP, provider, or runtime side effects. It only parses text and returns either `{ kind: 'create_recent_trip_album', albumName, placeHint? }` or `{ kind: 'unsupported' }`. This slice does not execute any tools or change runtime routing; later slices consume the matcher.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, existing `pnpm --dir agent-runner test`.

---

## Spec Scope

Implements Slice 2 from `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`.

Covered requirements:

- Matches `Create an album for my recent trip to USA`.
- Matches `Make an album for my recent trip`.
- Matches explicit album names.
- Splits combined place and album-name clauses, for example `recent trip to USA called Spring Break`.
- Extracts `USA`, `United States`, and `U.S.` as the same place hint.
- Omits the place hint when extraction is uncertain.
- Rejects highlight requests containing `top`, `best`, or `highlights`.
- Rejects add-to-existing-album, shared-space, question-only, and metadata-edit prompts.

Not included in this slice:

- Calling `findTripCandidates`.
- Calling `proposeAlbumFromSelection`.
- Persisting strict workflow state.
- Bypassing the provider in production runtime.

## File Structure

- Create `agent-runner/src/strict-workflows.mjs`
  - Exports `matchStrictWorkflow(prompt)`.
  - Owns all strict-workflow intent and slot parsing for this first workflow.
- Create `agent-runner/src/strict-workflows.test.mjs`
  - Unit tests for Slice 2 matcher behavior only.

## Task 1: Strict Recent Trip Workflow Router

**Files:**

- Create: `agent-runner/src/strict-workflows.mjs`
- Create: `agent-runner/src/strict-workflows.test.mjs`

- [ ] **Step 1: Write the failing router tests**

Create `agent-runner/src/strict-workflows.test.mjs`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchStrictWorkflow } from './strict-workflows.mjs';

describe('strict workflow router', () => {
  it('matches a USA recent-trip album request', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to USA'), {
      kind: 'create_recent_trip_album',
      albumName: 'USA Trip',
      placeHint: 'USA',
    });
  });

  it('matches a recent-trip album request without a place hint', () => {
    assert.deepEqual(matchStrictWorkflow('Make an album for my recent trip'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
  });

  it('preserves explicit album names', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip called Spring Break'), {
      kind: 'create_recent_trip_album',
      albumName: 'Spring Break',
    });
  });

  it('splits combined place and album-name clauses', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to USA called Spring Break'), {
      kind: 'create_recent_trip_album',
      albumName: 'Spring Break',
      placeHint: 'USA',
    });
  });

  it('normalizes United States aliases to USA', () => {
    for (const prompt of [
      'Create an album for my recent trip to USA',
      'Create an album for my recent trip to United States',
      'Create an album for my recent trip to the United States',
      'Create an album for my recent trip to U.S.',
    ]) {
      assert.equal(matchStrictWorkflow(prompt).placeHint, 'USA', prompt);
      assert.equal(matchStrictWorkflow(prompt).albumName, 'USA Trip', prompt);
    }
  });

  it('omits uncertain place hints instead of guessing', () => {
    assert.deepEqual(matchStrictWorkflow('Create an album for my recent trip to somewhere nice'), {
      kind: 'create_recent_trip_album',
      albumName: 'Recent Trip',
    });
  });

  it('rejects explicit highlight requests', () => {
    for (const prompt of [
      'Create an album of the top highlights for my recent trip to USA',
      'Create an album of the best photos from my recent trip to USA',
      'Pick highlights from my recent trip and make an album',
    ]) {
      assert.deepEqual(matchStrictWorkflow(prompt), { kind: 'unsupported' }, prompt);
    }
  });

  it('rejects non-generic album creation workflows', () => {
    for (const prompt of [
      'Add my recent trip photos to Family',
      'Create a shared space for my recent trip to USA',
      'How many photos are in my recent trip album?',
      'Set the description on my recent trip photos to Vacation',
    ]) {
      assert.deepEqual(matchStrictWorkflow(prompt), { kind: 'unsupported' }, prompt);
    }
  });
});
```

- [ ] **Step 2: Run the tests and verify the expected red failure**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because `agent-runner/src/strict-workflows.mjs` does not exist. The failure should mention `Cannot find module './strict-workflows.mjs'` or an equivalent module resolution error.

- [ ] **Step 3: Add the minimal router implementation**

Create `agent-runner/src/strict-workflows.mjs`:

```js
const unsupported = Object.freeze({ kind: 'unsupported' });

const creationPhrasePattern = /\b(?:create|make|put together)\b/i;
const recentTripPattern = /\brecent\s+trip\b/i;
const albumPattern = /\balbum\b/i;
const highlightPattern = /\b(?:top|best|highlights?|favorite|pick|choose)\b/i;
const nonGenericPattern =
  /\b(?:add|invite|shared\s+space|space|set\s+the\s+description|set\s+description|metadata|rotate|archive|tag)\b/i;
const questionOnlyPattern = /^\s*(?:how many|what|which|when|where|who|why|can you tell me)\b/i;
const explicitAlbumNamePattern = /\b(?:called|named|as)\s+["']?([^"'.?!]+?)["']?\s*[.?!]?$/i;
const placePhrasePattern = /\brecent\s+trip\s+(?:to|in)\s+(.+?)\s*(?:\b(?:called|named|as)\b|[.?!]|$)/i;
const uncertainPlacePattern = /^(?:somewhere|somewhere nice|there|that place|the trip|my trip)$/i;

const cleanSlot = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/i, '')
    .trim();

const normalizePlaceHint = (value) => {
  const cleaned = cleanSlot(value);
  if (!cleaned || uncertainPlacePattern.test(cleaned)) {
    return undefined;
  }

  if (/^(?:USA|U\.S\.|US|United States|the United States)$/i.test(cleaned)) {
    return 'USA';
  }

  return cleaned.length <= 80 ? cleaned : undefined;
};

const extractPlaceHint = (prompt) => {
  const match = prompt.match(placePhrasePattern);
  return match ? normalizePlaceHint(match[1]) : undefined;
};

const extractAlbumName = (prompt, placeHint) => {
  const explicit = prompt.match(explicitAlbumNamePattern);
  if (explicit) {
    return cleanSlot(explicit[1]);
  }

  return placeHint ? `${placeHint} Trip` : 'Recent Trip';
};

export const matchStrictWorkflow = (prompt) => {
  const text = String(prompt ?? '').trim();
  if (!text) {
    return unsupported;
  }

  if (
    !creationPhrasePattern.test(text) ||
    !albumPattern.test(text) ||
    !recentTripPattern.test(text) ||
    highlightPattern.test(text) ||
    nonGenericPattern.test(text) ||
    questionOnlyPattern.test(text)
  ) {
    return unsupported;
  }

  const placeHint = extractPlaceHint(text);
  const albumName = extractAlbumName(text, placeHint);
  if (!albumName) {
    return unsupported;
  }

  return placeHint
    ? { kind: 'create_recent_trip_album', albumName, placeHint }
    : { kind: 'create_recent_trip_album', albumName };
};
```

- [ ] **Step 4: Run the router tests and verify green**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS. The suite should include the new `strict workflow router` tests.

- [ ] **Step 5: Review for future-slice drift**

Check:

```bash
git diff -- agent-runner/src/strict-workflows.mjs agent-runner/src/strict-workflows.test.mjs
```

Expected:

- No MCP calls.
- No production runtime routing changes.
- No e2e runtime changes.
- No provider/session state changes.

- [ ] **Step 6: Commit Slice 2**

Run:

```bash
git add agent-runner/src/strict-workflows.mjs agent-runner/src/strict-workflows.test.mjs docs/superpowers/plans/2026-05-28-pi-agent-strict-recent-trip-album-slice-2.md
git commit -m "feat: add strict recent trip workflow router"
```

Expected: commit succeeds.

## Plan Self-Review

- Spec coverage: all Slice 2 tests and edge cases are named explicitly.
- TDD order: tests are written and run red before implementation.
- Scope: no tool execution, provider bypass, session state, or plan creation is included.
- Type consistency: matcher returns the `StrictWorkflowMatch` shape from the spec.
- Placeholder scan: no TODO/TBD placeholders.
