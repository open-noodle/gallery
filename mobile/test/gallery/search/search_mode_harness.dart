import 'dart:async';

import 'package:drift/drift.dart' show DatabaseConnection, Value;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/user/user.drift.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/feature_message.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_options.model.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/feature_message.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

// Widget-test harness for search mode on the real Photos page (MainTimelinePage): the real timeline, search providers
// and widgets, over an in-memory database for the normal timeline and either a [FakeSearchRepository] (a small library
// whose options and results narrow like the server's) or the strict contract server (the e2e test).

const testUserId = 'user-me';

final testUser = UserDto(id: testUserId, email: 'me@example.com', name: 'Me', profileChangedAt: DateTime(2024));

class _MockApiService extends Mock implements ApiService {}

class _MockUserService extends Mock implements UserService {}

class _StubFeatureMessages implements FeatureMessageService {
  @override
  bool shouldShow() => false;

  @override
  Future<void> markSeen() async {}
}

class _StubUser extends CurrentUserProvider {
  _StubUser(super.service, UserDto user) {
    state = user;
  }
}

/// One asset of the fake library.
class FakeAsset {
  final String id;
  final DateTime taken;
  final List<String> people;
  final List<String> tags;
  final String? country;
  final String? city;
  final bool video;
  final bool favorite;
  final int? rating;
  final String? make;
  final String? model;
  final bool inAlbum;
  final String? ocr;
  final String? description;
  final bool archived;

  /// Whose photo it is: mine unless said otherwise.
  final String owner;

  /// The upload date (Recently added's order); the taken date unless said otherwise.
  final DateTime? uploadedAt;

  const FakeAsset(
    this.id,
    this.taken, {
    this.people = const [],
    this.tags = const [],
    this.country,
    this.city,
    this.video = false,
    this.favorite = false,
    this.rating,
    this.make,
    this.model,
    this.inAlbum = false,
    this.ocr,
    this.description,
    this.archived = false,
    this.owner = testUserId,
    this.uploadedAt,
  });

  String get fileName => '$id.jpg';

  DateTime get uploaded => uploadedAt ?? taken;

  FakeAsset copyWith({List<String>? tags, int? Function()? rating, bool? video}) => FakeAsset(
    id,
    taken,
    people: people,
    tags: tags ?? this.tags,
    country: country,
    city: city,
    video: video ?? this.video,
    favorite: favorite,
    rating: rating == null ? this.rating : rating(),
    make: make,
    model: model,
    inAlbum: inAlbum,
    ocr: ocr,
    description: description,
    archived: archived,
    owner: owner,
    uploadedAt: uploadedAt,
  );
}

class FakePerson {
  final String id;
  final String name;
  final bool pet;

  const FakePerson(this.id, this.name, {this.pet = false});

  String get filterId => 'person:$id';
}

class FakeTag {
  final String id;
  final String value;

  const FakeTag(this.id, this.value);
}

/// The fake library most tests search: Anna and Ben in Kyoto, Anna and Rex in Lisbon, Berlin without people.
class FakeLibrary {
  final List<FakeAsset> assets;
  final List<FakePerson> people;
  final List<FakeTag> tags;

  const FakeLibrary({required this.assets, this.people = const [], this.tags = const []});

  static final standard = FakeLibrary(
    people: const [
      FakePerson('anna', 'Anna'),
      FakePerson('ben', 'Ben'),
      FakePerson('rex', 'Rex', pet: true),
      FakePerson('alex', 'Alex'),
    ],
    tags: const [FakeTag('beach', 'beach'), FakeTag('food', 'food')],
    assets: [
      FakeAsset(
        'kyoto-1',
        DateTime(2024, 6, 3, 10),
        people: const ['anna', 'ben'],
        tags: const ['beach', 'food'],
        country: 'Japan',
        city: 'Kyoto',
        favorite: true,
        rating: 5,
        make: 'Fujifilm',
        model: 'X-T5',
        inAlbum: true,
        ocr: 'lunch menu',
      ),
      FakeAsset(
        'kyoto-2',
        DateTime(2024, 6, 2, 10),
        people: const ['anna'],
        country: 'Japan',
        city: 'Kyoto',
        rating: 3,
        make: 'Fujifilm',
        model: 'X-T5',
        ocr: 'menu board',
      ),
      FakeAsset(
        'kyoto-3',
        DateTime(2024, 6, 1, 10),
        people: const ['ben'],
        country: 'Japan',
        city: 'Kyoto',
        make: 'Apple',
        model: 'iPhone 15',
      ),
      FakeAsset(
        'lisbon-1',
        DateTime(2023, 9, 10, 10),
        people: const ['anna', 'rex'],
        country: 'Portugal',
        city: 'Lisbon',
        favorite: true,
        rating: 4,
        make: 'Apple',
        model: 'iPhone 15',
        ocr: 'cafe receipt',
        description: 'dinner with friends',
      ),
      FakeAsset('porto-1', DateTime(2023, 8, 1, 10), tags: const ['food'], country: 'Portugal', city: 'Porto'),
      FakeAsset('berlin-1', DateTime(2024, 2, 14, 10), country: 'Germany', city: 'Berlin', video: true),
      FakeAsset('alex-1', DateTime(2022, 3, 5, 10), people: const ['alex'], country: 'Germany', city: 'Berlin'),
      // Archived: outside every timeline-visibility result; only Archived only reaches it.
      FakeAsset('osaka-1', DateTime(2022, 12, 1, 10), country: 'Japan', city: 'Osaka', archived: true),
    ],
  );

  /// The same people and tags over other assets.
  FakeLibrary withAssets(List<FakeAsset> assets) => FakeLibrary(people: people, tags: tags, assets: assets);

  /// The same library with no tags at all.
  FakeLibrary withoutTags() => FakeLibrary(
    people: people,
    assets: [for (final a in assets) a.copyWith(tags: const [])],
  );

  String personName(String id) => people.firstWhere((p) => p.id == id).name;
  String tagValue(String id) => tags.firstWhere((t) => t.id == id).value;
}

/// A [GallerySearchRepository] over a [FakeLibrary], narrowing like the server: every dimension with every other
/// filter applied, people and tags including their own filter, places and time excluding theirs.
class FakeSearchRepository implements GallerySearchRepository {
  FakeLibrary library;
  SearchServerCapabilities serverCapabilities;

  /// One line per call: `options [dims]`, `buckets`, `bucket <month>`, `smart`.
  final calls = <String>[];

  /// The parameters of every results call (buckets, smart, metadata), in order.
  final resultParams = <SearchParams>[];

  /// Every options request's parameters, in order.
  final optionsParams = <SearchParams>[];

  /// Single-dimension options requests wait for their completer here: a dimension still on its way.
  final held = <SearchDimension, Completer<void>>{};

  /// While set, options answers come from this older library, marked stale: the server's cache after a change (a new
  /// favourite, an upload), served while it refreshes.
  FakeLibrary? staleLibrary;

  /// While set, every results request (buckets, smart, metadata) waits for it: a search still on its way.
  Completer<void>? heldResults;

  /// False: an older server, whose people carry no `isPet`.
  bool sendsPersonTypes = true;

  /// Single-dimension options requests for these dimensions fail with [failure].
  final failing = <SearchDimension>{};

  /// The availability request (no dimensions) fails with [failure].
  bool failAvailability = false;

  /// What a failing options request throws: a session the server no longer accepts, by default.
  Exception failure = api.ApiException(401, 'Unauthorized');

  FakeSearchRepository(
    this.library, {
    this.serverCapabilities = const SearchServerCapabilities(
      isGallery: true,
      searchOptions: true,
      localTakenRange: true,
    ),
  });

  static String _personId(String filterId) => filterId.contains(':') ? filterId.split(':').last : filterId;

  bool _matches(
    FakeAsset a,
    SearchParams p, {
    bool people = true,
    bool tags = true,
    bool place = true,
    bool time = true,
    bool untagged = true,
    bool camera = true,
    bool rating = true,
    bool media = true,
  }) {
    // Timeline visibility leaves archived photos out; archive visibility keeps only them; none keeps both.
    if (p.visibility == SearchVisibility.timeline && a.archived) {
      return false;
    }
    if (p.visibility == SearchVisibility.archive && !a.archived) {
      return false;
    }
    if (p.isFavorite == true && !a.favorite) {
      return false;
    }
    if (p.ownerId != null && a.owner != p.ownerId) {
      return false;
    }
    // Someone else's photo only through a partner or a space: as on the server, a request that widens to neither
    // (Favorites, the owner-only screens) stays with mine.
    if (a.owner != testUserId && p.withSharedSpaces != true && p.withPartners != true) {
      return false;
    }
    if (p.isInAlbum == true && !a.inAlbum) {
      return false;
    }
    if (p.isNotInAlbum == true && a.inAlbum) {
      return false;
    }
    bool contains(String? value, String? needle) =>
        needle == null || (value ?? '').toLowerCase().contains(needle.toLowerCase());
    if (!contains(a.ocr, p.ocr) ||
        !contains(a.description, p.description) ||
        !contains(a.fileName, p.originalFileName)) {
      return false;
    }
    if (camera && (p.make != null && a.make != p.make || p.model != null && a.model != p.model)) {
      return false;
    }
    // A minimum, as on every fork filter surface.
    if (rating && p.minRating != null && (a.rating ?? 0) < p.minRating!) {
      return false;
    }
    if (people && p.personIds != null && !p.personIds!.map(_personId).every(a.people.contains)) {
      return false;
    }
    if (tags) {
      if (untagged && p.untagged && a.tags.isNotEmpty) {
        return false;
      }
      final ids = p.tagIds;
      if (ids != null && ids.isNotEmpty) {
        // Browse matches any of the tags, a query all of them.
        final any = p.query == null && p.queryAssetId == null;
        if (any ? !ids.any(a.tags.contains) : !ids.every(a.tags.contains)) {
          return false;
        }
      }
    }
    if (place) {
      if (p.country != null && a.country != p.country) {
        return false;
      }
      if (p.city != null && a.city != p.city) {
        return false;
      }
    }
    if (time) {
      final taken = DateTime.utc(a.taken.year, a.taken.month, a.taken.day, a.taken.hour);
      if (p.takenAfter != null && taken.isBefore(p.takenAfter!)) {
        return false;
      }
      if (p.takenBefore != null && !taken.isBefore(p.takenBefore!)) {
        return false;
      }
    }
    if (media && p.type == SearchMediaType.video && !a.video) {
      return false;
    }
    if (media && p.type == SearchMediaType.image && a.video) {
      return false;
    }
    return true;
  }

  List<FakeAsset> results(SearchParams p) =>
      [...library.assets.where((a) => _matches(a, p))]..sort((a, b) => b.taken.compareTo(a.taken));

  @override
  Future<SearchServerCapabilities> capabilities() async => serverCapabilities;

  @override
  Future<SearchOptionsPart> options(SearchParams p, {Set<SearchDimension> dimensions = const {}}) async {
    optionsParams.add(p);
    final old = staleLibrary;
    if (old != null) {
      final current = library;
      staleLibrary = null;
      library = old;
      try {
        final part = await options(p, dimensions: dimensions);
        return SearchOptionsPart(
          stale: true,
          availability: part.availability,
          total: part.total,
          months: part.months,
          people: part.people,
          hasUnnamedPeople: part.hasUnnamedPeople,
          tags: part.tags,
          countries: part.countries,
          cameras: part.cameras,
          ratings: part.ratings,
          mediaTypes: part.mediaTypes,
        );
      } finally {
        library = current;
        staleLibrary = old;
      }
    }
    calls.add('options ${dimensions.map((d) => d.name).join(',')}');
    final hold = dimensions.length == 1 ? held[dimensions.single] : null;
    if (hold != null) {
      await hold.future;
    }
    if (dimensions.isEmpty ? failAvailability : dimensions.length == 1 && failing.contains(dimensions.single)) {
      throw failure;
    }
    final all = results(p);
    final forPeople = all;
    // As the server: Untagged belongs to the tags dimension, so the tag list ignores it.
    final forTags = library.assets.where((a) => _matches(a, p, untagged: false)).toList();
    final forPlaces = library.assets.where((a) => _matches(a, p, place: false)).toList();
    final forTime = library.assets.where((a) => _matches(a, p, time: false)).toList();

    final selectedPeople = {...?p.personIds?.map(_personId)};
    final peopleCounts = <String, int>{};
    for (final a in forPeople) {
      for (final person in a.people) {
        peopleCounts[person] = (peopleCounts[person] ?? 0) + 1;
      }
    }
    final people = [
      for (final person in library.people)
        if (peopleCounts[person.id] != null)
          SearchPersonOption(
            filterId: person.filterId,
            name: person.name,
            count: peopleCounts[person.id],
            isSelected: selectedPeople.contains(person.id),
            profileId: person.id,
            profileType: 'user-person',
            isPet: sendsPersonTypes ? person.pet : null,
          ),
    ]..sort((a, b) => b.count!.compareTo(a.count!));

    final tagCounts = <String, int>{};
    for (final a in forTags) {
      for (final tag in a.tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }
    final tags = [
      for (final tag in library.tags)
        if (tagCounts[tag.id] != null)
          SearchTagOption(
            id: tag.id,
            value: tag.value,
            count: tagCounts[tag.id],
            isSelected: p.tagIds?.contains(tag.id) ?? false,
          ),
    ];

    final countryCounts = <String, int>{};
    final cityCounts = <String, Map<String, int>>{};
    for (final a in forPlaces) {
      if (a.country == null) {
        continue;
      }
      countryCounts[a.country!] = (countryCounts[a.country!] ?? 0) + 1;
      final cities = cityCounts.putIfAbsent(a.country!, () => {});
      cities[a.city!] = (cities[a.city!] ?? 0) + 1;
    }
    // Most photos first, then by name: the server's order (byKeyCount in smart-facet.repository.ts).
    List<String> byCount(Map<String, int> counts) =>
        counts.keys.toList()..sort((a, b) => counts[b]! != counts[a]! ? counts[b]! - counts[a]! : a.compareTo(b));
    final countries = [
      for (final country in byCount(countryCounts))
        SearchCountryOption(
          country: country,
          count: countryCounts[country],
          cities: [
            for (final city in byCount(cityCounts[country]!))
              SearchCityOption(city: city, count: cityCounts[country]![city]),
          ],
        ),
    ];

    final monthCounts = <DateTime, int>{};
    for (final a in forTime) {
      final month = DateTime(a.taken.year, a.taken.month);
      monthCounts[month] = (monthCounts[month] ?? 0) + 1;
    }
    final months = [
      for (final month in monthCounts.keys.toList()..sort((a, b) => b.compareTo(a)))
        SearchMonthCount(year: month.year, month: month.month, count: monthCounts[month]!),
    ];

    // Cameras, ratings and media types each ignore their own filter, as the server's lists do.
    final forCameras = library.assets.where((a) => _matches(a, p, camera: false)).toList();
    final makeCounts = <String, Map<String, int>>{};
    for (final a in forCameras) {
      if (a.make == null) {
        continue;
      }
      final models = makeCounts.putIfAbsent(a.make!, () => {});
      models[a.model ?? ''] = (models[a.model ?? ''] ?? 0) + 1;
    }
    final cameras = [
      for (final make in makeCounts.keys.toList()..sort())
        SearchCameraMakeOption(
          make: make,
          count: makeCounts[make]!.values.fold<int>(0, (sum, c) => sum + c),
          models: [
            for (final model in makeCounts[make]!.keys.toList()..sort())
              SearchCameraModelOption(model: model, count: makeCounts[make]![model]),
          ],
        ),
    ];
    final forRatings = library.assets.where((a) => _matches(a, p, rating: false)).toList();
    final ratingCounts = <int, int>{};
    for (final a in forRatings) {
      if (a.rating != null && a.rating! > 0) {
        ratingCounts[a.rating!] = (ratingCounts[a.rating!] ?? 0) + 1;
      }
    }
    final ratings = [
      for (final rating in ratingCounts.keys.toList()..sort((a, b) => b.compareTo(a)))
        SearchRatingOption(rating: rating, count: ratingCounts[rating]),
    ];
    final forMedia = library.assets.where((a) => _matches(a, p, media: false)).toList();
    final images = forMedia.where((a) => !a.video).length;
    final videos = forMedia.where((a) => a.video).length;
    final mediaTypes = [
      if (images > 0) SearchMediaTypeOption(type: 'IMAGE', count: images),
      if (videos > 0) SearchMediaTypeOption(type: 'VIDEO', count: videos),
    ];

    final wants = dimensions;
    return SearchOptionsPart(
      availability: wants.isEmpty
          ? SearchAvailability(
              hasAssets: all.isNotEmpty,
              hasPeople: people.isNotEmpty,
              hasTags: tags.isNotEmpty,
              hasPlaces: countries.isNotEmpty,
              hasCameras: cameras.isNotEmpty,
              hasRatings: ratings.isNotEmpty,
              hasImages: images > 0,
              hasVideos: videos > 0,
              hasFavorites: all.any((a) => a.favorite),
              hasAssetsInAlbum: all.any((a) => a.inAlbum),
              hasAssetsNotInAlbum: all.any((a) => !a.inAlbum),
            )
          : null,
      total: wants.contains(SearchDimension.total) ? all.length : null,
      months: wants.contains(SearchDimension.time) ? months : null,
      people: wants.contains(SearchDimension.people) ? people : null,
      hasUnnamedPeople: wants.contains(SearchDimension.people) ? false : null,
      tags: wants.contains(SearchDimension.tags) ? tags : null,
      countries: wants.contains(SearchDimension.places) ? countries : null,
      cameras: wants.contains(SearchDimension.cameras) ? cameras : null,
      ratings: wants.contains(SearchDimension.ratings) ? ratings : null,
      mediaTypes: wants.contains(SearchDimension.mediaTypes) ? mediaTypes : null,
    );
  }

  static String _monthKey(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-01';

  @override
  Future<List<api.TimeBucketsResponseDto>> timeBuckets(
    SearchParams p, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) async {
    calls.add('buckets');
    resultParams.add(p);
    await heldResults?.future;
    final counts = <String, int>{};
    for (final a in results(p)) {
      final key = _monthKey(byUploadDate ? a.uploaded : a.taken);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    final keys = counts.keys.toList()..sort((a, b) => sort == SearchSort.oldest ? a.compareTo(b) : b.compareTo(a));
    return [for (final key in keys) api.TimeBucketsResponseDto(count: counts[key]!, timeBucket: key)];
  }

  @override
  Future<api.TimeBucketAssetResponseDto?> timeBucket(
    SearchParams p,
    String timeBucket, {
    required SearchSort sort,
    bool byUploadDate = false,
  }) async {
    calls.add('bucket $timeBucket');
    DateTime date(FakeAsset a) => byUploadDate ? a.uploaded : a.taken;
    final assets = results(p).where((a) => _monthKey(date(a)) == timeBucket).toList()
      ..sort((a, b) => sort == SearchSort.oldest ? date(a).compareTo(date(b)) : date(b).compareTo(date(a)));
    return api.TimeBucketAssetResponseDto(
      id: [for (final a in assets) a.id],
      ownerId: [for (final a in assets) a.owner],
      fileCreatedAt: [for (final a in assets) a.taken.toIso8601String()],
      createdAt: [for (final a in assets) a.uploaded.toIso8601String()],
      duration: [for (final _ in assets) null],
      isFavorite: [for (final a in assets) a.favorite],
      isImage: [for (final a in assets) !a.video],
      isTrashed: [for (final _ in assets) false],
      livePhotoVideoId: [for (final _ in assets) null],
      localOffsetHours: [for (final _ in assets) 0],
      projectionType: [for (final _ in assets) null],
      ratio: [for (final _ in assets) 1],
      thumbhash: [for (final _ in assets) null],
      visibility: [for (final a in assets) a.archived ? api.AssetVisibility.archive : api.AssetVisibility.timeline],
    );
  }

  @override
  Future<api.SearchResponseDto?> smart(
    SearchParams p, {
    required int page,
    required SearchSort sort,
    int size = 100,
  }) async {
    calls.add('smart');
    resultParams.add(p);
    await heldResults?.future;
    final assets = results(p);
    return api.SearchResponseDto(
      albums: api.SearchAlbumResponseDto(count: 0, facets: const [], items: const [], total: 0),
      assets: api.SearchAssetResponseDto(
        count: assets.length,
        facets: const [],
        items: [for (final a in assets) _assetDto(a)],
        nextPage: null,
        total: assets.length,
      ),
    );
  }

  static api.AssetResponseDto _assetDto(FakeAsset a) => api.AssetResponseDto(
    id: a.id,
    checksum: 'checksum-${a.id}',
    createdAt: a.uploaded,
    duration: 0,
    fileCreatedAt: a.taken,
    fileModifiedAt: a.taken,
    hasMetadata: true,
    height: 100,
    isArchived: false,
    isEdited: false,
    isFavorite: false,
    isOffline: false,
    isTrashed: false,
    localDateTime: a.taken,
    originalFileName: '${a.id}.jpg',
    originalPath: '/${a.id}.jpg',
    ownerId: a.owner,
    thumbhash: null,
    type: a.video ? api.AssetTypeEnum.VIDEO : api.AssetTypeEnum.IMAGE,
    updatedAt: a.taken,
    visibility: api.AssetVisibility.timeline,
    width: 100,
  );

  @override
  Future<api.SearchResponseDto?> metadata(
    SearchParams p, {
    required int page,
    required SearchSort sort,
    int size = 100,
  }) => smart(p, page: page, sort: sort, size: size);

  @override
  Future<int?> statistics(SearchParams p) async => results(p).length;

  @override
  Future<api.AssetResponseDto?> assetInfo(String id) async {
    calls.add('asset $id');
    final asset = library.assets.where((a) => a.id == id).firstOrNull;
    return asset == null ? null : _assetDto(asset);
  }

  @override
  Future<SearchOptionsPart> fallbackOptions(SearchParams p) => options(p, dimensions: SearchDimension.values.toSet());

  @override
  Future<List<SearchCityOption>> fallbackCities(SearchParams p, String country) async => const [];
}

/// The in-memory database behind the normal Photos timeline.
class SearchModeDatabase {
  late final Drift db;

  Future<void> setUpAll() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting();
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  }

  Future<void> setUp({int timelineAssets = 0}) async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
    await db.delete(db.remoteAssetEntity).go();
    await db
        .into(db.userEntity)
        .insertOnConflictUpdate(
          UserEntityCompanion(
            id: const Value(testUserId),
            email: const Value('me@example.com'),
            name: const Value('Me'),
            avatarColor: const Value(AvatarColor.primary),
            profileChangedAt: Value(DateTime(2024)),
            hasProfileImage: const Value(false),
          ),
        );
    // One asset a day going back from 2025-12-31, so the normal timeline is long enough to scroll.
    for (var i = 0; i < timelineAssets; i++) {
      final taken = DateTime.utc(2025, 12, 31).subtract(Duration(days: i));
      await db
          .into(db.remoteAssetEntity)
          .insert(
            RemoteAssetEntityCompanion.insert(
              id: 'local-$i',
              name: 'local-$i.jpg',
              type: AssetType.image,
              checksum: 'checksum-local-$i',
              ownerId: testUserId,
              visibility: AssetVisibility.timeline,
              createdAt: Value(taken),
              updatedAt: Value(taken),
              localDateTime: Value(taken),
              width: const Value(100),
              height: const Value(100),
              durationMs: const Value(0),
              isFavorite: const Value(false),
              isEdited: const Value(false),
            ),
          );
    }
  }

  Future<void> tearDownAll() => db.close();
}

/// Builds the container the Photos page runs in.
ProviderContainer searchModeContainer({
  required Drift db,
  required GallerySearchRepository repository,
  List<String> recentPersonIds = const [],
  bool memories = false,
  bool realDebounce = false,
  List<Override> extra = const [],
  UserDto? user,
}) {
  final me = user ?? testUser;
  final users = _MockUserService();
  when(() => users.tryGetMyUser()).thenReturn(me);
  when(() => users.watchMyUser()).thenAnswer((_) => const Stream.empty());
  return ProviderContainer(
    overrides: [
      driftProvider.overrideWithValue(db),
      apiServiceProvider.overrideWithValue(_MockApiService()),
      infra.userServiceProvider.overrideWithValue(users),
      currentUserProvider.overrideWith((ref) => _StubUser(users, me)),
      timelineUsersProvider.overrideWith((_) => Stream.value([me.id])),
      featureMessageServiceProvider.overrideWithValue(_StubFeatureMessages()),
      memoryLaneProvider.overrideWith((ref) async => memories ? [_memory()] : const <Memory>[]),
      gallerySearchRepositoryProvider.overrideWithValue(repository),
      searchRecentPersonIdsProvider.overrideWith((ref) async => recentPersonIds),
      if (!realDebounce) ...[
        searchOptionsDebounceProvider.overrideWithValue(Duration.zero),
        searchResultsDebounceProvider.overrideWithValue(Duration.zero),
      ],
      searchClockProvider.overrideWithValue(() => DateTime(2026, 10, 23)),
      ...extra,
    ],
  );
}

Memory _memory() => Memory(
  id: 'memory-1',
  createdAt: DateTime(2024),
  updatedAt: DateTime(2024),
  ownerId: testUserId,
  type: MemoryTypeEnum.onThisDay,
  data: const MemoryData({'year': 2019}),
  isSaved: false,
  memoryAt: DateTime(2019, 8, 1),
  assets: [TestUtils.createRemoteAsset(id: 'memory-asset-1')],
);

/// Pumps the real Photos page.
Future<void> pumpPhotosPage(WidgetTester tester, ProviderContainer container, {ThemeData? theme, Widget? page}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    localizedForTest(
      UncontrolledProviderScope(
        container: container,
        child: Builder(
          builder: (context) => MaterialApp(
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
            theme: theme,
            home: withStubRouter(page ?? const MainTimelinePage()),
          ),
        ),
      ),
    ),
  );
  await settleFrames(tester);
}

/// Pumps frames until timers and streams settle (pumpAndSettle never settles while a spinner animates).
Future<void> settleFrames(WidgetTester tester, {int frames = 20}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// What the search button (openGallerySearch) does once on the Photos tab.
Future<void> enterSearchMode(WidgetTester tester, ProviderContainer container) async {
  container.read(searchModeProvider.notifier).enter();
  await settleFrames(tester);
}

/// The scroll position of the timeline's grid.
double timelineScrollOffset(WidgetTester tester) => timelineController(tester).offset;

/// The timeline grid's controller: the outermost Scrollable under the page.
ScrollController timelineController(WidgetTester tester) => tester
    .widget<Scrollable>(find.descendant(of: find.byType(Timeline), matching: find.byType(Scrollable)).first)
    .controller!;

/// Disposes the page, then the container.
Future<void> disposePhotosPage(WidgetTester tester, ProviderContainer container) async {
  await tester.pumpWidget(localizedForTest(const SizedBox.shrink()));
  await tester.pump(const Duration(seconds: 1));
  container.dispose();
}

SearchState searchStateOf(ProviderContainer container) => container.read(searchStateProvider);

Finder get timelineFinder => find.byType(Timeline);

/// Fixed scope for tests that read it.
const photosScope = PhotosSearchScope();
