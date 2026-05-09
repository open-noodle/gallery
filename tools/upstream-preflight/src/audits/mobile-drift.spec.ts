import { describe, expect, it } from 'vitest';
import { analyzeMobileDriftFiles } from './mobile-drift';

describe('analyzeMobileDriftFiles', () => {
  it('flags shipped Gallery version collisions with incoming upstream versions', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23, 24],
      galleryVersionsShipped: true,
      currentDbRepository: `
        int get schemaVersion => 24;
        from22To23: (m, v23) async {}
        from23To24: (m, v24) async {}
      `,
      currentSnapshots: [
        'drift_schema_v22.json',
        'drift_schema_v23.json',
        'drift_schema_v24.json',
      ],
      upstreamTouchedFiles: [
        'mobile/lib/infrastructure/repositories/db.repository.dart',
        'mobile/drift_schemas/main/drift_schema_v23.json',
        'mobile/drift_schemas/main/drift_schema_v24.json',
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.details.join('\n')).toContain(
      'Upstream touches shipped Gallery Drift version v23/v24',
    );
    expect(result.details.join('\n')).toContain(
      'renumber incoming upstream migrations to v25/v26',
    );
  });

  it('passes when an incoming upstream migration is renumbered above the highest shipped Gallery version', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23, 24, 25],
      galleryVersionsShipped: true,
      expectedGalleryCallbacks: {
        23: ['sharedSpaceEntity'],
        24: ['libraryEntity'],
        25: ['idxSharedSpaceAssetAssetSpace'],
      },
      currentDbRepository: `
        int get schemaVersion => 26;
        from22To23: (m, v23) async { await m.createTable(v23.sharedSpaceEntity); }
        from23To24: (m, v24) async { await m.createTable(v24.libraryEntity); }
        from24To25: (m, v25) async { await m.createIndex(v25.idxSharedSpaceAssetAssetSpace); }
        from25To26: (m, v26) async { await m.renameColumn(v26.remoteAssetEntity, 'duration_in_seconds', v26.remoteAssetEntity.durationMs); }
      `,
      currentSnapshots: [
        'drift_schema_v22.json',
        'drift_schema_v23.json',
        'drift_schema_v24.json',
        'drift_schema_v25.json',
        'drift_schema_v26.json',
      ],
      upstreamTouchedFiles: ['mobile/drift_schemas/main/drift_schema_v23.json'],
    });

    expect(result.ok).toBe(true);
  });

  it('passes when shipped Gallery versions are untouched and callbacks exist', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23, 24],
      galleryVersionsShipped: true,
      currentDbRepository: `
        int get schemaVersion => 24;
        from22To23: (m, v23) async {}
        from23To24: (m, v24) async {}
      `,
      currentSnapshots: [
        'drift_schema_v22.json',
        'drift_schema_v23.json',
        'drift_schema_v24.json',
      ],
      upstreamTouchedFiles: [],
    });

    expect(result.ok).toBe(true);
  });

  it('flags duplicate snapshots, missing snapshots, and missing callback markers', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23],
      galleryVersionsShipped: true,
      expectedGalleryCallbacks: { 23: ['shared_space_entity'] },
      currentDbRepository: `
        int get schemaVersion => 24;
        from22To23: (m, v23) async {}
      `,
      currentSnapshots: [
        'drift_schema_v22.json',
        'drift_schema_v22.json',
        'drift_schema_v24.json',
      ],
      upstreamTouchedFiles: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details.join('\n')).toContain(
      'Duplicate Drift snapshot version v22',
    );
    expect(result.details.join('\n')).toContain('Missing Drift snapshot v23');
    expect(result.details.join('\n')).toContain(
      'from22To23 is missing Gallery marker shared_space_entity',
    );
  });

  it('flags missing callbacks in the full snapshot range', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23, 24],
      galleryVersionsShipped: true,
      currentDbRepository: `
        int get schemaVersion => 25;
        from22To23: (m, v23) async {}
        from23To24: (m, v24) async {}
      `,
      currentSnapshots: [
        'drift_schema_v22.json',
        'drift_schema_v23.json',
        'drift_schema_v24.json',
        'drift_schema_v25.json',
      ],
      upstreamTouchedFiles: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain('Missing migration callback from24To25');
  });

  it('flags duplicate callbacks in the snapshot range', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23, 24],
      galleryVersionsShipped: true,
      currentDbRepository: `
        int get schemaVersion => 24;
        from22To23: (m, v23) async {}
        from22To23: (m, v23) async {}
        from23To24: (m, v24) async {}
      `,
      currentSnapshots: [
        'drift_schema_v22.json',
        'drift_schema_v23.json',
        'drift_schema_v24.json',
      ],
      upstreamTouchedFiles: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain('Duplicate migration callback from22To23');
  });
});
