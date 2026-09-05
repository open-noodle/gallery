import 'package:immich_mobile/domain/models/person.model.dart';

class PeopleConfig {
  final PeopleSortBy sortBy;
  final PeopleFilterBy filterBy;

  const PeopleConfig({this.sortBy = PeopleSortBy.photoCount, this.filterBy = PeopleFilterBy.all});

  PeopleConfig copyWith({PeopleSortBy? sortBy, PeopleFilterBy? filterBy}) =>
      PeopleConfig(sortBy: sortBy ?? this.sortBy, filterBy: filterBy ?? this.filterBy);

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is PeopleConfig && other.sortBy == sortBy && other.filterBy == filterBy);

  @override
  int get hashCode => sortBy.hashCode ^ filterBy.hashCode;

  @override
  String toString() => 'PeopleConfig(sortBy: $sortBy, filterBy: $filterBy)';
}
