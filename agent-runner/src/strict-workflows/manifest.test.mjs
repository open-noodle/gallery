import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { WORKFLOW_MANIFEST, getWorkflowManifestEntry, listWorkflowKinds } from './manifest.mjs';
import { createWorkflowRegistry } from './registry.mjs';

describe('strict/hybrid workflow manifest', () => {
  it('exposes unique kinds', () => {
    const kinds = listWorkflowKinds();
    assert.deepEqual(kinds, [...new Set(kinds)]);
    assert.ok(kinds.includes('create_recent_trip_album'));
  });

  // Every routable workflow MUST have a manifest entry: the manifest is the
  // canonical catalog consumed by the LLM classifier prompt, the `isKnownKind`
  // gate, the live dispatch, and the capability matrix. A workflow registered in
  // WORKFLOW_FACTORIES but absent from the manifest is invisible to all of those
  // manifest-driven layers, so it routes fine at the component level (regex over
  // the full registry) yet returns `none` on the live server (PR #574: lock_assets).
  it('has a manifest entry for every registered workflow, and no orphans', () => {
    const registryKinds = createWorkflowRegistry()
      .listWorkflows()
      .map((wf) => wf.kind)
      .sort();
    const manifestKinds = [...listWorkflowKinds()].sort();
    assert.deepEqual(manifestKinds, registryKinds);
  });

  it('describes create_recent_trip_album as a strict workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('create_recent_trip_album');
    assert.equal(entry.flow, 'strict');
    assert.deepEqual(entry.requiredReadTools, ['findTripCandidates']);
    assert.equal(entry.planTool, 'proposeAlbumFromSelection');
    assert.equal(entry.supportsContinuation, true);
    assert.ok(entry.positiveExamples.includes('Create an album for my recent trip to USA'));
    assert.ok(entry.negativeExamples.length > 0);
    assert.equal(entry.matrixRow.capability, 'Create recent trip album');
  });

  it('requires plain-data entries with no functions', () => {
    const serialized = JSON.stringify(WORKFLOW_MANIFEST);
    assert.deepEqual(JSON.parse(serialized).length, WORKFLOW_MANIFEST.length);
    for (const entry of WORKFLOW_MANIFEST) {
      for (const value of Object.values(entry)) {
        assert.notEqual(typeof value, 'function');
      }
    }
  });

  it('returns undefined for unknown kinds', () => {
    assert.equal(getWorkflowManifestEntry('does_not_exist'), undefined);
  });

  it('matches the committed JSON mirror', () => {
    const mirrorPath = fileURLToPath(new URL('./manifest.generated.json', import.meta.url));
    const mirror = JSON.parse(readFileSync(mirrorPath, 'utf8'));
    assert.deepEqual(mirror, JSON.parse(JSON.stringify(WORKFLOW_MANIFEST)));
  });

  it('lists resolveAssetSearchFilters for every entity-source workflow', () => {
    for (const kind of ['add_photos_to_album', 'archive_assets', 'favorite_assets', 'tag_assets', 'create_album_from_source']) {
      assert.ok(getWorkflowManifestEntry(kind).requiredReadTools.includes('resolveAssetSearchFilters'), kind);
    }
  });

  it('describes update_asset_metadata as a hybrid workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('update_asset_metadata');
    assert.equal(entry.flow, 'hybrid');
    assert.equal(entry.planTool, 'proposeAssetBatchFromSelection');
    assert.ok(entry.requiredReadTools.includes('searchAssets'));
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes remove_photos_from_album as a hybrid workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('remove_photos_from_album');
    assert.equal(entry.flow, 'hybrid');
    assert.equal(entry.planTool, 'proposeAlbumOperations');
    assert.ok(entry.requiredReadTools.includes('listAlbums'));
    assert.ok(entry.requiredReadTools.includes('searchAssets'));
    assert.equal(entry.supportsContinuation, false);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes manage_space_assets as a hybrid workflow with space and search tools', () => {
    const entry = getWorkflowManifestEntry('manage_space_assets');
    assert.equal(entry.flow, 'hybrid');
    assert.ok(entry.planTool, 'planTool must be present');
    assert.ok(entry.requiredReadTools.includes('listSpaces'), 'requiredReadTools includes listSpaces');
    assert.ok(entry.requiredReadTools.includes('searchAssets'), 'requiredReadTools includes searchAssets');
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes rotate_assets as a hybrid workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('rotate_assets');
    assert.equal(entry.flow, 'hybrid');
    assert.equal(entry.planTool, 'proposeAssetBatchFromSelection');
    assert.ok(entry.requiredReadTools.includes('searchAssets'), 'requiredReadTools includes searchAssets');
    assert.equal(entry.supportsContinuation, false);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes crop_assets as a hybrid workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('crop_assets');
    assert.equal(entry.flow, 'hybrid');
    assert.equal(entry.planTool, 'proposeAssetBatchFromSelection');
    assert.ok(entry.requiredReadTools.includes('searchAssets'), 'requiredReadTools includes searchAssets');
    assert.equal(entry.supportsContinuation, false);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.equal(entry.matrixRow.capability, 'Crop assets');
    assert.equal(entry.matrixRow.tier, 'Solid now');
  });

  it('describes create_space_from_source as a hybrid workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('create_space_from_source');
    assert.equal(entry.flow, 'hybrid');
    assert.equal(entry.planTool, 'proposeSpaceFromSearch');
    assert.ok(entry.requiredReadTools.includes('searchAssets'), 'requiredReadTools includes searchAssets');
    assert.equal(entry.supportsContinuation, false);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes manage_space_members as a strict workflow with supportsContinuation true', () => {
    const entry = getWorkflowManifestEntry('manage_space_members');
    assert.equal(entry.flow, 'strict');
    assert.equal(entry.planTool, 'proposeAlbumOperations');
    assert.ok(entry.requiredReadTools.includes('listSpaces'), 'requiredReadTools includes listSpaces');
    assert.ok(entry.requiredReadTools.includes('searchUsers'), 'requiredReadTools includes searchUsers');
    assert.equal(entry.supportsContinuation, true);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes change_member_role as a strict workflow with supportsContinuation true', () => {
    const entry = getWorkflowManifestEntry('change_member_role');
    assert.equal(entry.flow, 'strict');
    assert.equal(entry.planTool, 'proposeAlbumOperations');
    assert.ok(entry.requiredReadTools.includes('listSpaces'), 'requiredReadTools includes listSpaces');
    assert.ok(entry.requiredReadTools.includes('searchUsers'), 'requiredReadTools includes searchUsers');
    assert.equal(entry.supportsContinuation, true);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes rename_or_describe_space as a strict workflow with supportsContinuation true', () => {
    const entry = getWorkflowManifestEntry('rename_or_describe_space');
    assert.equal(entry.flow, 'strict');
    assert.equal(entry.planTool, 'proposeAlbumOperations');
    assert.ok(entry.requiredReadTools.includes('listSpaces'), 'requiredReadTools includes listSpaces');
    assert.equal(entry.supportsContinuation, true);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes manage_space_assets as a hybrid workflow with supportsContinuation true', () => {
    const entry = getWorkflowManifestEntry('manage_space_assets');
    assert.equal(entry.flow, 'hybrid');
    assert.ok(entry.requiredReadTools.includes('listSpaces'), 'requiredReadTools includes listSpaces');
    assert.ok(entry.requiredReadTools.includes('searchAssets'), 'requiredReadTools includes searchAssets');
    assert.equal(entry.supportsContinuation, true);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes set_album_cover as a strict workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('set_album_cover');
    assert.equal(entry.flow, 'strict');
    assert.equal(entry.planTool, 'proposeAlbumOperations');
    assert.deepEqual(entry.requiredReadTools, ['listAlbums', 'readAlbum']);
    assert.equal(entry.supportsContinuation, false);
    assert.ok(entry.positiveExamples.length > 0);
    assert.ok(entry.negativeExamples.length > 0);
    assert.ok(entry.matrixRow.capability);
  });

  it('describes visual_cleanup as a hybrid quality-filtered trash workflow', () => {
    const entry = getWorkflowManifestEntry('visual_cleanup');
    assert.equal(entry.flow, 'hybrid');
    assert.deepEqual(entry.requiredReadTools, ['resolveAssetSearchFilters', 'searchAssets', 'curateSelection']);
    assert.equal(entry.planTool, 'proposeAlbumOperations');
    assert.equal(entry.supportsContinuation, false);
    assert.equal(entry.slots.qualityMetric.required, true);
    assert.equal(entry.slots.sourceDescription.required, true);
    assert.equal(entry.matrixRow.capability, 'Visual cleanup');
    assert.equal(entry.matrixRow.tier, 'Solid now');
    assert.match(entry.matrixRow.workflowOrBoundary, /quality-filtered/i);
  });
});
