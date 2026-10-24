import type { SharedSpaceMemberManagementDto } from 'src/dtos/shared-space.dto';
import { SharedSpaceRole } from 'src/enum';

export type SpaceMemberPermissionSettings = {
  editorsCanAddMembers: boolean | null;
  editorsCanChangeRoles: boolean | null;
};

export type ServerMemberPermissionSettings = {
  spaceEditorsCanAddMembers: boolean;
  spaceEditorsCanChangeRoles: boolean;
};

/**
 * Effective member-management permissions of one caller in one space.
 * Owners always have both, viewers and non-members never do, and an editor gets `space ?? server`.
 * Server admins get no bypass.
 */
export function resolveSpaceMemberManagement(
  role: SharedSpaceRole | undefined,
  space: SpaceMemberPermissionSettings,
  server: ServerMemberPermissionSettings,
): SharedSpaceMemberManagementDto {
  const editor = role === SharedSpaceRole.Editor;
  const owner = role === SharedSpaceRole.Owner;
  return {
    editorsCanAddMembers: space.editorsCanAddMembers,
    editorsCanChangeRoles: space.editorsCanChangeRoles,
    serverEditorsCanAddMembers: server.spaceEditorsCanAddMembers,
    serverEditorsCanChangeRoles: server.spaceEditorsCanChangeRoles,
    canAddMembers: owner || (editor && (space.editorsCanAddMembers ?? server.spaceEditorsCanAddMembers)),
    canChangeRoles: owner || (editor && (space.editorsCanChangeRoles ?? server.spaceEditorsCanChangeRoles)),
  };
}
