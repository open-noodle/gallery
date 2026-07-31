/// Stable identity + registry for the Deep filter-sheet sections.
/// The order of the values is the top-to-bottom render order in the deep sheet.
enum FilterSectionId {
  people('people', 'filter_sheet_deep_people_section'),
  places('places', 'filter_sheet_deep_places_section'),
  tags('tags', 'filter_sheet_deep_tags_section'),
  camera('camera', 'filter_sheet_deep_camera_section'),
  when('when', 'filter_sheet_deep_when_section'),
  rating('rating', 'filter_sheet_deep_rating_section'),
  media('media', 'filter_sheet_deep_media_section'),
  toggles('toggles', 'filter_sheet_deep_toggles_section');

  const FilterSectionId(this.storageId, this.titleKey);

  /// Stable string persisted to disk. NEVER renumber/rename existing values.
  final String storageId;

  /// easy_localization key for the section title.
  final String titleKey;

  static FilterSectionId? fromStorageId(String id) {
    for (final section in values) {
      if (section.storageId == id) return section;
    }
    return null;
  }
}
