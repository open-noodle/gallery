/**
Executable policy prototype for specs/2026-11-22-super-administrator-design.md.
Not registered with authentication or access checks: returning true here is not an endpoint authorization.
All facts must come from current server-side state, never a request body or a client role flag.
*/
export const SUPER_ADMINISTRATOR_OPERATIONS = [
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
] as const;

export type SuperAdministratorOperation =
  (typeof SUPER_ADMINISTRATOR_OPERATIONS)[number] | 'asset.unlock' | 'asset.permanent-delete';

export type SuperAdministratorActor = {
  active?: boolean;
  administrator?: boolean;
  assigned?: boolean;
  contextActive?: boolean;
  sessionKind?: 'session' | 'api-key' | 'shared-link';
};

export type SuperAdministratorRequest = {
  operation: SuperAdministratorOperation;
  /** Includes every target and every child an operation would implicitly read or change. */
  includesLockedContent?: boolean;
  /** Includes cascading deletion, empty-trash and other indirect permanent-deletion effects. */
  permanentlyDeletesAssets?: boolean;
};

const allowedOperations: ReadonlySet<SuperAdministratorOperation> = new Set(SUPER_ADMINISTRATOR_OPERATIONS);

/** Additional cross-user authority only. A refusal does not redefine the caller's existing owner permissions. */
export const permitsSuperAdministratorOverride = (
  actor: SuperAdministratorActor,
  request: SuperAdministratorRequest,
): boolean =>
  actor.active === true &&
  actor.administrator === true &&
  actor.assigned === true &&
  actor.contextActive === true &&
  actor.sessionKind === 'session' &&
  request.includesLockedContent === false &&
  request.permanentlyDeletesAssets === false &&
  allowedOperations.has(request.operation);
