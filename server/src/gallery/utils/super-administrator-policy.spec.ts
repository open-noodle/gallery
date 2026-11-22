import {
  permitsSuperAdministratorOverride,
  type SuperAdministratorActor,
  type SuperAdministratorOperation,
} from 'src/gallery/utils/super-administrator-policy.js';

// Independent acceptance oracle. This is a policy prototype, not a substitute for the real-service
// matrices required before integrating it into endpoint authorization.
const OPERATIONS: SuperAdministratorOperation[] = [
  'asset.read',
  'asset.download',
  'asset.metadata.update',
  'asset.media.edit',
  'asset.jobs.run',
  'asset.share',
  'asset.visibility.update',
  'asset.trash',
  'asset.restore',
  'album.manage',
  'space.manage',
  'library.manage',
  'role.manage',
  'asset.unlock',
  'asset.permanent-delete',
];
const ACTORS: Record<string, Omit<SuperAdministratorActor, 'contextActive'>> = {
  user: { active: true, administrator: false, assigned: false, sessionKind: 'session' },
  administrator: { active: true, administrator: true, assigned: false, sessionKind: 'session' },
  selected: { active: true, administrator: true, assigned: true, sessionKind: 'session' },
  revoked: { active: true, administrator: true, assigned: false, sessionKind: 'session' },
  demoted: { active: true, administrator: false, assigned: true, sessionKind: 'session' },
  deleted: { active: false, administrator: true, assigned: true, sessionKind: 'session' },
  apiKey: { active: true, administrator: true, assigned: true, sessionKind: 'api-key' },
  sharedLink: { active: true, administrator: true, assigned: true, sessionKind: 'shared-link' },
};

const EXPECTED = {
  selected: '111111111111100',
  denied: '000000000000000',
};

describe('super-administrator proposal acceptance grid', () => {
  it('requires a selected active administrator session and refuses both hard exclusions for every operation', () => {
    const outcomes: string[] = [];
    let count = 0;
    for (const [name, actor] of Object.entries(ACTORS)) {
      for (const contextActive of [false, true]) {
        for (const includesLockedContent of [false, true]) {
          for (const permanentlyDeletesAssets of [false, true]) {
            const actual = OPERATIONS.map((operation) => {
              count++;
              return permitsSuperAdministratorOverride(
                { ...actor, contextActive },
                { operation, includesLockedContent, permanentlyDeletesAssets },
              )
                ? '1'
                : '0';
            }).join('');
            const eligible =
              name === 'selected' && contextActive && !includesLockedContent && !permanentlyDeletesAssets;
            expect(actual, `${name}/${contextActive}/${includesLockedContent}/${permanentlyDeletesAssets}`).toBe(
              eligible ? EXPECTED.selected : EXPECTED.denied,
            );
            if (contextActive && !includesLockedContent && !permanentlyDeletesAssets) {
              outcomes.push(`${name}:${actual}`);
            }
          }
        }
      }
    }
    expect(count).toBe(960);
    expect(outcomes.join('\n')).toMatchInlineSnapshot(`
      "user:000000000000000
      administrator:000000000000000
      selected:111111111111100
      revoked:000000000000000
      demoted:000000000000000
      deleted:000000000000000
      apiKey:000000000000000
      sharedLink:000000000000000"
    `);
  });

  it('fails closed on missing facts or an unknown operation', () => {
    const actor = { ...ACTORS.selected, contextActive: true };
    const request = { operation: 'asset.read' as const, includesLockedContent: false, permanentlyDeletesAssets: false };
    expect(permitsSuperAdministratorOverride(actor, request)).toBe(true);
    expect(
      permitsSuperAdministratorOverride(actor, { ...request, operation: 'unknown' as SuperAdministratorOperation }),
    ).toBe(false);
    expect(permitsSuperAdministratorOverride(actor, { operation: 'asset.read' } as typeof request)).toBe(false);
    expect(
      permitsSuperAdministratorOverride(
        { ...actor, assigned: undefined } as unknown as SuperAdministratorActor,
        request,
      ),
    ).toBe(false);
  });
});
