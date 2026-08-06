import {
  classifyAgentIdDomainFromLookup,
  countAgentAssetSourceMechanisms,
  validateAgentAssetSourceMechanismCount,
  validateNoAgentAssetSourceMechanisms,
} from 'src/types/agent-asset-source.types';
import { factory } from 'test/small.factory';

describe('Agent asset source types and helpers', () => {
  it('classifies known IDs from Set-backed table lookups and array-backed metadata sources', () => {
    const assetId = factory.uuid();
    const personId = factory.uuid();
    const albumId = factory.uuid();
    const spaceId = factory.uuid();
    const tagId = factory.uuid();
    const selectionHandleId = factory.uuid();
    const sourceRef = 'asset-source:search:01HX9Z4G3F6Q7R8S9T0V1W2X3Y';

    const lookup = {
      asset: new Set([assetId]),
      person: new Set([personId]),
      album: new Set([albumId]),
      space: new Set([spaceId]),
      tag: new Set([tagId]),
      selectionHandle: new Set([selectionHandleId]),
      sourceRef: [sourceRef],
    };

    expect(classifyAgentIdDomainFromLookup(assetId, lookup)).toBe('asset');
    expect(classifyAgentIdDomainFromLookup(personId, lookup)).toBe('person');
    expect(classifyAgentIdDomainFromLookup(albumId, lookup)).toBe('album');
    expect(classifyAgentIdDomainFromLookup(spaceId, lookup)).toBe('space');
    expect(classifyAgentIdDomainFromLookup(tagId, lookup)).toBe('tag');
    expect(classifyAgentIdDomainFromLookup(selectionHandleId, lookup)).toBe('selectionHandle');
    expect(classifyAgentIdDomainFromLookup(sourceRef, lookup)).toBe('sourceRef');
  });

  it('returns unknown safely for missing, empty, or ambiguous IDs', () => {
    const duplicateId = factory.uuid();
    const lookup = {
      asset: new Set([duplicateId]),
      person: new Set([duplicateId]),
    };

    expect(classifyAgentIdDomainFromLookup(factory.uuid(), lookup)).toBe('unknown');
    expect(classifyAgentIdDomainFromLookup('', lookup)).toBe('unknown');
    expect(classifyAgentIdDomainFromLookup(undefined, lookup)).toBe('unknown');
    expect(classifyAgentIdDomainFromLookup(duplicateId, lookup)).toBe('unknown');
  });

  it('counts source mechanisms from assetSource, assetIds, and assetSelectionHandleId', () => {
    expect(
      countAgentAssetSourceMechanisms({
        assetSource: { kind: 'previousSearch', sourceRef: 'asset-source:search:abc12345' },
      }),
    ).toBe(1);
    expect(countAgentAssetSourceMechanisms({ assetIds: [factory.uuid()] })).toBe(1);
    expect(countAgentAssetSourceMechanisms({ assetSelectionHandleId: factory.uuid() })).toBe(1);
    expect(
      countAgentAssetSourceMechanisms({
        assetSource: { kind: 'selectionHandle', selectionHandleId: factory.uuid() },
        assetIds: [factory.uuid()],
        assetSelectionHandleId: factory.uuid(),
      }),
    ).toBe(3);
  });

  it('validates exactly one mechanism for asset-bearing operation inputs', () => {
    expect(
      validateAgentAssetSourceMechanismCount({
        assetSource: { kind: 'previousSearch', sourceRef: 'asset-source:search:abc12345' },
      }),
    ).toEqual({
      valid: true,
      mechanism: 'assetSource',
      fields: ['assetSource'],
    });

    expect(validateAgentAssetSourceMechanismCount({ assetIds: [factory.uuid()] })).toEqual({
      valid: true,
      mechanism: 'assetIds',
      fields: ['assetIds'],
    });

    expect(validateAgentAssetSourceMechanismCount({ assetSelectionHandleId: factory.uuid() })).toEqual({
      valid: true,
      mechanism: 'assetSelectionHandleId',
      fields: ['assetSelectionHandleId'],
    });

    expect(validateAgentAssetSourceMechanismCount({})).toEqual({
      valid: false,
      reason: 'missing_source_mechanism',
      fields: [],
      message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
    });

    expect(
      validateAgentAssetSourceMechanismCount({
        assetSource: { kind: 'previousSearch', sourceRef: 'asset-source:search:abc12345' },
        assetIds: [factory.uuid()],
      }),
    ).toEqual({
      valid: false,
      reason: 'multiple_source_mechanisms',
      fields: ['assetSource', 'assetIds'],
      message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
    });

    expect(
      validateAgentAssetSourceMechanismCount({
        assetIds: [factory.uuid()],
        assetSelectionHandleId: factory.uuid(),
      }),
    ).toEqual({
      valid: false,
      reason: 'multiple_source_mechanisms',
      fields: ['assetIds', 'assetSelectionHandleId'],
      message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
    });

    expect(
      validateAgentAssetSourceMechanismCount({
        assetSource: { kind: 'previousSearch', sourceRef: 'asset-source:search:abc12345' },
        assetSelectionHandleId: factory.uuid(),
      }),
    ).toEqual({
      valid: false,
      reason: 'multiple_source_mechanisms',
      fields: ['assetSource', 'assetSelectionHandleId'],
      message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
    });
  });

  it('validates that non-asset operation inputs omit all source mechanisms', () => {
    expect(validateNoAgentAssetSourceMechanisms({})).toEqual({ valid: true, fields: [] });
    expect(validateNoAgentAssetSourceMechanisms({ assetIds: [factory.uuid()] })).toEqual({
      valid: false,
      reason: 'unexpected_source_mechanism',
      fields: ['assetIds'],
      message: 'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
    });
    expect(
      validateNoAgentAssetSourceMechanisms({
        assetSource: { kind: 'previousSearch', sourceRef: 'asset-source:search:abc12345' },
      }),
    ).toEqual({
      valid: false,
      reason: 'unexpected_source_mechanism',
      fields: ['assetSource'],
      message: 'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
    });
    expect(validateNoAgentAssetSourceMechanisms({ assetSelectionHandleId: factory.uuid() })).toEqual({
      valid: false,
      reason: 'unexpected_source_mechanism',
      fields: ['assetSelectionHandleId'],
      message: 'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
    });
  });
});
