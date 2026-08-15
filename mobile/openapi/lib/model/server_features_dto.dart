//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ServerFeaturesDto {
  /// Returns a new [ServerFeaturesDto] instance.
  ServerFeaturesDto({
    required this.configFile,
    required this.duplicateDetection,
    required this.email,
    required this.facialRecognition,
    required this.importFaces,
    required this.map,
    required this.oauth,
    required this.oauthAutoLaunch,
    required this.ocr,
    required this.passwordLogin,
    required this.peopleStatistics,
    required this.realtimeTranscoding,
    required this.reverseGeocoding,
    required this.s3Storage,
    required this.search,
    required this.sidecar,
    required this.smartSearch,
    required this.smartSearchHasCutoff,
    this.syncRequestTypes = const Optional.present(const []),
    required this.trash,
  });

  /// Whether config file is available
  bool configFile;

  /// Whether duplicate detection is enabled
  bool duplicateDetection;

  /// Whether email notifications are enabled
  bool email;

  /// Whether facial recognition is enabled
  bool facialRecognition;

  /// Whether face import is enabled
  bool importFaces;

  /// Whether map feature is enabled
  bool map;

  /// Whether OAuth is enabled
  bool oauth;

  /// Whether OAuth auto-launch is enabled
  bool oauthAutoLaunch;

  /// Whether OCR is enabled
  bool ocr;

  /// Whether password login is enabled
  bool passwordLogin;

  /// Whether the people face statistics UI is enabled
  bool peopleStatistics;

  /// Whether real-time transcoding is enabled
  bool realtimeTranscoding;

  /// Whether reverse geocoding is enabled
  bool reverseGeocoding;

  /// Whether an S3 storage backend is configured
  bool s3Storage;

  /// Whether search is enabled
  bool search;

  /// Whether sidecar files are supported
  bool sidecar;

  /// Whether smart search is enabled
  bool smartSearch;

  /// Whether smart search has an active relevance cutoff (clip.maxDistance)
  bool smartSearchHasCutoff;

  /// Sync stream request types this server accepts. Absent on servers that predate capability signalling; clients fall back to version-based gating.
  Optional<List<String>?> syncRequestTypes;

  /// Whether trash feature is enabled
  bool trash;

  @override
  bool operator ==(Object other) => identical(this, other) || other is ServerFeaturesDto &&
    other.configFile == configFile &&
    other.duplicateDetection == duplicateDetection &&
    other.email == email &&
    other.facialRecognition == facialRecognition &&
    other.importFaces == importFaces &&
    other.map == map &&
    other.oauth == oauth &&
    other.oauthAutoLaunch == oauthAutoLaunch &&
    other.ocr == ocr &&
    other.passwordLogin == passwordLogin &&
    other.peopleStatistics == peopleStatistics &&
    other.realtimeTranscoding == realtimeTranscoding &&
    other.reverseGeocoding == reverseGeocoding &&
    other.s3Storage == s3Storage &&
    other.search == search &&
    other.sidecar == sidecar &&
    other.smartSearch == smartSearch &&
    other.smartSearchHasCutoff == smartSearchHasCutoff &&
    _deepEquality.equals(other.syncRequestTypes, syncRequestTypes) &&
    other.trash == trash;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (configFile.hashCode) +
    (duplicateDetection.hashCode) +
    (email.hashCode) +
    (facialRecognition.hashCode) +
    (importFaces.hashCode) +
    (map.hashCode) +
    (oauth.hashCode) +
    (oauthAutoLaunch.hashCode) +
    (ocr.hashCode) +
    (passwordLogin.hashCode) +
    (peopleStatistics.hashCode) +
    (realtimeTranscoding.hashCode) +
    (reverseGeocoding.hashCode) +
    (s3Storage.hashCode) +
    (search.hashCode) +
    (sidecar.hashCode) +
    (smartSearch.hashCode) +
    (smartSearchHasCutoff.hashCode) +
    (syncRequestTypes.hashCode) +
    (trash.hashCode);

  @override
  String toString() => 'ServerFeaturesDto[configFile=$configFile, duplicateDetection=$duplicateDetection, email=$email, facialRecognition=$facialRecognition, importFaces=$importFaces, map=$map, oauth=$oauth, oauthAutoLaunch=$oauthAutoLaunch, ocr=$ocr, passwordLogin=$passwordLogin, peopleStatistics=$peopleStatistics, realtimeTranscoding=$realtimeTranscoding, reverseGeocoding=$reverseGeocoding, s3Storage=$s3Storage, search=$search, sidecar=$sidecar, smartSearch=$smartSearch, smartSearchHasCutoff=$smartSearchHasCutoff, syncRequestTypes=$syncRequestTypes, trash=$trash]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'configFile'] = this.configFile;
      json[r'duplicateDetection'] = this.duplicateDetection;
      json[r'email'] = this.email;
      json[r'facialRecognition'] = this.facialRecognition;
      json[r'importFaces'] = this.importFaces;
      json[r'map'] = this.map;
      json[r'oauth'] = this.oauth;
      json[r'oauthAutoLaunch'] = this.oauthAutoLaunch;
      json[r'ocr'] = this.ocr;
      json[r'passwordLogin'] = this.passwordLogin;
      json[r'peopleStatistics'] = this.peopleStatistics;
      json[r'realtimeTranscoding'] = this.realtimeTranscoding;
      json[r'reverseGeocoding'] = this.reverseGeocoding;
      json[r's3Storage'] = this.s3Storage;
      json[r'search'] = this.search;
      json[r'sidecar'] = this.sidecar;
      json[r'smartSearch'] = this.smartSearch;
      json[r'smartSearchHasCutoff'] = this.smartSearchHasCutoff;
    if (this.syncRequestTypes.isPresent) {
      final value = this.syncRequestTypes.value;
      json[r'syncRequestTypes'] = value;
    }
      json[r'trash'] = this.trash;
    return json;
  }

  /// Returns a new [ServerFeaturesDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ServerFeaturesDto? fromJson(dynamic value) {
    upgradeDto(value, "ServerFeaturesDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ServerFeaturesDto(
        configFile: mapValueOfType<bool>(json, r'configFile')!,
        duplicateDetection: mapValueOfType<bool>(json, r'duplicateDetection')!,
        email: mapValueOfType<bool>(json, r'email')!,
        facialRecognition: mapValueOfType<bool>(json, r'facialRecognition')!,
        importFaces: mapValueOfType<bool>(json, r'importFaces')!,
        map: mapValueOfType<bool>(json, r'map')!,
        oauth: mapValueOfType<bool>(json, r'oauth')!,
        oauthAutoLaunch: mapValueOfType<bool>(json, r'oauthAutoLaunch')!,
        ocr: mapValueOfType<bool>(json, r'ocr')!,
        passwordLogin: mapValueOfType<bool>(json, r'passwordLogin')!,
        peopleStatistics: mapValueOfType<bool>(json, r'peopleStatistics')!,
        realtimeTranscoding: mapValueOfType<bool>(json, r'realtimeTranscoding')!,
        reverseGeocoding: mapValueOfType<bool>(json, r'reverseGeocoding')!,
        s3Storage: mapValueOfType<bool>(json, r's3Storage')!,
        search: mapValueOfType<bool>(json, r'search')!,
        sidecar: mapValueOfType<bool>(json, r'sidecar')!,
        smartSearch: mapValueOfType<bool>(json, r'smartSearch')!,
        smartSearchHasCutoff: mapValueOfType<bool>(json, r'smartSearchHasCutoff')!,
        syncRequestTypes: json.containsKey(r'syncRequestTypes') ? Optional.present(json[r'syncRequestTypes'] is Iterable
            ? (json[r'syncRequestTypes'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        trash: mapValueOfType<bool>(json, r'trash')!,
      );
    }
    return null;
  }

  static List<ServerFeaturesDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <ServerFeaturesDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ServerFeaturesDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ServerFeaturesDto> mapFromJson(dynamic json) {
    final map = <String, ServerFeaturesDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ServerFeaturesDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ServerFeaturesDto-objects as value to a dart map
  static Map<String, List<ServerFeaturesDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<ServerFeaturesDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ServerFeaturesDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'configFile',
    'duplicateDetection',
    'email',
    'facialRecognition',
    'importFaces',
    'map',
    'oauth',
    'oauthAutoLaunch',
    'ocr',
    'passwordLogin',
    'peopleStatistics',
    'realtimeTranscoding',
    'reverseGeocoding',
    's3Storage',
    'search',
    'sidecar',
    'smartSearch',
    'smartSearchHasCutoff',
    'trash',
  };
}

