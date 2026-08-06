import { writeFileSync } from "node:fs";
import { join } from "node:path";

const responseDtos = [
  {
    className: "AgentListAlbumsToolResponseDto",
    fileName: "agent_list_albums_tool_response_dto.dart",
    fields: [
      {
        name: "albums",
        type: "List<AgentAlbumSummary>",
        defaultValue: "const []",
        fromJson: "AgentAlbumSummary.listFromJson(json[r'albums'])",
      },
    ],
  },
  {
    className: "AgentReadAlbumToolResponseDto",
    fileName: "agent_read_album_tool_response_dto.dart",
    fields: [
      {
        name: "album",
        type: "AgentAlbumDetail?",
        fromJson: "AgentAlbumDetail.fromJson(json[r'album'])",
      },
    ],
  },
  {
    className: "AgentReadAssetMetadataToolResponseDto",
    fileName: "agent_read_asset_metadata_tool_response_dto.dart",
    fields: [
      {
        name: "assets",
        type: "List<AgentAssetMetadataResult>",
        defaultValue: "const []",
        fromJson: "AgentAssetMetadataResult.listFromJson(json[r'assets'])",
      },
    ],
  },
  {
    className: "AgentReadAssetOriginalsToolResponseDto",
    fileName: "agent_read_asset_originals_tool_response_dto.dart",
    fields: [
      {
        name: "originals",
        type: "List<AgentAssetMediaReference>",
        defaultValue: "const []",
        fromJson: "AgentAssetMediaReference.listFromJson(json[r'originals'])",
      },
    ],
  },
  {
    className: "AgentReadAssetPreviewsToolResponseDto",
    fileName: "agent_read_asset_previews_tool_response_dto.dart",
    fields: [
      {
        name: "previews",
        type: "List<AgentAssetMediaReference>",
        defaultValue: "const []",
        fromJson: "AgentAssetMediaReference.listFromJson(json[r'previews'])",
      },
    ],
  },
  {
    className: "AgentSearchAssetsToolResponseDto",
    fileName: "agent_search_assets_tool_response_dto.dart",
    fields: [
      {
        name: "summary",
        type: "String?",
        fromJson: "mapValueOfType<String>(json, r'summary')",
      },
      {
        name: "detail",
        type: "AgentSearchAssetsDetail?",
        fromJson: "AgentSearchAssetsDetail.fromJson(json[r'detail'])",
      },
      {
        name: "returnedCount",
        type: "int?",
        fromJson: "mapValueOfType<int>(json, r'returnedCount')",
      },
      {
        name: "hasMore",
        type: "bool?",
        fromJson: "mapValueOfType<bool>(json, r'hasMore')",
      },
      {
        name: "nextPage",
        type: "String?",
        fromJson: "mapValueOfType<String>(json, r'nextPage')",
      },
      {
        name: "resultSize",
        type: "AgentToolResultSize?",
        fromJson: "AgentToolResultSize.fromJson(json[r'resultSize'])",
      },
      {
        name: "sample",
        type: "AgentSearchAssetsSample?",
        fromJson: "AgentSearchAssetsSample.fromJson(json[r'sample'])",
      },
      {
        name: "selectionHandle",
        type: "AgentSearchAssetsSelectionHandle?",
        fromJson:
          "AgentSearchAssetsSelectionHandle.fromJson(json[r'selectionHandle'])",
      },
      {
        name: "approximateTotal",
        type: "int?",
        fromJson: "mapValueOfType<int>(json, r'approximateTotal')",
      },
      {
        name: "totalCount",
        type: "int?",
        fromJson: "mapValueOfType<int>(json, r'totalCount')",
      },
    ],
  },
];

const modelDir = join(process.cwd(), "..", "mobile", "openapi", "lib", "model");

for (const dto of responseDtos) {
  writeFileSync(join(modelDir, dto.fileName), renderDto(dto), "utf8");
}

function renderDto({ className, fields }) {
  const enumName = `${className}StatusEnum`;
  const transformerName = `${enumName}TypeTransformer`;
  const fieldConstructorParams = fields
    .map((field) =>
      field.defaultValue
        ? `    this.${field.name} = ${field.defaultValue},`
        : `    this.${field.name},`,
    )
    .join("\n");
  const fieldDeclarations = fields
    .map((field) => `  ${field.type} ${field.name};`)
    .join("\n\n");
  const equalityFields = fields
    .map((field) => `    ${fieldEquality(field)} &&`)
    .join("\n");
  const hashFields = fields
    .map((field) => `    (${fieldHash(field)}) +`)
    .join("\n");
  const toStringFields = fields
    .map((field) => `, ${field.name}=$${field.name}`)
    .join("");
  const toJsonFields = fields.map(renderToJsonField).join("\n");
  const fromJsonFields = fields
    .map((field) => `        ${field.name}: ${field.fromJson},`)
    .join("\n");
  const requiredKeys = ["status", "toolCall"]
    .map((field) => `    '${field}',`)
    .join("\n");

  return `//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class ${className} {
  /// Returns a new [${className}] instance.
  ${className}({
    required this.status,
    required this.toolCall,
    this.reason,
${fieldConstructorParams}
  });

  ${enumName} status;

  AgentToolCallResponseDto toolCall;

  String? reason;

${fieldDeclarations}

  @override
  bool operator ==(Object other) => identical(this, other) || other is ${className} &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason${fields.length > 0 ? " &&" : ";"}
${equalityFields.slice(0, -3)};

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason == null ? 0 : reason!.hashCode)${fields.length > 0 ? " +" : ";"}
${hashFields.slice(0, -2)};

  @override
  String toString() => '${className}[status=$status, toolCall=$toolCall, reason=$reason${toStringFields}]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    }
${toJsonFields}
    return json;
  }

  /// Returns a new [${className}] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static ${className}? fromJson(dynamic value) {
    upgradeDto(value, "${className}");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return ${className}(
        status: ${enumName}.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason'),
${fromJsonFields}
      );
    }
    return null;
  }

  static List<${className}> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <${className}>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ${className}.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, ${className}> mapFromJson(dynamic json) {
    final map = <String, ${className}>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = ${className}.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of ${className}-objects as value to a dart map
  static Map<String, List<${className}>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<${className}>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = ${className}.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
${requiredKeys}
  };
}


class ${enumName} {
  /// Instantiate a new enum with the provided [value].
  const ${enumName}._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = ${enumName}._(r'approval-required');
  static const denied = ${enumName}._(r'denied');
  static const success = ${enumName}._(r'success');

  /// List of all possible values in this [enum][${enumName}].
  static const values = <${enumName}>[
    approvalRequired,
    denied,
    success,
  ];

  static ${enumName}? fromJson(dynamic value) => ${transformerName}().decode(value);

  static List<${enumName}> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <${enumName}>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = ${enumName}.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [${enumName}] to String,
/// and [decode] dynamic data back to [${enumName}].
class ${transformerName} {
  factory ${transformerName}() => _instance ??= const ${transformerName}._();

  const ${transformerName}._();

  String encode(${enumName} data) => data.value;

  /// Decodes a [dynamic value][data] to a ${enumName}.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  ${enumName}? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return ${enumName}.approvalRequired;
        case r'denied': return ${enumName}.denied;
        case r'success': return ${enumName}.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [${transformerName}] instance.
  static ${transformerName}? _instance;
}

`;
}

function fieldEquality(field) {
  if (field.type.startsWith("List<")) {
    return `_deepEquality.equals(other.${field.name}, ${field.name})`;
  }

  return `other.${field.name} == ${field.name}`;
}

function fieldHash(field) {
  if (field.type.endsWith("?")) {
    return `${field.name} == null ? 0 : ${field.name}!.hashCode`;
  }

  return `${field.name}.hashCode`;
}

function renderToJsonField(field) {
  if (field.type.endsWith("?")) {
    return `    if (this.${field.name} != null) {
      json[r'${field.name}'] = this.${field.name};
    }`;
  }

  return `      json[r'${field.name}'] = this.${field.name};`;
}
