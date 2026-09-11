import { Reflector } from '@nestjs/core';
import { GameSoloController } from 'src/controllers/game-solo.controller';
import { GameController } from 'src/controllers/game.controller';
import { MetadataKey, Permission } from 'src/enum';

// The API-key scope on `@Authenticated({ permission })` and the in-space ACL (membership/ownership,
// enforced by GameService.requireMember) are different layers. Before Permission.Game* existed, every
// game route - including the ones a solo player must reach without ever joining a shared space -
// demanded sharedSpace.read, so a game-only API key couldn't play alone. Handlers are enumerated off
// the prototype rather than named individually so a route added later without a Permission.Game*
// fails this test instead of quietly keeping (or regaining) a SharedSpace* permission.
// Both game controllers, driven from one list rather than a describe each: the rule is about the
// game routes as a set, and a rule written against one class stops covering the routes the moment
// somebody adds a second controller - which is exactly how the solo routes arrived.
for (const controller of [GameController, GameSoloController]) {
  describe(controller.name, () => {
    const gamePermissions = new Set(
      Object.entries(Permission)
        .filter(([key]) => key.startsWith('Game'))
        .map(([, value]) => value),
    );

    const handlerNames = Object.getOwnPropertyNames(controller.prototype).filter((name) => name !== 'constructor');
    const reflector = new Reflector();

    it('has routes to check', () => {
      expect(handlerNames.length).toBeGreaterThan(0);
    });

    it.each(handlerNames)('gates %s on a Permission.Game* scope, not a shared-space one', (name) => {
      const handler = controller.prototype[name as keyof typeof controller.prototype];
      const options = reflector.get<{ permission?: Permission }>(MetadataKey.AuthRoute, handler);
      const permission = options?.permission;
      // `permission !== undefined &&` narrows for `Set<Permission>.has` below - no cast/assertion, and
      // an unpermissioned route (missing `@Authenticated`, or `@Authenticated()` with no `permission`)
      // correctly fails instead of being coerced away.
      const isGamePermission = permission !== undefined && gamePermissions.has(permission);

      expect(
        isGamePermission,
        `${name} is gated on ${String(permission)}, expected one of: ${[...gamePermissions].join(', ')}`,
      ).toBe(true);
    });
  });
}
