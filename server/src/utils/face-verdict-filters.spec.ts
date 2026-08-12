import { applyVerdictFilters, isSettledForOwner, targetTokens, VerdictMaps } from 'src/utils/face-repair';
import { describe, expect, it } from 'vitest';

// Slice 3 of the face-review unification. These are the exclusion rules BOTH face engines consult, so they
// are kept pure and exhaustively exampled here rather than only exercised through a scan.
const maps = (overrides: Partial<VerdictMaps> = {}): VerdictMaps => ({
  negativeFaceTargets: new Map(),
  mutedPersons: new Map(),
  ...overrides,
});

describe('targetTokens', () => {
  it.each([
    [{ personId: 'P' }, ['person:P']],
    [{ personId: 'P', identityId: 'I' }, ['identity:I', 'person:P']],
    [{ spacePersonId: 'S', identityId: 'I' }, ['identity:I', 'space-person:S']],
    [{ identityId: 'I' }, ['identity:I']],
    [{}, []],
    [{ personId: null, spacePersonId: null, identityId: null }, []],
  ])('%o -> %o', (target, expected) => {
    expect(targetTokens(target)).toEqual(expected);
  });
});

describe('isSettledForOwner', () => {
  const face = { assetFaceId: 'F', suspectedOwnerId: 'O' };

  it('is settled for every owner when a human already placed the face', () => {
    expect(isSettledForOwner(face, maps({ manualLinkedFaceIds: new Set(['F']) }))).toBe(true);
    expect(
      isSettledForOwner({ assetFaceId: 'F', suspectedOwnerId: 'OTHER' }, maps({ manualLinkedFaceIds: new Set(['F']) })),
    ).toBe(true);
  });

  it('is not settled with no placement and no verdicts', () => {
    expect(isSettledForOwner(face, maps())).toBe(false);
  });

  it('matches a person-keyed verdict against the suspected owner', () => {
    const m = maps({ negativeFaceTargets: new Map([['F', new Set(['person:O'])]]) });
    expect(isSettledForOwner(face, m)).toBe(true);
    expect(isSettledForOwner({ assetFaceId: 'F', suspectedOwnerId: 'OTHER' }, m)).toBe(false);
  });

  it('matches an identity-keyed verdict via the owner tokens (identity-first path)', () => {
    const m = maps({
      negativeFaceTargets: new Map([['F', new Set(['identity:I'])]]),
      ownerTokens: new Map([['O', ['identity:I', 'person:O']]]),
    });
    expect(isSettledForOwner(face, m)).toBe(true);
  });

  it('does not match an identity-keyed verdict for a different identity', () => {
    const m = maps({
      negativeFaceTargets: new Map([['F', new Set(['identity:I'])]]),
      ownerTokens: new Map([['O', ['identity:J', 'person:O']]]),
    });
    expect(isSettledForOwner(face, m)).toBe(false);
  });

  it('matches a person-keyed verdict even when the owner also carries an identity (fallback path)', () => {
    // The verdict predates the person acquiring an identity; the stored target keeps working.
    const m = maps({
      negativeFaceTargets: new Map([['F', new Set(['person:O'])]]),
      ownerTokens: new Map([['O', ['identity:I', 'person:O']]]),
    });
    expect(isSettledForOwner(face, m)).toBe(true);
  });

  it('falls back to the bare person token when the caller supplies no owner tokens', () => {
    const m = maps({ negativeFaceTargets: new Map([['F', new Set(['person:O'])]]) });
    expect(isSettledForOwner(face, m)).toBe(true);
  });

  it('treats an empty verdict set as not settled', () => {
    expect(isSettledForOwner(face, maps({ negativeFaceTargets: new Map([['F', new Set()]]) }))).toBe(false);
  });

  it('is settled when a placement and a verdict both apply (no ordering dependency)', () => {
    const m = maps({
      manualLinkedFaceIds: new Set(['F']),
      negativeFaceTargets: new Map([['F', new Set(['person:O'])]]),
    });
    expect(isSettledForOwner(face, m)).toBe(true);
  });
});

const flagged = (entries: Array<[string, Array<{ assetFaceId: string; suspectedOwnerId: string }>]>) =>
  new Map(entries.map(([personId, faces]) => [personId, faces.map((f) => ({ ...f, currentPersonId: personId }))]));

describe('applyVerdictFilters', () => {
  it('drops a human-placed face from every cluster', () => {
    const byPerson = flagged([['P', [{ assetFaceId: 'F', suspectedOwnerId: 'O' }]]]);
    applyVerdictFilters(byPerson, maps({ manualLinkedFaceIds: new Set(['F']) }));
    expect(byPerson.get('P')).toEqual([]);
  });

  it('drops a face only for the owner it was kept away from', () => {
    const byPerson = flagged([
      [
        'P',
        [
          { assetFaceId: 'F', suspectedOwnerId: 'BOB' },
          { assetFaceId: 'F2', suspectedOwnerId: 'CAROL' },
        ],
      ],
    ]);
    applyVerdictFilters(byPerson, maps({ negativeFaceTargets: new Map([['F', new Set(['person:BOB'])]]) }));
    expect(byPerson.get('P')?.map((f) => f.assetFaceId)).toEqual(['F2']);
  });

  it('keeps a face flagged toward a different owner than the one it was kept away from', () => {
    const byPerson = flagged([['P', [{ assetFaceId: 'F', suspectedOwnerId: 'CAROL' }]]]);
    applyVerdictFilters(byPerson, maps({ negativeFaceTargets: new Map([['F', new Set(['person:BOB'])]]) }));
    expect(byPerson.get('P')?.map((f) => f.assetFaceId)).toEqual(['F']);
  });

  it('drains a person whose every face was settled', () => {
    const byPerson = flagged([['P', [{ assetFaceId: 'F', suspectedOwnerId: 'O' }]]]);
    applyVerdictFilters(byPerson, maps({ manualLinkedFaceIds: new Set(['F']) }));
    expect(byPerson.get('P')).toEqual([]);
  });

  it('drops a muted cluster whose remaining owners are a subset of the fingerprint', () => {
    const byPerson = flagged([['P', [{ assetFaceId: 'F', suspectedOwnerId: 'O' }]]]);
    applyVerdictFilters(byPerson, maps({ mutedPersons: new Map([['P', new Set(['O', 'O2'])]]) }));
    expect(byPerson.get('P')).toEqual([]);
  });

  it('re-surfaces a muted cluster when a new suspected owner appears', () => {
    const byPerson = flagged([['P', [{ assetFaceId: 'F', suspectedOwnerId: 'NEW' }]]]);
    applyVerdictFilters(byPerson, maps({ mutedPersons: new Map([['P', new Set(['O'])]]) }));
    expect(byPerson.get('P')?.map((f) => f.assetFaceId)).toEqual(['F']);
  });

  it('runs per-face filtering before the cluster mute, so a new owner still surfaces', () => {
    // F (old owner O) is settled; F2 (new owner NEW) is not. The cluster stays surfaced because the
    // REMAINING owner set is no longer a subset of the fingerprint.
    const byPerson = flagged([
      [
        'P',
        [
          { assetFaceId: 'F', suspectedOwnerId: 'O' },
          { assetFaceId: 'F2', suspectedOwnerId: 'NEW' },
        ],
      ],
    ]);
    applyVerdictFilters(
      byPerson,
      maps({
        manualLinkedFaceIds: new Set(['F']),
        mutedPersons: new Map([['P', new Set(['O'])]]),
      }),
    );
    expect(byPerson.get('P')?.map((f) => f.assetFaceId)).toEqual(['F2']);
  });

  it('leaves an unsettled cluster untouched', () => {
    const byPerson = flagged([['P', [{ assetFaceId: 'F', suspectedOwnerId: 'O' }]]]);
    applyVerdictFilters(byPerson, maps());
    expect(byPerson.get('P')?.map((f) => f.assetFaceId)).toEqual(['F']);
  });
});
