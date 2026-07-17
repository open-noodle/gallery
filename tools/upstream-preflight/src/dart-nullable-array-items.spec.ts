import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for issue #743 item 3 (audit LOW#18).
//
// The Dart SDK template patch `native_class_nullable_items_in_arrays.patch` makes
// generated models type nullable-item arrays as `List<T?>`. It silently became a
// no-op once: `open-api/bin/generate-dart-sdk.sh` stopped applying it after the
// upstream three-state-DTO template rework (#27231), so every nullable-item array
// in the spec regenerated as a non-nullable `List<T>` — decoding a null item then
// throws at runtime instead of surfacing in the type system.
//
// Two invariants:
//  1. generate-dart-sdk.sh keeps applying the nullable-items template patch.
//  2. For every array property with `items.nullable: true` in the OpenAPI spec,
//     the committed generated Dart model declares the item type as nullable.

const REPO_ROOT = path.resolve(process.cwd(), '../..');
const GENERATE_SCRIPT = path.join(
  REPO_ROOT,
  'open-api/bin/generate-dart-sdk.sh',
);
const SPEC_PATH = path.join(REPO_ROOT, 'open-api/immich-openapi-specs.json');
const DART_MODEL_DIR = path.join(REPO_ROOT, 'mobile/openapi/lib/model');

interface SpecProperty {
  type?: string;
  items?: SpecProperty & { nullable?: boolean; $ref?: string };
}

interface Spec {
  components: {
    schemas: Record<string, { properties?: Record<string, SpecProperty> }>;
  };
}

// Mirrors openapi-generator's underscore() for model file names.
function snakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function dartItemType(items: SpecProperty & { $ref?: string }): string {
  if (items.$ref) {
    return items.$ref.split('/').at(-1)!;
  }
  switch (items.type) {
    case 'string': {
      return 'String';
    }
    case 'integer': {
      return 'int';
    }
    case 'number': {
      return 'num';
    }
    case 'boolean': {
      return 'bool';
    }
    case 'array': {
      return `List<${dartItemType(items.items!)}>`;
    }
    default: {
      throw new Error(`unmapped spec item type: ${JSON.stringify(items)}`);
    }
  }
}

function nullableItemArrays(
  spec: Spec,
): Array<{ model: string; property: string; itemType: string }> {
  const results: Array<{ model: string; property: string; itemType: string }> =
    [];
  for (const [model, schema] of Object.entries(spec.components.schemas)) {
    for (const [property, value] of Object.entries(schema.properties ?? {})) {
      if (
        value.type === 'array' &&
        (value.items as { nullable?: boolean } | undefined)?.nullable === true
      ) {
        results.push({ model, property, itemType: dartItemType(value.items!) });
      }
    }
  }
  return results;
}

describe('dart nullable array items (issue #743 item 3)', () => {
  it('generate-dart-sdk.sh applies the nullable-items template patch', () => {
    const script = fs.readFileSync(GENERATE_SCRIPT, 'utf8');
    expect(script).toContain('native_class_nullable_items_in_arrays.patch');
  });

  it('every nullable-item array in the spec is a List<T?> in the generated Dart model', () => {
    const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8')) as Spec;
    const targets = nullableItemArrays(spec);
    // The spec currently has nullable-item arrays (TimeBucketAssetResponseDto);
    // an empty target list would mean this guard is checking nothing.
    expect(targets.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const { model, property, itemType } of targets) {
      const modelPath = path.join(DART_MODEL_DIR, `${snakeCase(model)}.dart`);
      const dart = fs.readFileSync(modelPath, 'utf8');
      const declaration = dart
        .split('\n')
        .find(
          (line) =>
            /^ {2}\S.*[ >]\w+;$/.test(line) && line.endsWith(` ${property};`),
        );
      if (!declaration) {
        offenders.push(
          `${model}.${property}: declaration not found in ${path.basename(modelPath)}`,
        );
        continue;
      }
      if (!declaration.includes(`<${itemType}?>`)) {
        offenders.push(
          `${model}.${property}: expected item type '${itemType}?' in declaration '${declaration.trim()}'`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
