import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:immich_mobile/domain/models/user.model.dart';

part 'user_metadata.model.freezed.dart';

enum UserMetadataKey {
  // do not change this order!
  onboarding,
  preferences,
  license,
  // Gallery-fork: mirrors the server's `family-root` UserMetadataKey (the identity the viewer
  // nominated as themselves for family-relationship labels). Added here only so the generic
  // user-metadata sync stream compiles against the server enum — relations themselves are
  // server-sourced and never synced to Drift (see `family_relations.provider.dart`).
  familyRoot,
}

@freezed
abstract class Onboarding with _$Onboarding {
  const Onboarding._();

  const factory Onboarding({required bool isOnboarded}) = _Onboarding;

  factory Onboarding.fromMap(Map<String, Object?> map) {
    return Onboarding(isOnboarded: map["isOnboarded"]! as bool);
  }
}

@freezed
abstract class Preferences with _$Preferences {
  const Preferences._();

  const factory Preferences({
    @Default(false) bool foldersEnabled,
    @Default(true) bool memoriesEnabled,
    @Default(true) bool peopleEnabled,
    @Default(false) bool ratingsEnabled,
    @Default(true) bool sharedLinksEnabled,
    @Default(false) bool tagsEnabled,
    @Default(AvatarColor.primary) AvatarColor userAvatarColor,
    @Default(true) bool showSupportBadge,
    @Default(3) int minimumFaces,
  }) = _Preferences;

  factory Preferences.fromMap(Map<String, Object?> map) {
    return Preferences(
      foldersEnabled: (map["folders"] as Map<String, Object?>?)?["enabled"] as bool? ?? false,
      memoriesEnabled: (map["memories"] as Map<String, Object?>?)?["enabled"] as bool? ?? true,
      peopleEnabled: (map["people"] as Map<String, Object?>?)?["enabled"] as bool? ?? true,
      ratingsEnabled: (map["ratings"] as Map<String, Object?>?)?["enabled"] as bool? ?? false,
      sharedLinksEnabled: (map["sharedLinks"] as Map<String, Object?>?)?["enabled"] as bool? ?? true,
      tagsEnabled: (map["tags"] as Map<String, Object?>?)?["enabled"] as bool? ?? false,
      userAvatarColor: AvatarColor.values.firstWhere(
        (e) => e.value == (map["avatar"] as Map<String, Object?>?)?["color"] as String?,
        orElse: () => AvatarColor.primary,
      ),
      showSupportBadge: (map["purchase"] as Map<String, Object?>?)?["showSupportBadge"] as bool? ?? true,
      minimumFaces: (map["people"] as Map<String, Object?>?)?["minimumFaces"] as int? ?? 3,
    );
  }
}

@freezed
abstract class License with _$License {
  const License._();

  const factory License({required DateTime activatedAt, required String activationKey, required String licenseKey}) =
      _License;

  factory License.fromMap(Map<String, Object?> map) {
    return License(
      activatedAt: DateTime.parse(map["activatedAt"]! as String),
      activationKey: map["activationKey"]! as String,
      licenseKey: map["licenseKey"]! as String,
    );
  }
}

// Gallery-fork: the local shape of the server's `family-root` metadata value — just the
// nominated identity id, or null if never set / cleared. See `UserMetadataKey.familyRoot`.
class FamilyRoot {
  final String? identityId;

  const FamilyRoot({this.identityId});

  FamilyRoot copyWith({String? identityId}) {
    return FamilyRoot(identityId: identityId ?? this.identityId);
  }

  Map<String, Object?> toMap() {
    return {"identityId": identityId};
  }

  factory FamilyRoot.fromMap(Map<String, Object?> map) {
    return FamilyRoot(identityId: map["identityId"] as String?);
  }

  @override
  String toString() {
    return '''FamilyRoot {
identityId: ${identityId ?? "<NA>"},
}''';
  }

  @override
  bool operator ==(covariant FamilyRoot other) {
    if (identical(this, other)) {
      return true;
    }

    return identityId == other.identityId;
  }

  @override
  int get hashCode => identityId.hashCode;
}

// Model for a user metadata stored in the server
@freezed
abstract class UserMetadata with _$UserMetadata {
  @Assert(
    'onboarding != null || preferences != null || license != null || familyRoot != null',
    'One of onboarding, preferences, license and familyRoot must be provided',
  )
  const factory UserMetadata({
    required String userId,
    required UserMetadataKey key,
    Onboarding? onboarding,
    Preferences? preferences,
    License? license,
    // Gallery-fork: the nominated family root identity (UserMetadataKey.familyRoot).
    FamilyRoot? familyRoot,
  }) = _UserMetadata;
}
