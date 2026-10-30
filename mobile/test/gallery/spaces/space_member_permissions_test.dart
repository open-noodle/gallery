import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/spaces/space_member_permissions.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockSharedSpacesApi extends Mock implements SharedSpacesApi {}

class _MockApiService extends Mock implements ApiService {}

class _FakeUpdateDto extends Fake implements SharedSpaceUpdateDto {}

SharedSpaceResponseDto _space({SharedSpaceMemberManagementDto? block}) => SharedSpaceResponseDto(
  createdAt: '2026-01-01T00:00:00.000Z',
  createdById: 'owner',
  id: 's1',
  name: 'Space',
  updatedAt: '2026-01-01T00:00:00.000Z',
  memberManagement: block == null ? const Optional.absent() : Optional.present(block),
);

SharedSpaceMemberManagementDto _block({bool add = false, bool roles = false}) => SharedSpaceMemberManagementDto(
  canAddMembers: add,
  canChangeRoles: roles,
  editorsCanAddMembers: null,
  editorsCanChangeRoles: null,
  serverEditorsCanAddMembers: false,
  serverEditorsCanChangeRoles: false,
);

void main() {
  group('canAddSpaceMembers / canChangeSpaceRoles', () {
    test('block present: the server decision wins over the role', () {
      expect(canAddSpaceMembers(_space(block: _block(add: true)), SharedSpaceRole.editor), isTrue);
      expect(canAddSpaceMembers(_space(block: _block()), SharedSpaceRole.editor), isFalse);
      expect(canAddSpaceMembers(_space(block: _block()), SharedSpaceRole.owner), isFalse);
      expect(canChangeSpaceRoles(_space(block: _block(roles: true)), SharedSpaceRole.editor), isTrue);
      expect(canChangeSpaceRoles(_space(block: _block(add: true)), SharedSpaceRole.editor), isFalse);
    });

    test('block absent (older server): owner only', () {
      final space = _space();
      expect(canAddSpaceMembers(space, SharedSpaceRole.owner), isTrue);
      expect(canAddSpaceMembers(space, SharedSpaceRole.editor), isFalse);
      expect(canAddSpaceMembers(space, SharedSpaceRole.viewer), isFalse);
      expect(canAddSpaceMembers(space, null), isFalse);
      expect(canChangeSpaceRoles(space, SharedSpaceRole.owner), isTrue);
      expect(canChangeSpaceRoles(space, SharedSpaceRole.editor), isFalse);
      expect(canChangeSpaceRoles(space, SharedSpaceRole.viewer), isFalse);
    });

    test('space not loaded: owner only', () {
      expect(canAddSpaceMembers(null, SharedSpaceRole.owner), isTrue);
      expect(canAddSpaceMembers(null, SharedSpaceRole.editor), isFalse);
      expect(canChangeSpaceRoles(null, SharedSpaceRole.owner), isTrue);
      expect(canChangeSpaceRoles(null, null), isFalse);
    });
  });

  group('SharedSpaceApiRepository.updateMemberPermission', () {
    late _MockSharedSpacesApi api;
    late _MockApiService apiService;
    late SharedSpaceApiRepository repository;

    setUpAll(() => registerFallbackValue(_FakeUpdateDto()));

    setUp(() {
      api = _MockSharedSpacesApi();
      apiService = _MockApiService();
      when(() => apiService.sharedSpacesApi).thenReturn(api);
      when(() => api.updateSpace(any(), any())).thenAnswer((_) async => _space());
      repository = SharedSpaceApiRepository(apiService);
    });

    Map<String, dynamic> sentBody() {
      final dto = verify(() => api.updateSpace('s1', captureAny())).captured.single as SharedSpaceUpdateDto;
      // ApiClient serialises request bodies with json.encode(dto.toJson()).
      return jsonDecode(jsonEncode(dto.toJson())) as Map<String, dynamic>;
    }

    test('null is sent as an explicit JSON null (reset to server default)', () async {
      await repository.updateMemberPermission('s1', field: 'editorsCanAddMembers', value: null);
      final body = sentBody();
      expect(body.containsKey('editorsCanAddMembers'), isTrue);
      expect(body['editorsCanAddMembers'], isNull);
      expect(body.containsKey('editorsCanChangeRoles'), isFalse);
    });

    test('true / false are sent for the named field only', () async {
      await repository.updateMemberPermission('s1', field: 'editorsCanChangeRoles', value: true);
      expect(sentBody(), {'editorsCanChangeRoles': true});
    });
  });
}
