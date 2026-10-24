import { describe, expect, it } from 'vitest';
import { SharedSpaceRole } from 'src/enum.js';
import { resolveSpaceMemberManagement } from 'src/gallery/utils/space-member-management.js';

const bools = [true, false];
const nullable = [true, false, null];

describe(resolveSpaceMemberManagement.name, () => {
  it('gives owners both permissions for every combination', () => {
    for (const a of nullable) {
      for (const b of nullable) {
        for (const sa of bools) {
          for (const sb of bools) {
            const result = resolveSpaceMemberManagement(
              SharedSpaceRole.Owner,
              { editorsCanAddMembers: a, editorsCanChangeRoles: b },
              { spaceEditorsCanAddMembers: sa, spaceEditorsCanChangeRoles: sb },
            );
            expect(result.canAddMembers).toBe(true);
            expect(result.canChangeRoles).toBe(true);
          }
        }
      }
    }
  });

  it('gives viewers and non-members neither permission', () => {
    for (const role of [SharedSpaceRole.Viewer, undefined]) {
      for (const a of nullable) {
        for (const b of nullable) {
          for (const sa of bools) {
            for (const sb of bools) {
              const result = resolveSpaceMemberManagement(
                role,
                { editorsCanAddMembers: a, editorsCanChangeRoles: b },
                { spaceEditorsCanAddMembers: sa, spaceEditorsCanChangeRoles: sb },
              );
              expect(result.canAddMembers).toBe(false);
              expect(result.canChangeRoles).toBe(false);
            }
          }
        }
      }
    }
  });

  it('resolves editors as space ?? server for every combination', () => {
    for (const a of nullable) {
      for (const b of nullable) {
        for (const sa of bools) {
          for (const sb of bools) {
            const result = resolveSpaceMemberManagement(
              SharedSpaceRole.Editor,
              { editorsCanAddMembers: a, editorsCanChangeRoles: b },
              { spaceEditorsCanAddMembers: sa, spaceEditorsCanChangeRoles: sb },
            );
            expect(result.canAddMembers).toBe(a ?? sa);
            expect(result.canChangeRoles).toBe(b ?? sb);
          }
        }
      }
    }
  });

  it('echoes raw space and server values unchanged', () => {
    expect(
      resolveSpaceMemberManagement(
        SharedSpaceRole.Viewer,
        { editorsCanAddMembers: null, editorsCanChangeRoles: false },
        { spaceEditorsCanAddMembers: true, spaceEditorsCanChangeRoles: false },
      ),
    ).toEqual({
      editorsCanAddMembers: null,
      editorsCanChangeRoles: false,
      serverEditorsCanAddMembers: true,
      serverEditorsCanChangeRoles: false,
      canAddMembers: false,
      canChangeRoles: false,
    });
  });
});
