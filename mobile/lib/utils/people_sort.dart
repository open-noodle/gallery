import 'package:immich_mobile/domain/models/person.model.dart';

/// Orders people for the People surfaces: favorites first, named before unnamed, then
/// name or asset count depending on [sortBy], with id as the tiebreaker so the order is
/// total and stable.
///
/// Mirrors the web `comparePeople` and the local Drift ORDER BY. Hidden people are excluded
/// upstream (`withHidden: false`), so `isHidden` is deliberately not compared.
///
/// Lives here rather than in `people.utils.dart` so the repository layer can sort without
/// transitively importing `flutter/material.dart` and the person-edit modal widgets.
int comparePeople(DriftPerson a, DriftPerson b, PeopleSortBy sortBy) {
  if (a.isFavorite != b.isFavorite) {
    return a.isFavorite ? -1 : 1;
  }

  final aName = a.name.trim();
  final bName = b.name.trim();
  final aHasName = aName.isNotEmpty;
  final bHasName = bName.isNotEmpty;
  if (aHasName != bHasName) {
    return aHasName ? -1 : 1;
  }

  final nameCompare = aName.toLowerCase().compareTo(bName.toLowerCase());
  // Most assets first.
  final countCompare = (b.numberOfAssets ?? 0).compareTo(a.numberOfAssets ?? 0);
  if (aHasName && sortBy == PeopleSortBy.name) {
    if (nameCompare != 0) {
      return nameCompare;
    }
    if (countCompare != 0) {
      return countCompare;
    }
  } else {
    if (countCompare != 0) {
      return countCompare;
    }
    if (nameCompare != 0) {
      return nameCompare;
    }
  }
  return a.id.compareTo(b.id);
}
