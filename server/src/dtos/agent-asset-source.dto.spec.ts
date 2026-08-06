import {
  AgentAssetSourceInputDto,
  AgentAssetSourceInputSchema,
  AgentDeclarativeAssetFiltersSchema,
  AgentSourceRefSchema,
  AgentSourceResolutionStatusSchema,
  buildAgentSourceRef,
} from 'src/dtos/agent-asset-source.dto';
import { factory } from 'test/small.factory';

const validSourceRef = 'asset-source:search:01HX9Z4G3F6Q7R8S9T0V1W2X3Y';

describe('Agent asset source DTOs', () => {
  it('accepts a declarative search source with named filters', () => {
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'search',
      mode: 'metadata',
      query: 'South Africa trip',
      filters: {
        country: 'South Africa',
        takenAfter: '2026-01-01T00:00:00.000Z',
        takenBefore: '2026-01-31T23:59:59.999Z',
        people: { match: 'any', names: ['Pierre', 'Aurelia'] },
        tags: { match: 'all', names: ['Travel', 'Family'] },
        albums: { match: 'any', names: ['Trips'] },
        space: { name: 'Family' },
        camera: { make: 'Fujifilm', model: 'X100VI', lensModel: '23mm' },
        rating: 5,
        isFavorite: true,
        isNotInAlbum: false,
        type: 'IMAGE',
        visibility: 'timeline',
        withSharedSpaces: true,
      },
      order: 'desc',
      limit: 100,
      page: 1,
      materialization: 'all-matches-with-limit',
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.kind !== 'search') {
      throw new Error('Expected a parsed search source');
    }
    expect(result.data.filters?.people?.names).toEqual(['Pierre', 'Aurelia']);
  });

  it('accepts declarative named filters with safe choice refs', () => {
    const result = AgentAssetSourceInputDto.schema.safeParse({
      kind: 'search',
      filters: {
        people: {
          match: 'any',
          names: ['Pierre'],
          choiceRefs: ['choice:person:abcDEF1234567890'],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['raw uuid', [factory.uuid()]],
    ['uuid token', [`choice:person:${factory.uuid()}`]],
    ['wrong kind', ['choice:user:abcDEF1234567890']],
    ['duplicate refs', ['choice:person:abcDEF1234567890', 'choice:person:abcDEF1234567890']],
  ])('rejects declarative named filter choice refs with %s', (_label, choiceRefs) => {
    const result = AgentAssetSourceInputDto.schema.safeParse({
      kind: 'search',
      filters: {
        people: { match: 'any', names: ['Pierre'], choiceRefs },
      },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ['people', 'choice:tag:abcDEF1234567890'],
    ['tags', 'choice:person:abcDEF1234567890'],
    ['albums', 'choice:space:abcDEF1234567890'],
  ])('rejects %s choice refs with a mismatched kind', (field, choiceRef) => {
    const result = AgentAssetSourceInputDto.schema.safeParse({
      kind: 'search',
      filters: {
        [field]: { match: 'any', names: ['Pierre'], choiceRefs: [choiceRef] },
      },
    });

    expect(result.success).toBe(false);
  });

  it('accepts a previous search source ref', () => {
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'previousSearch',
      sourceRef: validSourceRef,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a previous search source with a selection source ref', () => {
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'previousSearch',
      sourceRef: 'asset-source:selection:01HX9Z4G3F6Q7R8S9T0V1W2X3Y',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a selection handle source', () => {
    const selectionHandleId = factory.uuid();
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'selectionHandle',
      selectionHandleId,
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.kind !== 'selectionHandle') {
      throw new Error('Expected a parsed selection handle source');
    }
    expect(result.data.selectionHandleId).toBe(selectionHandleId);
  });

  it('accepts an explicit asset source and preserves unique asset IDs', () => {
    const assetIds = [factory.uuid(), factory.uuid()];
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'explicitAssets',
      assetIds,
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.kind !== 'explicitAssets') {
      throw new Error('Expected a parsed explicit asset source');
    }
    expect(result.data.assetIds).toEqual(assetIds);
  });

  it('exposes a createZodDto class for Nest request DTO use', () => {
    expect(
      AgentAssetSourceInputDto.schema.safeParse({ kind: 'previousSearch', sourceRef: validSourceRef }).success,
    ).toBe(true);
  });

  it('accepts structured source resolution statuses and rejects unknown statuses', () => {
    expect(AgentSourceResolutionStatusSchema.safeParse('success').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('needs_clarification').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('recoverable_error').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('denied').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('failed').success).toBe(false);
  });

  it('rejects a source object with a missing kind', () => {
    const result = AgentAssetSourceInputSchema.safeParse({ sourceRef: validSourceRef });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('kind');
  });

  it('rejects an unknown source kind', () => {
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'copiedIds',
      assetIds: [factory.uuid()],
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty, whitespace, and raw UUID source refs', () => {
    const empty = AgentSourceRefSchema.safeParse('');
    const whitespace = AgentSourceRefSchema.safeParse('   ');
    const rawUuid = AgentSourceRefSchema.safeParse(factory.uuid());

    expect(empty.success).toBe(false);
    expect(whitespace.success).toBe(false);
    expect(rawUuid.success).toBe(false);
  });

  it('throws when building a source ref with an invalid token', () => {
    expect(() => buildAgentSourceRef('search', 'bad token')).toThrow();
  });

  it('builds a search source ref accepted by the source ref schema', () => {
    const sourceRef = buildAgentSourceRef('search', '01HX9Z4G3F6Q7R8S9T0V1W2X3Y');

    expect(AgentSourceRefSchema.safeParse(sourceRef).success).toBe(true);
  });

  it('rejects malformed declarative date strings', () => {
    const result = AgentDeclarativeAssetFiltersSchema.safeParse({
      takenAfter: 'January 2026',
      takenBefore: '2026-01-31',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['takenAfter', 'takenBefore']),
    );
  });

  it('requires non-empty people, tag, and album names', () => {
    const result = AgentDeclarativeAssetFiltersSchema.safeParse({
      people: { match: 'any', names: [] },
      tags: { match: 'any', names: [''] },
      albums: { match: 'any', names: ['   '] },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['people.names', 'tags.names.0', 'albums.names.0']),
    );
  });

  it('rejects explicit asset sources with duplicate asset IDs', () => {
    const assetId = factory.uuid();
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'explicitAssets',
      assetIds: [assetId, assetId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain('assetIds must be unique');
  });
});
