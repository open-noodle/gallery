// gallery-fork: the fork's own tables adopted clampedDateTime in the same change as upstream's
// v33 datetime heal (database.dart `_v33DateTimeColumns`), so they carry the same pre-clamp
// exposure and are healed there too. Column lists are derived from each table's clampedDateTime
// getters; like upstream's list, they are hardcoded and must not follow later schema changes.
const galleryV33DateTimeColumns = <String, List<String>>{
  'library_entity': ['created_at', 'updated_at'],
  'shared_space_entity': ['last_activity_at', 'created_at', 'updated_at'],
  'shared_space_member_entity': ['joined_at'],
  'shared_space_library_entity': ['created_at'],
  'shared_space_album_entity': ['created_at', 'updated_at'],
  'shared_space_album_link_entity': ['created_at', 'updated_at'],
  'shared_space_album_folder_entity': ['created_at', 'updated_at'],
};
