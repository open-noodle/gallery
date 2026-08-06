import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classificationPass } from './score.mjs';

const base = { kind: 'rename_or_describe_album', parsedSlots: { albumRef: 'Japan' } };

describe('classificationPass — toolSequence', () => {
  it('passes on an exact ordered match', () => {
    const decision = { ...base, toolSequence: ['listAlbums', 'proposeAlbumOperations'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      true,
    );
  });

  it('fails when the order differs', () => {
    const decision = { ...base, toolSequence: ['proposeAlbumOperations', 'listAlbums'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('fails on a redundant extra call (length mismatch)', () => {
    const decision = { ...base, toolSequence: ['listAlbums', 'searchAssets', 'proposeAlbumOperations'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('fails on a missing call', () => {
    const decision = { ...base, toolSequence: ['listAlbums'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('supports asserting no tool calls at all', () => {
    const decision = { kind: 'none', toolSequence: [] };
    assert.equal(classificationPass(decision, { kind: 'none', toolSequence: [] }), true);
  });

  // The check above passes trivially if the new logic sits after the
  // `kind === 'none'` short-circuit, so this is the test that actually pins
  // placement. It MUST fail if the checks are added in the wrong place.
  it('fails a kind:none scenario that nonetheless called tools', () => {
    const decision = { kind: 'none', toolSequence: ['listAlbums'] };
    assert.equal(classificationPass(decision, { kind: 'none', toolSequence: [] }), false);
  });

  it('fails a kind:none scenario that nonetheless proposed a plan', () => {
    const decision = { kind: 'none', planProposed: true, planId: 'plan-1' };
    assert.equal(classificationPass(decision, { kind: 'none', noPlan: true }), false);
  });
});

describe('classificationPass — the raw-asset-id invariant is not opt-in', () => {
  it('fails a decision carrying a leak even when the scenario asserts nothing about it', () => {
    const decision = { ...base, rawAssetIdLeak: 'proposeAlbumOperations.operations[0].assetIds' };
    assert.equal(classificationPass(decision, { kind: base.kind }), false);
  });

  it('fails a negative scenario carrying a leak', () => {
    const decision = { kind: 'none', rawAssetIdLeak: 'proposeAlbumOperations.assetIds' };
    assert.equal(classificationPass(decision, { kind: 'none' }), false);
  });

  it('passes when there is no leak', () => {
    const decision = { ...base, rawAssetIdLeak: null };
    assert.equal(classificationPass(decision, { kind: base.kind }), true);
  });
});

describe('classificationPass — planOps', () => {
  it('passes when every expected op type is present', () => {
    const decision = { ...base, planOps: [{ type: 'album.updateDetails' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), true);
  });

  it('allows extra ops the scenario does not assert', () => {
    const decision = { ...base, planOps: [{ type: 'album.create' }, { type: 'album.addAssets' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.create'] }), true);
  });

  it('ignores order', () => {
    const decision = { ...base, planOps: [{ type: 'album.addAssets' }, { type: 'album.create' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.create', 'album.addAssets'] }), true);
  });

  it('fails when an expected op type is missing', () => {
    const decision = { ...base, planOps: [{ type: 'album.create' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), false);
  });

  it('fails when no plan ops were recorded at all', () => {
    const decision = { ...base, planOps: [] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), false);
  });
});

describe('classificationPass — noPlan', () => {
  it('passes when nothing was proposed', () => {
    const decision = { ...base, planProposed: false, planId: null };
    assert.equal(classificationPass(decision, { kind: base.kind, noPlan: true }), true);
  });

  it('fails when a plan was proposed', () => {
    const decision = { ...base, planProposed: true, planId: 'plan-1' };
    assert.equal(classificationPass(decision, { kind: base.kind, noPlan: true }), false);
  });
});

describe('classificationPass — existing keys still work', () => {
  it('ignores the new keys when a scenario does not opt in', () => {
    const decision = { ...base, toolSequence: ['listAlbums'], planOps: [], planProposed: false };
    assert.equal(classificationPass(decision, { kind: base.kind, slotsSurvive: true }), true);
  });

  it('still fails on the wrong kind', () => {
    const decision = { ...base, toolSequence: [] };
    assert.equal(classificationPass(decision, { kind: 'delete_album', toolSequence: [] }), false);
  });
});
