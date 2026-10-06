import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/infrastructure/repositories/search_api.repository.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';

final searchApiRepositoryProvider = Provider(
  (ref) => SearchApiRepository(
    ref.watch(apiServiceProvider),
    localTakenRange: () => ref.read(serverLocalTakenRangeProvider),
  ),
);

final searchServiceProvider = Provider((ref) => SearchService(ref.watch(searchApiRepositoryProvider)));
