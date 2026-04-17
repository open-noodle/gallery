import 'dart:typed_data';

import 'package:http/http.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/infrastructure/repositories/api.repository.dart';
import 'package:immich_mobile/infrastructure/utils/user.converter.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

class UserApiRepository extends ApiRepository {
  final ApiService _apiService;
  UserApiRepository(this._apiService);

  UsersApi get _api => _apiService.usersApi;

  Future<UserDto?> getMyUser() async {
    final (adminDto, preferenceDto) = await (_api.getMyUser(), _api.getMyPreferences()).wait;
    if (adminDto == null) return null;

    return UserConverter.fromAdminDto(adminDto, preferenceDto);
  }

  Future<String> createProfileImage({required String name, required Uint8List data}) async {
    final res = await checkNull(_api.createProfileImage(MultipartFile.fromBytes('file', data, filename: name)));
    return res.profileImagePath;
  }

  Future<List<UserDto>> getAll() async {
    final dto = await checkNull(_api.searchUsers());
    return dto.map(UserConverter.fromSimpleUserDto).toList();
  }
}
