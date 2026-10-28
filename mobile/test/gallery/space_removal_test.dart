import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/space_removal.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

void main() {
  late MockSharedSpaceApiRepository repository;
  late SpaceRemovalService service;

  setUp(() {
    repository = MockSharedSpaceApiRepository();
    service = SpaceRemovalService(repository);
  });

  // Records compare their lists by identity: check each field.
  void expectRemoval(
    SpaceRemoval removal, {
    required List<String> removed,
    required int kept,
    required List<String>? albumNames,
  }) {
    expect(removal.removed, removed);
    expect(removal.kept, kept);
    expect(removal.albumNames, albumNames);
  }

  test('reports what the server removed, with no lookup when nothing is left', () async {
    when(() => repository.removeAssets('family', ['a', 'b'])).thenAnswer((_) async => ['a', 'b']);

    final removal = await service.remove('family', ['a', 'b']);

    expectRemoval(removal, removed: ['a', 'b'], kept: 0, albumNames: []);
    verifyNever(() => repository.linkedAlbumNames(any(), any()));
  });

  test('names the linked albums of the photos it could not remove', () async {
    when(() => repository.removeAssets('family', ['a', 'b'])).thenAnswer((_) async => ['a']);
    when(() => repository.linkedAlbumNames('family', ['b'])).thenAnswer((_) async => ['Trip']);

    final removal = await service.remove('family', ['a', 'b']);

    expectRemoval(removal, removed: ['a'], kept: 1, albumNames: ['Trip']);
  });

  test('finds no album when a linked library brings the photos it could not remove', () async {
    when(() => repository.removeAssets('family', ['b'])).thenAnswer((_) async => <String>[]);
    when(() => repository.linkedAlbumNames('family', ['b'])).thenAnswer((_) async => <String>[]);

    final removal = await service.remove('family', ['b']);

    expectRemoval(removal, removed: [], kept: 1, albumNames: []);
  });

  test('tells a failed album lookup apart from a linked library', () async {
    when(() => repository.removeAssets('family', ['b'])).thenAnswer((_) async => <String>[]);
    when(() => repository.linkedAlbumNames('family', ['b'])).thenThrow(Exception('offline'));

    final removal = await service.remove('family', ['b']);

    expectRemoval(removal, removed: [], kept: 1, albumNames: null);
  });

  test('throws when the server refuses', () async {
    when(() => repository.removeAssets('family', ['a'])).thenThrow(Exception('403'));

    await expectLater(service.remove('family', ['a']), throwsException);
  });
}
