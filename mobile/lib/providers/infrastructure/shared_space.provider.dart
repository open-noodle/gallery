import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/infrastructure/repositories/shared_space.repository.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';

/// Drift-backed space queries. The API-backed counterpart lives in
/// `providers/shared_space.provider.dart`.
final sharedSpaceRepositoryProvider = Provider<SharedSpaceRepository>(
  (ref) => SharedSpaceRepository(ref.watch(driftProvider)),
);
