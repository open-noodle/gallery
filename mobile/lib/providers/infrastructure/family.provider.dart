// Gallery-fork: family relationships, mobile slice 13 (the relations "provider").
//
// Mirrors `driftSpacePeopleProvider` (`people.provider.dart`): a `FutureProvider.family` that
// goes straight to the API repository, with no Drift table and no local fallback to degrade to,
// because relations are server-sourced and deliberately never synced (see
// `family_focus.model.dart`). `autoDispose` matches that precedent too — the person page is the
// only consumer, so the fetched focus does not need to outlive it.
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/family_api.repository.dart';

/// One person's family focus (parents/partners/children), keyed by their identity id (the
/// same id space as `DriftPerson.id` / `PersonResponseDto.id`).
///
/// Resolves to [FamilyFocusUnavailable] — a normal, successful value — when the viewer's
/// effective family access is `none` (A12); resolves to [FamilyFocusAvailable] otherwise, even
/// when every list in it is empty ("nothing recorded yet"). Any other failure (offline, a 5xx,
/// etc.) is left to propagate as an [AsyncError] rather than being caught here: collapsing it
/// into either success value would tell a merely-offline viewer that their family is either
/// nonexistent or forbidden, both of which are lies (E54).
final familyFocusProvider = FutureProvider.autoDispose.family<FamilyFocusResult, String>((ref, personId) {
  final repository = ref.watch(familyApiRepositoryProvider);
  return repository.getFocus(personId);
});
