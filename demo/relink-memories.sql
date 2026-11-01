-- Re-link the demo user's pinned memories (data->>'seed' = 'demo') to photos.
-- Upstream migration 1787148183730-DeleteMismatchedMemoryAssets removed every cross-owner memory_asset row,
-- which emptied the cards built from space-shared photos. Reads still allow cross-owner assets, so re-linking
-- restores them. Idempotent: each card's links are replaced.
-- Run: kubectl -n demo exec -i gallery-postgres-1 -c postgres -- psql -U postgres -d gallery -v ON_ERROR_STOP=1 < demo/relink-memories.sql
BEGIN;

CREATE TEMP VIEW acc AS
SELECT a.* FROM asset a, "user" d
WHERE d.email = 'demo@gallery.app' AND a."deletedAt" IS NULL AND a.visibility = 'timeline'
  AND (a."ownerId" = d.id OR a.id IN (
    SELECT sa."assetId" FROM shared_space_asset sa
    JOIN shared_space_member m ON m."spaceId" = sa."spaceId" WHERE m."userId" = d.id))
  -- mirror MemoryRepository.search: photos with a hidden person's face are dropped on read
  AND NOT EXISTS (
    SELECT 1 FROM asset_face f
    JOIN person p ON p."personGroupId" = f."personGroupId" AND p."ownerId" = a."ownerId"
    WHERE f."assetId" = a.id AND p."isHidden");

CREATE TEMP VIEW has_face AS
SELECT DISTINCT f."assetId", f."personGroupId" FROM asset_face f WHERE f."deletedAt" IS NULL;

CREATE TEMP TABLE links ("memoriesId" uuid, "assetId" uuid);

-- month_recap: August 2022
INSERT INTO links SELECT '7273fd61-3a79-43ed-81f0-b6f87504724b', id FROM acc
WHERE "localDateTime" >= '2022-08-01' AND "localDateTime" < '2022-09-01';

-- video_moments: September 2024
INSERT INTO links SELECT '232f6c98-db7d-489e-ac8b-ef15f06ddc04', id FROM acc
WHERE type = 'VIDEO' AND "localDateTime" >= '2024-09-01' AND "localDateTime" < '2024-10-01';

-- favorites_throwback: November 2024 (owner's favorites)
INSERT INTO links SELECT '4bc940ff-40a3-47e8-934c-16cded141ed4', id FROM acc
WHERE "isFavorite" AND "localDateTime" >= '2024-11-01' AND "localDateTime" < '2024-12-01';

-- person_throwback: Andre on 2024-11-25, 8 of 14 (rule cap)
INSERT INTO links SELECT '4fa3cf50-a2be-40ef-9cd1-5e02257276cb', id FROM (
  SELECT a.id, row_number() OVER (ORDER BY a."localDateTime") rn, count(*) OVER () n FROM acc a
  JOIN has_face f ON f."assetId" = a.id AND f."personGroupId" = 'a9053085-2fa4-4180-910b-0961fcfd221e'
  WHERE a."localDateTime"::date = '2024-11-25') s
WHERE (rn - 1) % greatest(1, n / 8) = 0 ORDER BY rn LIMIT 8;

-- people_together: Hannah & Sophie, February 2025, 8 of 15
INSERT INTO links SELECT '32a1131f-053b-44da-ad7b-fb173854e57a', id FROM (
  SELECT a.id, row_number() OVER (ORDER BY a."localDateTime") rn FROM acc a
  JOIN has_face h ON h."assetId" = a.id AND h."personGroupId" = 'b9fb9e28-e1f5-4bbf-8623-b60f9d20400b'
  JOIN has_face s ON s."assetId" = a.id AND s."personGroupId" = 'd05e0b46-d025-4d68-af20-2106f89e50b1'
  WHERE a."localDateTime" >= '2025-02-01' AND a."localDateTime" < '2025-03-01') s
WHERE rn % 2 = 1 LIMIT 8;

-- on_this_day_place: Budapest
INSERT INTO links SELECT '7718483f-747c-4901-b935-6dcdb64e1e90', a.id FROM acc a
JOIN asset_exif e ON e."assetId" = a.id WHERE e.city = 'Budapest';

-- themed: mountains 2025, top 9 photos from CLIP smart search as the demo user (withSharedSpaces)
INSERT INTO links SELECT '100626af-0f26-4d26-a87d-011aa8c9aaea', id FROM acc WHERE id IN (
  '62094dd9-c08a-45e8-8f8b-c5aa94ca26bf', '6cd39cee-be8f-4d4c-9dd8-5364323d3539', '84dbd55c-ff37-45ee-af1a-1a3e6186114b',
  '229b5c8d-b2b0-4244-a65d-e656b029d123', '94314638-5a6a-45c4-8ea8-a9e5984901ac', '8560736b-6755-4306-87f1-ff71389f68c1',
  '32dc250a-ee7a-400f-aafe-e318da7ed7b7', '3cd73d6e-702f-4200-a2e3-5234371a9428', '74c488ce-8686-405d-8e2f-2224c3b357aa');

-- trip_anniversary: Mongolia from the ger camp on (tripStart)
INSERT INTO links SELECT '1f7f3d63-de77-4215-b4db-b2b945c43e03', a.id FROM acc a
JOIN asset_exif e ON e."assetId" = a.id
WHERE e.country = 'Mongolia' AND a."fileCreatedAt" >= '2025-07-12T11:34:48Z';

-- season_recap: summer 2025, 30 spread evenly (rule cap)
INSERT INTO links SELECT '35d65cc0-91ca-49ca-bc8b-c12763b2d387', id FROM (
  SELECT id, ntile(30) OVER (ORDER BY "localDateTime") t, row_number() OVER (ORDER BY "localDateTime") rn FROM acc
  WHERE "localDateTime" >= '2025-06-01' AND "localDateTime" < '2025-09-01') s
WHERE rn IN (SELECT min(rn) FROM (
  SELECT ntile(30) OVER (ORDER BY "localDateTime") t, row_number() OVER (ORDER BY "localDateTime") rn FROM acc
  WHERE "localDateTime" >= '2025-06-01' AND "localDateTime" < '2025-09-01') x GROUP BY t);

-- birthday: Sophie, rule's 'recent' variant (all her photos are from 2025): 4 most recent
INSERT INTO links SELECT 'cb09d6fb-fc7a-45b6-b3b3-d6313366a41f', id FROM (
  SELECT DISTINCT a.id, a."localDateTime" FROM acc a
  JOIN has_face f ON f."assetId" = a.id AND f."personGroupId" = 'd05e0b46-d025-4d68-af20-2106f89e50b1'
  ORDER BY a."localDateTime" DESC LIMIT 4) s;

-- on_this_day: 2025-08-23
INSERT INTO links SELECT 'b1d2f398-9af6-4484-9ac6-cdf4cc864317', id FROM acc WHERE "localDateTime"::date = '2025-08-23';

-- recent_trip South Africa still has its 10 photos; left untouched.

DELETE FROM memory_asset WHERE "memoriesId" IN (SELECT DISTINCT "memoriesId" FROM links);
INSERT INTO memory_asset ("memoriesId", "assetId") SELECT DISTINCT "memoriesId", "assetId" FROM links;

-- context fixes so subtitles match what the card shows
UPDATE memory SET data = jsonb_set(jsonb_set(data, '{context,assetCount}', to_jsonb((SELECT count(*) FROM links WHERE "memoriesId" = memory.id))),
  '{subtitle}', to_jsonb('1 year ago · ' || (SELECT count(*) FROM links WHERE "memoriesId" = memory.id) || ' photos over 11 days'))
WHERE id = '1f7f3d63-de77-4215-b4db-b2b945c43e03';
UPDATE memory SET data = jsonb_set(jsonb_set(data, '{context,count}', '85'), '{subtitle}', '"85 photos"')
WHERE id = '35d65cc0-91ca-49ca-bc8b-c12763b2d387';
UPDATE memory SET data = jsonb_set(data, '{context}', data->'context' || '{"variant":"recent","personName":"Sophie","distinctYears":1}'::jsonb)
  #- '{subtitle}' || '{"subtitle":"Recent photos of Sophie"}'::jsonb
WHERE id = 'cb09d6fb-fc7a-45b6-b3b3-d6313366a41f';
UPDATE memory SET "updatedAt" = now() WHERE id IN (SELECT DISTINCT "memoriesId" FROM links);

SELECT m.data->>'title' AS title, m.data->>'subtitle' AS subtitle, count(ma."assetId") AS photos
FROM memory m JOIN "user" u ON u.id = m."ownerId" LEFT JOIN memory_asset ma ON ma."memoriesId" = m.id
WHERE u.email = 'demo@gallery.app' AND m."deletedAt" IS NULL GROUP BY m.id ORDER BY m."memoryAt";

COMMIT;
