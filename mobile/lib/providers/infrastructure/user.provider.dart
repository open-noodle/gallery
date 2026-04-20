import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/services/partner.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/infrastructure/repositories/user_api.repository.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/store.provider.dart';
import 'package:immich_mobile/repositories/partner_api.repository.dart';

// Fork: UserApiRepository takes the full ApiService (lazy `.usersApi` resolution
// via an internal getter) — see PR #369. Upstream passes `apiServiceProvider.usersApi`
// directly, but our constructor signature differs.
final userApiRepositoryProvider = Provider((ref) => UserApiRepository(ref.watch(apiServiceProvider)));

final userServiceProvider = Provider(
  (ref) => UserService(
    userApiRepository: ref.watch(userApiRepositoryProvider),
    userRepository: ref.watch(driftProvider).userRepository,
    storeService: ref.watch(storeServiceProvider),
  ),
);

final partnerServiceProvider = Provider<PartnerService>((ref) {
  final db = ref.watch(driftProvider);
  return PartnerService(db.userRepository, db.partnerRepository, ref.watch(partnerApiRepositoryProvider));
});
