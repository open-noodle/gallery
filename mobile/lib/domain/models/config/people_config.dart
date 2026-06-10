import 'package:immich_mobile/domain/models/person.model.dart';

class PeopleConfig {
  final PeopleSortBy sortBy;

  const PeopleConfig({this.sortBy = PeopleSortBy.photoCount});

  PeopleConfig copyWith({PeopleSortBy? sortBy}) => PeopleConfig(sortBy: sortBy ?? this.sortBy);

  @override
  bool operator ==(Object other) => identical(this, other) || (other is PeopleConfig && other.sortBy == sortBy);

  @override
  int get hashCode => sortBy.hashCode;

  @override
  String toString() => 'PeopleConfig(sortBy: $sortBy)';
}
