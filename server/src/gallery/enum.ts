import z from 'zod';

// Wholly fork-defined enums. src/enum.ts re-exports this module, so import them from 'src/enum.js' as usual.
export enum SharedSpaceRole {
  Owner = 'owner',
  Editor = 'editor',
  Viewer = 'viewer',
}

export enum SharedSpaceActivityType {
  AssetAdd = 'asset_add',
  AssetRemove = 'asset_remove',
  AssetEdit = 'asset_edit',
  MemberJoin = 'member_join',
  MemberLeave = 'member_leave',
  MemberRemove = 'member_remove',
  MemberRoleChange = 'member_role_change',
  CoverChange = 'cover_change',
  SpaceRename = 'space_rename',
  SpaceColorChange = 'space_color_change',
  PersonUpdate = 'person_update',
  PersonDelete = 'person_delete',
  PersonMerge = 'person_merge',
  PersonFaceAssign = 'person_face_assign',
  PersonFaceDetach = 'person_face_detach',
  AlbumLink = 'album_link',
  AlbumUnlink = 'album_unlink',
}

export enum TimeBucketSize {
  Year = 'year',
  Month = 'month',
  Day = 'day',
}

export const TimeBucketSizeSchema = z
  .enum(TimeBucketSize)
  .describe('Timeline bucket granularity')
  .meta({ id: 'TimeBucketSize' });
