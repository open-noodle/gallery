import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs with cwd at server/ - same convention as game.repository.spec.ts.
const SPEC = join(process.cwd(), '../open-api/immich-openapi-specs.json');

/**
 * Every schema that carries the scope pair. All three matter, not just the create response:
 * `GameChallengeListItemResponseDto` is what the solo daily and the space list deserialise into,
 * and `GameChallengeDetailResponseDto` is what the play surface reads. They inherit the pair from
 * the same zod object today, so guarding only one of them would pass right up until someone
 * redeclares a field inside a `.extend()` - which is exactly how a schema loses a `.nullable()`
 * without anyone editing the field that broke.
 */
const SCOPED_SCHEMAS = [
  'GameChallengeResponseDto',
  'GameChallengeListItemResponseDto',
  'GameChallengeDetailResponseDto',
];

describe('game challenge scope contract', () => {
  it.each(SCOPED_SCHEMAS)('declares spaceId and ownerId on %s as nullable', (schemaName) => {
    // This checked-in file is the contract the Dart and TypeScript clients are GENERATED from.
    // A non-nullable spaceId here means the Dart model deserialises into a non-nullable String
    // and throws on a solo challenge - the server itself stays quiet, because response DTOs are
    // not validated on output. The failure lands in the client, far from the cause.
    const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
    const challenge = spec.components.schemas[schemaName];
    expect(challenge, `${schemaName} is missing from the spec - regenerate with \`make open-api\``).toBeDefined();

    // This project's zod-to-openapi config targets OpenAPI 3.0, which has no union `type` array -
    // a nullable string is `{ type: 'string', nullable: true }` (confirmed against `dailyOn`,
    // an existing nullable field in this same schema), not the 3.1 `type: ['string', 'null']`.
    expect(challenge.properties.spaceId.nullable, `${schemaName}.spaceId must accept null for a solo challenge`).toBe(
      true,
    );
    expect(challenge.properties.ownerId.nullable, `${schemaName}.ownerId must accept null for a space challenge`).toBe(
      true,
    );
  });
});
