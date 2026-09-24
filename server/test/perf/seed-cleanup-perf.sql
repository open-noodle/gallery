-- gallery-fork: Library Cleanup performance seed (specs/2026-09-23-library-cleanup-design.md, "Scale").
--
-- DISPOSABLE DATABASES ONLY — never run it against a real instance. It is NOT re-runnable: it inserts
-- fixed users/cluster groups and 550k assets with fixed checksums, so run it once on a freshly migrated
-- throwaway database (drop and recreate the database to seed again). It lives under test/ so it is not
-- shipped with the server package.
--
-- Inserts 500,000 assets for perf user 1 and 50,000 for perf user 2 (so owner filters matter), with
-- asset_exif, asset_job_status, asset_face (~25% of images), smart_search (1%), duplicates (2%) and
-- burst runs (~2%). When the Cleanup schema is present it also seeds asset_quality and marks every
-- asset as quality-analysed; on a pre-Cleanup schema those steps are skipped, so the same script seeds
-- the "before" and "after" databases of the index safety check.
--
-- usage: psql "$DB_URL" -v ON_ERROR_STOP=1 -f server/test/perf/seed-cleanup-perf.sql
BEGIN;

SELECT setseed(0.42);

INSERT INTO cluster_group (id) VALUES
  ('00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-0000000000c2')
ON CONFLICT DO NOTHING;

INSERT INTO "user" (id, email, name, "isAdmin", "clusterGroupId") VALUES
  ('00000000-0000-4000-8000-000000000001', 'perf1@example.com', 'perf1', false, '00000000-0000-4000-8000-0000000000c1'),
  ('00000000-0000-4000-8000-000000000002', 'perf2@example.com', 'perf2', false, '00000000-0000-4000-8000-0000000000c2')
ON CONFLICT DO NOTHING;

-- Timestamps are truncated to milliseconds, like every localDateTime the server writes from a JS Date
-- (the Cleanup keyset cursors round-trip through a JS Date).
--
-- Rows are laid out in blocks of 250. The first 3-8 rows of every block form a burst: IMAGE assets
-- 300 ms apart (~2.2% of rows). Even blocks share an autoStackId (camera burst); odd blocks have none
-- (time-window burst) and carry near-identical CLIP embeddings so the per-page CLIP check accepts
-- them. Rows 50-51 of every 100 share a duplicateId.
CREATE TEMP TABLE perf_block ON COMMIT DROP AS
SELECT b,
       3 + (b % 6) AS burst_len,
       date_trunc('milliseconds', timestamptz '2012-01-01' + (random() * (timestamptz '2026-09-01' - timestamptz '2012-01-01'))) AS burst_ts,
       CASE WHEN b % 2 = 0 THEN gen_random_uuid() END AS auto_stack_id,
       (SELECT array_agg(random() - 0.5 + (i + b) * 0) FROM generate_series(1, 512) i) AS base_embedding
FROM generate_series(0, 2199) b;

CREATE TEMP TABLE perf_dup ON COMMIT DROP AS
SELECT d, gen_random_uuid() AS duplicate_id FROM generate_series(0, 5499) d;

CREATE TEMP TABLE perf_seed ON COMMIT DROP AS
SELECT g,
       gen_random_uuid() AS id,
       CASE WHEN g <= 500000 THEN '00000000-0000-4000-8000-000000000001'::uuid
            ELSE '00000000-0000-4000-8000-000000000002'::uuid END AS owner_id,
       CASE WHEN pos < blk.burst_len THEN blk.burst_ts + pos * interval '300 milliseconds'
            ELSE date_trunc('milliseconds', timestamptz '2012-01-01' + (random() * (timestamptz '2026-09-01' - timestamptz '2012-01-01'))) END AS ts,
       CASE WHEN pos >= blk.burst_len AND g % 12 = 0 THEN 'VIDEO' ELSE 'IMAGE' END AS type,
       CASE WHEN pos < blk.burst_len THEN blk.auto_stack_id END AS auto_stack_id,
       CASE WHEN pos < blk.burst_len AND blk.auto_stack_id IS NULL THEN blk.base_embedding END AS base_embedding,
       CASE WHEN (g - 1) % 100 IN (50, 51) THEN dup.duplicate_id END AS duplicate_id
FROM (SELECT g, (g - 1) / 250 AS b, (g - 1) % 250 AS pos FROM generate_series(1, 550000) g) s
JOIN perf_block blk USING (b)
JOIN perf_dup dup ON dup.d = (s.g - 1) / 100;

INSERT INTO asset (id, "ownerId", type, "originalPath", "fileCreatedAt", "fileModifiedAt", "localDateTime",
                   checksum, "checksumAlgorithm", "originalFileName", visibility, "deletedAt", status, "duplicateId")
SELECT id, owner_id, type, '/perf/' || g || CASE WHEN type = 'VIDEO' THEN '.mp4' ELSE '.jpg' END,
       ts, ts, ts, decode(md5(g::text), 'hex'), 'sha1', 'IMG_' || g || CASE WHEN type = 'VIDEO' THEN '.mp4' ELSE '.jpg' END,
       (CASE WHEN g % 50 = 7 THEN 'archive' ELSE 'timeline' END)::asset_visibility_enum,
       CASE WHEN g % 100 = 13 THEN now() END,
       (CASE WHEN g % 100 = 13 THEN 'trashed' ELSE 'active' END)::assets_status_enum,
       duplicate_id
FROM perf_seed;

INSERT INTO asset_exif ("assetId", "fileSizeInByte", "autoStackId", "exifImageWidth", "exifImageHeight")
SELECT id,
       (random() * 8e6)::bigint + CASE WHEN type = 'VIDEO' THEN (random() * 5e8)::bigint ELSE 0 END,
       auto_stack_id, 4032, 3024
FROM perf_seed;

INSERT INTO asset_job_status ("assetId") SELECT id FROM perf_seed;

INSERT INTO asset_face ("assetId") SELECT id FROM perf_seed WHERE type = 'IMAGE' AND g % 4 = 1;

-- 1% of rows get a random embedding; time-window burst members get their block's embedding plus noise.
INSERT INTO smart_search ("assetId", embedding)
SELECT id,
       CASE WHEN base_embedding IS NOT NULL
            THEN (SELECT array_agg(v + (random() - 0.5) * 0.02) FROM unnest(base_embedding) v)
            ELSE (SELECT array_agg(random() - 0.5 + (i + g) * 0) FROM generate_series(1, 512) i) END::vector
FROM perf_seed WHERE g % 100 = 3 OR base_embedding IS NOT NULL;

-- Cleanup-only tables/columns: skipped on a pre-Cleanup schema. Sharpness is lognormal
-- (median ~200, sigma 1, via Box-Muller), so each blur strictness selects a different share.
DO $$
BEGIN
  IF to_regclass('public.asset_quality') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO asset_quality ("assetId", "ownerId", sharpness, brightness, "clippedDark", "clippedBright", "isScreenshot", version)
      SELECT id, owner_id, exp(5.3 + sqrt(-2 * ln(1 - random())) * cos(2 * pi() * random())), random() * 255, random() * 0.2, random() * 0.2, random() < 0.03, 1
      FROM perf_seed WHERE type = 'IMAGE'
    $q$;
    EXECUTE $q$
      UPDATE asset_job_status SET "qualityAnalyzedAt" = now()
      WHERE "assetId" IN (SELECT id FROM perf_seed)
    $q$;
  END IF;
END
$$;

COMMIT;

-- Settle the visibility map and statistics, like a library autovacuum has already caught up with.
VACUUM (ANALYZE);
