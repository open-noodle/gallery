/**
 * Space member management: ACTOR × SERVER SETTINGS × SPACE SETTINGS × OPERATION matrix.
 *
 * The access and RBAC oracles do not reach the role gates inside SharedSpaceService (`requireRole`), so this
 * file is the RBAC guarantee for "space editors may add members and change viewer/editor roles"
 * (specs/2026-10-24-space-editor-member-management-design.md, "The role matrix").
 *
 * Every combination is enumerated, none hand-picked:
 *   actors     every SharedSpaceRole (owner → the creator) + a promoted co-owner + a non-member user + a
 *              non-member server admin (no bypass)
 *   server     spaceEditorsCanAddMembers {false,true} × spaceEditorsCanChangeRoles {false,true}, written to the
 *              real system-config row and flipped MID-SPEC (the service reads it with `withCache: false`)
 *   space      editorsCanAddMembers {null,true,false} × editorsCanChangeRoles {null,true,false}
 *   operations addMember, updateMember, removeMember, update (the two settings), get
 *
 * The expected outcome comes from `expectedOutcome` below, a truth table that restates the design's rules and
 * today's owner rules. It deliberately does NOT import `resolveSpaceMemberManagement`, so a bug in that helper
 * cannot agree with itself.
 *
 * Per case: the outcome equals the truth table; an allowed mutation leaves the expected post-state; a rejected
 * one leaves the membership table (and the space's settings) byte-for-byte unchanged. The whole outcome grid is
 * snapshotted, so any change to who can do what is a reviewed snapshot diff (`-u`).
 *
 * Mutation-checked: removing the non-owner gate in addMember, in updateMember, or the owner-only check for the
 * two settings in update each fails this spec (see the Task 7 report).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { SharedSpaceRole, SystemMetadataKey } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// ---------------------------------------------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------------------------------------------

/** Every SharedSpaceRole maps to the actor fixture that holds it; a new role fails the coverage test below. */
const ACTOR_FOR_ROLE: Record<string, Actor> = {
  [SharedSpaceRole.Owner]: 'creator',
  [SharedSpaceRole.Editor]: 'editor',
  [SharedSpaceRole.Viewer]: 'viewer',
};
const EXTRA_ACTORS = ['co-owner', 'non-member', 'non-member-admin'] as const;
type Actor = 'creator' | 'editor' | 'viewer' | (typeof EXTRA_ACTORS)[number];
const ACTORS: Actor[] = [...Object.values(SharedSpaceRole).map((role) => ACTOR_FOR_ROLE[role]), ...EXTRA_ACTORS];

type Tri = boolean | null;
type Settings = { serverAdd: boolean; serverChange: boolean; spaceAdd: Tri; spaceChange: Tri };

const BOOLS = [false, true];
const TRIS: Tri[] = [null, true, false];
const SERVER_COMBOS = BOOLS.flatMap((serverAdd) => BOOLS.map((serverChange) => ({ serverAdd, serverChange })));
const SPACE_COMBOS = TRIS.flatMap((spaceAdd) => TRIS.map((spaceChange) => ({ spaceAdd, spaceChange })));

/**
 * Members of every space at the start of every case. `target-editor` / `target-viewer` are bystanders, so the
 * "editor" and "viewer" targets of updateMember / removeMember / addMember are never the acting editor or
 * viewer (that case is covered by the explicit `self` target instead).
 */
const BASELINE: Array<{ fixture: Fixture; role: SharedSpaceRole }> = [
  { fixture: 'creator', role: SharedSpaceRole.Owner },
  { fixture: 'co-owner', role: SharedSpaceRole.Owner },
  { fixture: 'editor', role: SharedSpaceRole.Editor },
  { fixture: 'viewer', role: SharedSpaceRole.Viewer },
  { fixture: 'target-editor', role: SharedSpaceRole.Editor },
  { fixture: 'target-viewer', role: SharedSpaceRole.Viewer },
];
type Fixture = Actor | 'target-editor' | 'target-viewer' | 'target-non-member';

type UpdateTarget = 'creator' | 'co-owner' | 'editor' | 'viewer' | 'self';
const UPDATE_TARGETS: UpdateTarget[] = ['creator', 'co-owner', 'editor', 'viewer', 'self'];
const UPDATE_TARGET_FIXTURE: Record<Exclude<UpdateTarget, 'self'>, Fixture> = {
  creator: 'creator',
  'co-owner': 'co-owner',
  editor: 'target-editor',
  viewer: 'target-viewer',
};

type SettingField = 'editorsCanAddMembers' | 'editorsCanChangeRoles';

type Op =
  | { kind: 'addMember'; role: SharedSpaceRole | undefined; target: 'non-member' | 'existing-viewer' }
  | { kind: 'updateMember'; target: UpdateTarget; role: SharedSpaceRole }
  | { kind: 'removeMember' }
  | { kind: 'update'; field: SettingField; value: Tri; withName: boolean }
  | { kind: 'get' };

const ROLES = [SharedSpaceRole.Owner, SharedSpaceRole.Editor, SharedSpaceRole.Viewer];

const OPS: Op[] = [
  ...[undefined, ...ROLES].flatMap((role) =>
    (['non-member', 'existing-viewer'] as const).map((target): Op => ({ kind: 'addMember', role, target })),
  ),
  ...UPDATE_TARGETS.flatMap((target) => ROLES.map((role): Op => ({ kind: 'updateMember', target, role }))),
  { kind: 'removeMember' },
  ...(['editorsCanAddMembers', 'editorsCanChangeRoles'] as const).flatMap((field) =>
    TRIS.flatMap((value) => BOOLS.map((withName): Op => ({ kind: 'update', field, value, withName }))),
  ),
  { kind: 'get' },
];

const opLabel = (op: Op): string => {
  switch (op.kind) {
    case 'addMember': {
      return `addMember(role=${op.role ?? 'omitted'},target=${op.target})`;
    }
    case 'updateMember': {
      return `updateMember(target=${op.target},role=${op.role})`;
    }
    case 'removeMember': {
      return 'removeMember(target=other-viewer)';
    }
    case 'update': {
      return `update(${op.withName ? 'name+' : ''}${op.field}=${op.value})`;
    }
    case 'get': {
      return 'get';
    }
  }
};

const settingsLabel = (s: Settings) =>
  `server(add=${s.serverAdd},change=${s.serverChange})|space(add=${s.spaceAdd},change=${s.spaceChange})`;

// ---------------------------------------------------------------------------------------------------------------
// Truth table: the rules, restated independently of the production code
// ---------------------------------------------------------------------------------------------------------------

type Expected =
  { outcome: 403 | 400 } | { outcome: 'ok'; role?: SharedSpaceRole; canAddMembers?: boolean; canChangeRoles?: boolean };

const roleOf = (actor: Actor): SharedSpaceRole | undefined => {
  switch (actor) {
    case 'creator':
    case 'co-owner': {
      return SharedSpaceRole.Owner;
    }
    case 'editor': {
      return SharedSpaceRole.Editor;
    }
    case 'viewer': {
      return SharedSpaceRole.Viewer;
    }
    default: {
      // Non-members, including a server admin: no bypass.
      return undefined;
    }
  }
};

/**
 * Effective permissions. Owners: always both on. Editors: `space ?? server`. Viewers and non-members: both off.
 */
const effective = (actor: Actor, s: Settings) => {
  const role = roleOf(actor);
  if (role === SharedSpaceRole.Owner) {
    return { add: true, change: true };
  }
  if (role === SharedSpaceRole.Editor) {
    return { add: s.spaceAdd ?? s.serverAdd, change: s.spaceChange ?? s.serverChange };
  }
  return { add: false, change: false };
};

const expectedOutcome = (actor: Actor, s: Settings, op: Op): Expected => {
  const role = roleOf(actor);
  const isOwner = role === SharedSpaceRole.Owner;
  const isEditor = role === SharedSpaceRole.Editor;
  const { add, change } = effective(actor, s);
  const deny = { outcome: 403 } as const;
  const badRequest = { outcome: 400 } as const;

  switch (op.kind) {
    case 'addMember': {
      // Below editor (viewer, non-member, non-member admin): forbidden.
      if (!isOwner && !isEditor) {
        return deny;
      }
      // Editor gate, before the existence check so a forbidden editor cannot probe membership through the 400.
      if (isEditor) {
        if (!add) {
          return deny;
        }
        if (op.role === SharedSpaceRole.Owner) {
          return deny;
        }
        if (op.role === SharedSpaceRole.Editor && !change) {
          return deny;
        }
      }
      // Existing member: today's 400, for owners and permitted editors alike.
      if (op.target === 'existing-viewer') {
        return badRequest;
      }
      // Owners add any role; omitted → viewer.
      return { outcome: 'ok', role: op.role ?? SharedSpaceRole.Viewer };
    }

    case 'updateMember': {
      if (!isOwner && !isEditor) {
        return deny;
      }
      if (isEditor && !change) {
        return deny;
      }
      const targetFixture = op.target === 'self' ? actor : UPDATE_TARGET_FIXTURE[op.target];
      // Own role: today's 400, after the permission gate.
      if (targetFixture === actor) {
        return badRequest;
      }
      const targetRole = BASELINE.find((m) => m.fixture === targetFixture)!.role;
      if (isEditor) {
        // Editors never change an owner's role, and never make an owner.
        if (targetRole === SharedSpaceRole.Owner) {
          return deny;
        }
        if (op.role === SharedSpaceRole.Owner) {
          return deny;
        }
      }
      // Today's owner rule: nobody demotes the creator (keeping them owner is a no-op).
      if (targetFixture === 'creator' && op.role !== SharedSpaceRole.Owner) {
        return deny;
      }
      // Same-role changes are accepted as no-ops.
      return { outcome: 'ok', role: op.role };
    }

    case 'removeMember': {
      // Removing another member stays owner-only.
      return isOwner ? { outcome: 'ok' } : deny;
    }

    case 'update': {
      // The two settings are owner-only, including a reset to null, and a mixed payload is rejected whole.
      return isOwner ? { outcome: 'ok' } : deny;
    }

    case 'get': {
      if (!role) {
        return deny;
      }
      return { outcome: 'ok', canAddMembers: add, canChangeRoles: change };
    }
  }
};

// ---------------------------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------------------------

const setup = () => {
  const { sut, ctx } = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetRepository,
      // getConfig reads the real system-config row (written by setServerConfig) through these two.
      ConfigRepository,
      // removeMember runs its delete in this.databaseRepository.transaction(...).
      DatabaseRepository,
      PartnerRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
  });
  // addMember / updateMember / removeMember enqueue backfill and reconcile jobs; JobRepository is auto-mocked
  // (unimplemented calls throw), so give queue a no-op resolution.
  ctx.getMock(JobRepository).queue.mockResolvedValue(void 0);
  ctx.getMock(JobRepository).queueAll.mockResolvedValue(void 0);
  return { sut, ctx };
};

type User = { id: string; email: string; isAdmin: boolean };

const SPACE_NAME = 'Matrix space';

const buildWorld = async (ctx: MediumTestContext) => {
  const users = {} as Record<Fixture, User>;
  const fixtures: Fixture[] = [...ACTORS, 'target-editor', 'target-viewer', 'target-non-member'];
  for (const fixture of fixtures) {
    const { user } = await ctx.newUser({ isAdmin: fixture === 'non-member-admin' });
    users[fixture] = { id: user.id, email: user.email, isAdmin: user.isAdmin };
  }

  const spaces: Array<{ id: string; spaceAdd: Tri; spaceChange: Tri }> = [];
  for (const { spaceAdd, spaceChange } of SPACE_COMBOS) {
    const { space } = await ctx.newSharedSpace({
      name: SPACE_NAME,
      createdById: users.creator.id,
      faceRecognitionEnabled: false,
      editorsCanAddMembers: spaceAdd,
      editorsCanChangeRoles: spaceChange,
    });
    for (const { fixture, role } of BASELINE) {
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: users[fixture].id, role });
    }
    spaces.push({ id: space.id, spaceAdd, spaceChange });
  }
  return { users, spaces };
};

const authOf = (user: User) => factory.auth({ user: { id: user.id, email: user.email, isAdmin: user.isAdmin } });

const setServerConfig = (ctx: MediumTestContext, serverAdd: boolean, serverChange: boolean) =>
  ctx.get(SystemMetadataRepository).set(SystemMetadataKey.SystemConfig, {
    server: { spaceEditorsCanAddMembers: serverAdd, spaceEditorsCanChangeRoles: serverChange },
  } as any);

const membersOf = async (db: Kysely<DB>, spaceId: string) =>
  db
    .selectFrom('shared_space_member')
    .selectAll()
    .where('spaceId', '=', spaceId)
    .orderBy('userId')
    .execute()
    .then((rows) => JSON.stringify(rows));

const rolesOf = async (db: Kysely<DB>, spaceId: string) =>
  db
    .selectFrom('shared_space_member')
    .select(['userId', 'role'])
    .where('spaceId', '=', spaceId)
    .orderBy('userId')
    .execute();

const spaceRowOf = (db: Kysely<DB>, spaceId: string) =>
  db
    .selectFrom('shared_space')
    .select(['name', 'editorsCanAddMembers', 'editorsCanChangeRoles'])
    .where('id', '=', spaceId)
    .executeTakeFirstOrThrow();

/** Put a space back to its baseline membership and settings. */
const restore = async (
  db: Kysely<DB>,
  users: Record<Fixture, User>,
  space: { id: string; spaceAdd: Tri; spaceChange: Tri },
) => {
  const baselineIds = BASELINE.map(({ fixture }) => users[fixture].id);
  await db
    .deleteFrom('shared_space_member')
    .where('spaceId', '=', space.id)
    .where('userId', 'not in', baselineIds)
    .execute();
  for (const { fixture, role } of BASELINE) {
    await db
      .insertInto('shared_space_member')
      .values({ spaceId: space.id, userId: users[fixture].id, role })
      .onConflict((oc) => oc.columns(['spaceId', 'userId']).doUpdateSet({ role }))
      .execute();
  }
  await db
    .updateTable('shared_space')
    .set({ name: SPACE_NAME, editorsCanAddMembers: space.spaceAdd, editorsCanChangeRoles: space.spaceChange })
    .where('id', '=', space.id)
    .execute();
};

const byUser = (rows: Array<{ userId: string; role: string }>) =>
  JSON.stringify(rows.map(({ userId, role }) => `${userId}=${role}`).toSorted());

const outcomeOf = (error: unknown): 403 | 400 => {
  if (error instanceof ForbiddenException) {
    return 403;
  }
  if (error instanceof BadRequestException) {
    return 400;
  }
  throw error;
};

// ---------------------------------------------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------------------------------------------

describe('shared space member management role matrix', () => {
  test('actor list covers every SharedSpaceRole', () => {
    for (const role of Object.values(SharedSpaceRole)) {
      expect(ACTOR_FOR_ROLE[role], `no actor fixture for role ${role}`).toBeDefined();
      expect(roleOf(ACTOR_FOR_ROLE[role])).toBe(role);
    }
    expect(new Set(ACTORS).size).toBe(ACTORS.length);
  });

  test('every actor × setting × operation matches the truth table', { timeout: 600_000 }, async () => {
    const { sut, ctx } = setup();
    const db = ctx.database;
    const { users, spaces } = await buildWorld(ctx);

    const grid: Record<string, string> = {};
    const mismatches: string[] = [];
    const baselineRoles = byUser(BASELINE.map(({ fixture, role }) => ({ userId: users[fixture].id, role })));

    // Server settings are flipped mid-spec: every case after a flip must see the new value.
    for (const { serverAdd, serverChange } of SERVER_COMBOS) {
      await setServerConfig(ctx, serverAdd, serverChange);

      for (const space of spaces) {
        const settings: Settings = {
          serverAdd,
          serverChange,
          spaceAdd: space.spaceAdd,
          spaceChange: space.spaceChange,
        };
        let dirty = true;

        for (const actor of ACTORS) {
          const auth = authOf(users[actor]);
          for (const op of OPS) {
            const key = `${actor}|${settingsLabel(settings)}|${opLabel(op)}`;
            if (dirty) {
              await restore(db, users, space);
              dirty = false;
            }

            // Cases never interact: each one starts from the baseline membership and settings.
            const startRoles = await rolesOf(db, space.id);
            const startSpace = await spaceRowOf(db, space.id);
            if (
              byUser(startRoles) !== baselineRoles ||
              startSpace.name !== SPACE_NAME ||
              startSpace.editorsCanAddMembers !== space.spaceAdd ||
              startSpace.editorsCanChangeRoles !== space.spaceChange
            ) {
              throw new Error(`case ${key} did not start from the baseline`);
            }
            const before = await membersOf(db, space.id);

            const expected = expectedOutcome(actor, settings, op);
            let actual: 403 | 400 | 'ok';
            let detail = '';
            let result: Awaited<ReturnType<SharedSpaceService['get']>> | undefined;
            try {
              switch (op.kind) {
                case 'addMember': {
                  const target = op.target === 'non-member' ? users['target-non-member'] : users['target-viewer'];
                  await sut.addMember(auth, space.id, { userId: target.id, ...(op.role && { role: op.role }) });
                  break;
                }
                case 'updateMember': {
                  const target = op.target === 'self' ? users[actor] : users[UPDATE_TARGET_FIXTURE[op.target]];
                  await sut.updateMember(auth, space.id, target.id, { role: op.role });
                  break;
                }
                case 'removeMember': {
                  await sut.removeMember(auth, space.id, users['target-viewer'].id);
                  break;
                }
                case 'update': {
                  await sut.update(auth, space.id, {
                    ...(op.withName && { name: 'Renamed by matrix' }),
                    [op.field]: op.value,
                  });
                  break;
                }
                case 'get': {
                  result = await sut.get(auth, space.id);
                  break;
                }
              }
              actual = 'ok';
            } catch (error) {
              actual = outcomeOf(error);
            }

            const after = await membersOf(db, space.id);
            const afterRoles = await rolesOf(db, space.id);
            const afterSpace = await spaceRowOf(db, space.id);
            const fail = (message: string) => {
              mismatches.push(`${key}: ${message}`);
            };

            if (actual !== expected.outcome) {
              fail(`expected ${expected.outcome}, got ${actual}`);
            }

            if (actual === 'ok') {
              switch (op.kind) {
                case 'addMember': {
                  dirty = true;
                  const row = afterRoles.find((r) => r.userId === users['target-non-member'].id);
                  detail = `:${row?.role}`;
                  if (expected.outcome === 'ok' && row?.role !== expected.role) {
                    fail(`added row has role ${row?.role}, expected ${expected.role}`);
                  }
                  break;
                }
                case 'updateMember': {
                  dirty = true;
                  const targetId = op.target === 'self' ? users[actor].id : users[UPDATE_TARGET_FIXTURE[op.target]].id;
                  const row = afterRoles.find((r) => r.userId === targetId);
                  detail = `:${row?.role}`;
                  if (expected.outcome === 'ok' && row?.role !== expected.role) {
                    fail(`target row has role ${row?.role}, expected ${expected.role}`);
                  }
                  break;
                }
                case 'removeMember': {
                  dirty = true;
                  const stillMember = afterRoles.some((r) => r.userId === users['target-viewer'].id);
                  detail = stillMember ? ':still-member' : ':removed';
                  if (stillMember) {
                    fail('target is still a member');
                  }
                  break;
                }
                case 'update': {
                  dirty = true;
                  detail = `:${op.field}=${afterSpace[op.field]}`;
                  if (afterSpace[op.field] !== op.value) {
                    fail(`${op.field} is ${afterSpace[op.field]}, expected ${op.value}`);
                  }
                  if (op.withName && afterSpace.name !== 'Renamed by matrix') {
                    fail('name was not written');
                  }
                  if (after !== before) {
                    fail('membership changed on a settings update');
                  }
                  break;
                }
                case 'get': {
                  const mm = result?.memberManagement;
                  detail = `:add=${mm?.canAddMembers},change=${mm?.canChangeRoles}`;
                  if (expected.outcome === 'ok') {
                    if (mm?.canAddMembers !== expected.canAddMembers) {
                      fail(`canAddMembers ${mm?.canAddMembers}, expected ${expected.canAddMembers}`);
                    }
                    if (mm?.canChangeRoles !== expected.canChangeRoles) {
                      fail(`canChangeRoles ${mm?.canChangeRoles}, expected ${expected.canChangeRoles}`);
                    }
                  }
                  // The tri-state values and the server defaults are reported as stored, to every member.
                  if (
                    mm?.editorsCanAddMembers !== space.spaceAdd ||
                    mm?.editorsCanChangeRoles !== space.spaceChange ||
                    mm?.serverEditorsCanAddMembers !== serverAdd ||
                    mm?.serverEditorsCanChangeRoles !== serverChange
                  ) {
                    fail(`reported settings ${JSON.stringify(mm)} do not match the stored ones`);
                  }
                  if (after !== before) {
                    fail('membership changed on a read');
                  }
                  break;
                }
              }
            } else {
              // No partial write on any rejection.
              if (after !== before) {
                fail('membership changed on a rejected call');
              }
              if (JSON.stringify(afterSpace) !== JSON.stringify(startSpace)) {
                fail('space settings changed on a rejected call');
              }
            }

            grid[key] = `${actual}${detail}`;
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
    expect(Object.keys(grid)).toHaveLength(ACTORS.length * SERVER_COMBOS.length * SPACE_COMBOS.length * OPS.length);

    const counts: Record<string, number> = {};
    for (const value of Object.values(grid)) {
      const outcome = value.split(':', 1)[0];
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
    const sorted = Object.fromEntries(Object.entries(grid).toSorted(([a], [b]) => a.localeCompare(b)));
    expect({ counts, grid: sorted }).toMatchSnapshot();
  });
});
