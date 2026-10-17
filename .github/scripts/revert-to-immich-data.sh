#!/usr/bin/env bash
# Seeds a Gallery database with the data scripts/revert-to-immich.sql has to clean up, then checks
# the result through a stock Immich server. Used by gallery-revert-to-immich-validation.yml.
#
#   revert-to-immich-data.sh seed            Gallery server running on :2283
#   revert-to-immich-data.sh stock-prepare   no server running; the switch-back guide's steps for a trial boot
#   revert-to-immich-data.sh stock-assert DRIFT BASELINE REVERT_SQL
#                                            stock Immich running on the Gallery database, no revert
#   revert-to-immich-data.sh gallery-prepare no server running; the guide's steps for going back to Gallery
#   revert-to-immich-data.sh gallery-assert  Gallery running again on the same database
#   revert-to-immich-data.sh s3-guard        no server running; the script must refuse an S3 path
#   revert-to-immich-data.sh assert          stock Immich server running on :2283, after the revert
#   revert-to-immich-data.sh convert-seed    no server running; DB_DATABASE_NAME names a copy of the Gallery database
#   revert-to-immich-data.sh convert-assert  stock Immich running on that copy, after the revert converted its spaces
#
# Expects containers named `server`, `database` and `redis`. SYNC_TYPES (seed, assert) is a JSON array of the
# request types a stock mobile app sends: the newest version of each stock SyncRequestType (a
# deprecated type throws mid-stream and the response never ends). State passes between phases
# through $STATE_DIR.
set -euo pipefail

API=http://localhost:2283/api
STATE_DIR=${STATE_DIR:?}
STATE=$STATE_DIR/state.env
mkdir -p "$STATE_DIR"

fail() {
  echo "::error::$*"
  exit 1
}

psql_q() {
  docker exec database psql -U "${DB_USERNAME:-postgres}" -d "${DB_DATABASE_NAME:-immich}" -v ON_ERROR_STOP=1 -Atc "$1"
}

# api METHOD PATH TOKEN [JSON] -> body on stdout, fails on non-2xx
api() {
  local method=$1 path=$2 token=$3 body=${4:-}
  curl -fsS -X "$method" "$API$path" \
    ${token:+-H "Authorization: Bearer $token"} \
    ${body:+-H 'Content-Type: application/json' --data "$body"}
}

# status METHOD PATH [TOKEN] -> HTTP status only
status() {
  curl -s -o /dev/null -w '%{http_code}' -X "$1" "$API$2" ${3:+-H "Authorization: Bearer $3"}
}

login() {
  api POST /auth/login '' "{\"email\":\"$1\",\"password\":\"password\"}" | jq -r .accessToken
}

upload() {
  local token=$1 file=$2
  curl -fsS -X POST "$API/assets" -H "Authorization: Bearer $token" \
    -F "assetData=@$file" \
    -F "fileCreatedAt=2024-01-01T00:00:00.000Z" \
    -F "fileModifiedAt=2024-01-01T00:00:00.000Z" | jq -r .id
}

# poll SECONDS SQL EXPECTED-REGEX
poll() {
  local deadline=$(($(date +%s) + $1)) value=''
  while [ "$(date +%s)" -lt "$deadline" ]; do
    value=$(psql_q "$2")
    if [[ $value =~ $3 ]]; then
      echo "$value"
      return 0
    fi
    sleep 2
  done
  fail "timed out waiting for [$2] to match /$3/, last value '$value'"
}

# seed_category TOKEN: a Gallery-only setting, as an admin would save it on Gallery.
seed_category() {
  local config
  config=$(api GET /system-config "$1" | jq -c '.classification.categories = [{
    "name": "Revert Category", "prompts": ["a dog"], "similarity": 0.3, "action": "tag", "enabled": false,
    "faceExclusion": "off"}]')
  api PUT /system-config "$1" "$config" >/dev/null
}

seed() {
  api POST /auth/admin-sign-up '' '{"email":"owner@example.com","password":"password","name":"Owner"}' >/dev/null
  local owner member owner_id member_id
  owner=$(login owner@example.com)
  owner_id=$(api GET /users/me "$owner" | jq -r .id)
  member_id=$(api POST /admin/users "$owner" \
    '{"email":"member@example.com","password":"password","name":"Member"}' | jq -r .id)
  member=$(login member@example.com)
  local partner
  api POST /admin/users "$owner" '{"email":"partner@example.com","password":"password","name":"Partner"}' >/dev/null
  partner=$(login partner@example.com)
  api POST /partners "$partner" "{\"sharedWithId\":\"$owner_id\"}" >/dev/null

  # Media is generated with the server image's own ffmpeg; distinct sizes keep checksums distinct.
  local media=$STATE_DIR/media
  mkdir -p "$media"
  for size in 64x48 80x60 96x72 112x84 128x96 144x108 160x120; do
    docker exec server ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=$size" -frames:v 1 "/tmp/$size.jpg"
    docker cp "server:/tmp/$size.jpg" "$media/$size.jpg"
  done
  docker exec server ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=6:size=160x120:rate=10 \
    -pix_fmt yuv420p /tmp/video.mp4
  docker cp server:/tmp/video.mp4 "$media/video.mp4"

  local photo_a photo_b member_photo video
  photo_a=$(upload "$owner" "$media/64x48.jpg")
  photo_b=$(upload "$owner" "$media/80x60.jpg")
  member_photo=$(upload "$member" "$media/96x72.jpg")
  video=$(upload "$owner" "$media/video.mp4")
  local partner_photo partner_archived
  partner_photo=$(upload "$partner" "$media/112x84.jpg")
  partner_archived=$(upload "$partner" "$media/128x96.jpg")
  api PUT /assets "$partner" "{\"ids\":[\"$partner_archived\"],\"visibility\":\"archive\"}" >/dev/null

  # Trim needs the extracted duration. The trim job records the trimmed length in asset_video_trim;
  # asset.duration keeps the original's, which is what a stock server plays.
  local original_duration
  original_duration=$(poll 180 "SELECT coalesce(duration, 0) FROM asset WHERE id = '$video'" '^[1-9][0-9]*$')
  api PUT "/assets/$video/trim" "$owner" '{"startTime":1,"endTime":3}' >/dev/null
  poll 180 "SELECT duration FROM asset_video_trim WHERE \"assetId\" = '$video' AND duration IS NOT NULL" '^[0-9]+$' >/dev/null
  [ "$(psql_q "SELECT duration FROM asset WHERE id = '$video'")" = "$original_duration" ] ||
    fail "seed: the trim changed asset.duration"
  [ "$(api GET "/assets/$video" "$owner" | jq -r .duration)" != "$original_duration" ] ||
    fail "seed: Gallery does not report the trimmed duration"

  # A space with the member as editor, holding both owners' photos.
  local space
  space=$(api POST /shared-spaces "$owner" '{"name":"Revert test"}' | jq -r .id)
  api POST "/shared-spaces/$space/members" "$owner" "{\"userId\":\"$member_id\",\"role\":\"editor\"}" >/dev/null
  api POST "/shared-spaces/$space/assets" "$owner" "{\"assetIds\":[\"$photo_a\",\"$photo_b\"]}" >/dev/null
  api POST "/shared-spaces/$space/assets" "$member" "{\"assetIds\":[\"$member_photo\"]}" >/dev/null

  # photo_a: owner and member favorite. photo_b: only the member (not the owner) favorites.
  api PUT /assets "$owner" "{\"ids\":[\"$photo_a\"],\"isFavorite\":true}" >/dev/null
  api PUT /assets "$member" "{\"ids\":[\"$photo_a\",\"$photo_b\"],\"isFavorite\":true}" >/dev/null
  # asset.isFavorite is the owner's projection of those rows, which a stock server reads.
  [ "$(psql_q "SELECT string_agg(\"isFavorite\"::text, ',' ORDER BY id = '$photo_b') FROM asset WHERE id IN ('$photo_a', '$photo_b')")" = true,false ] ||
    fail "seed: asset.isFavorite does not project the owner's favorites"

  api POST /memories "$owner" \
    "{\"type\":\"rule\",\"data\":{\"title\":\"Rule\"},\"memoryAt\":\"2024-01-01T00:00:00.000Z\",\"assetIds\":[\"$photo_a\"]}" \
    >/dev/null

  # Space links: one mixing the owner's and the member's photo, one with only the member's photo.
  local mixed_link member_link
  mixed_link=$(api POST /shared-links "$owner" \
    "{\"type\":\"INDIVIDUAL\",\"spaceId\":\"$space\",\"assetIds\":[\"$photo_a\",\"$member_photo\"]}" | jq -r .key)
  member_link=$(api POST /shared-links "$owner" \
    "{\"type\":\"INDIVIDUAL\",\"spaceId\":\"$space\",\"assetIds\":[\"$member_photo\"]}" | jq -r .key)
  [ "$(status GET "/assets/$member_photo?key=$mixed_link")" = 200 ] ||
    fail "seed: the space link does not serve the member's photo on Gallery, so the revert check would prove nothing"

  # A plain link with a partner's photo, plus a row for the partner's archived photo. Immich refuses
  # to share an archived partner photo, so that row is written directly, as a space link could hold it.
  # Gallery serves another user's photo through a link only via a space, so neither is reachable here;
  # stock Immich serves every listed photo, which is what the assert phase checks against.
  local partner_link partner_link_id
  partner_link_id=$(api POST /shared-links "$owner" "{\"type\":\"INDIVIDUAL\",\"assetIds\":[\"$partner_photo\"]}" | jq -r .id)
  partner_link=$(api GET "/shared-links/$partner_link_id" "$owner" | jq -r .key)
  psql_q "INSERT INTO shared_link_asset (\"sharedLinkId\", \"assetId\") VALUES ('$partner_link_id', '$partner_archived')" >/dev/null

  # Album links the owner made from the space: to the member's album (no album role), to member
  # albums shared with the owner as editor and as viewer, and to the owner's own album.
  local member_album owner_album editor_album viewer_album
  member_album=$(api POST /albums "$member" "{\"albumName\":\"Member album\",\"assetIds\":[\"$member_photo\"]}" | jq -r .id)
  owner_album=$(api POST /albums "$owner" "{\"albumName\":\"Owner album\",\"assetIds\":[\"$photo_a\"]}" | jq -r .id)
  editor_album=$(api POST /albums "$member" \
    "{\"albumName\":\"Editor album\",\"albumUsers\":[{\"userId\":\"$owner_id\",\"role\":\"editor\"}]}" | jq -r .id)
  viewer_album=$(api POST /albums "$member" \
    "{\"albumName\":\"Viewer album\",\"albumUsers\":[{\"userId\":\"$owner_id\",\"role\":\"viewer\"}]}" | jq -r .id)
  api PUT "/shared-spaces/$space/albums/$member_album" "$member" >/dev/null
  api PUT "/shared-spaces/$space/albums/$owner_album" "$owner" >/dev/null
  api PUT "/shared-spaces/$space/albums/$editor_album" "$member" >/dev/null
  api PUT "/shared-spaces/$space/albums/$viewer_album" "$member" >/dev/null
  album_link() {
    api POST /shared-links "$owner" "{\"type\":\"ALBUM\",\"spaceId\":\"$space\",\"albumId\":\"$1\"}" | jq -r .key
  }
  local member_album_link owner_album_link editor_album_link viewer_album_link
  member_album_link=$(album_link "$member_album")
  owner_album_link=$(album_link "$owner_album")
  editor_album_link=$(album_link "$editor_album")
  viewer_album_link=$(album_link "$viewer_album")
  [ "$(status GET "/assets/$member_photo?key=$member_album_link")" = 200 ] ||
    fail "seed: the space album link does not serve the member's album on Gallery"

  # Pets come from the ML pipeline, which this job does not run, so they are written directly: a
  # species-bucket pet with a face, a face only pet recognition knows about (pet_search), and a
  # human person with a face that the revert must keep.
  psql_q "
    WITH g AS (INSERT INTO person_group (\"clusterGroupId\") SELECT \"clusterGroupId\" FROM \"user\" WHERE id = '$owner_id' RETURNING id),
         pp AS (INSERT INTO person_pet (\"personGroupId\", species) SELECT id, 'dog' FROM g),
         p AS (INSERT INTO person (\"ownerId\", \"personGroupId\", name)
               SELECT '$owner_id', id, 'Revert Pet' FROM g RETURNING \"personGroupId\")
    INSERT INTO asset_face (\"assetId\", \"personGroupId\") SELECT '$photo_b', \"personGroupId\" FROM p;
    WITH f AS (INSERT INTO asset_face (\"assetId\") VALUES ('$photo_b') RETURNING id)
    INSERT INTO pet_search (\"faceId\", embedding, species)
    SELECT id, ('[' || array_to_string(array_fill(0.1, ARRAY[512]), ',') || ']')::vector, 'dog' FROM f;
    WITH g AS (INSERT INTO person_group (\"clusterGroupId\") SELECT \"clusterGroupId\" FROM \"user\" WHERE id = '$owner_id' RETURNING id),
         p AS (INSERT INTO person (\"ownerId\", \"personGroupId\", name)
               SELECT '$owner_id', id, 'Revert Human' FROM g RETURNING \"personGroupId\")
    INSERT INTO asset_face (\"assetId\", \"personGroupId\") SELECT '$photo_a', \"personGroupId\" FROM p;
  " >/dev/null

  # A workflow with a Gallery plugin step, which the stock round trip must keep.
  api POST /workflows "$owner" \
    "{\"trigger\":\"AssetCreate\",\"name\":\"Round trip\",\"steps\":[{\"method\":\"gallery-core#addToSpace\",\"config\":{\"spaceIds\":[\"$space\"]}}]}" \
    >/dev/null

  seed_category "$owner"

  # The same stock request against Gallery itself: the gating, not the revert, keeps these out.
  failed=0
  stock_sync_checks seed "$owner"
  [ "$failed" = 0 ] || exit 1

  cat >"$STATE" <<EOF
OWNER_ID=$owner_id
SPACE=$space
PHOTO_A=$photo_a
PHOTO_B=$photo_b
MEMBER_PHOTO=$member_photo
VIDEO=$video
ORIGINAL_DURATION=$original_duration
MIXED_LINK=$mixed_link
MEMBER_LINK=$member_link
MEMBER_ALBUM_LINK=$member_album_link
OWNER_ALBUM_LINK=$owner_album_link
EDITOR_ALBUM_LINK=$editor_album_link
VIEWER_ALBUM_LINK=$viewer_album_link
MEMBER_ALBUM=$member_album
VIEWER_ALBUM=$viewer_album
PARTNER_PHOTO=$partner_photo
PARTNER_ARCHIVED=$partner_archived
PARTNER_LINK=$partner_link
PHOTO_A_SHA=$(sha1sum "$media/64x48.jpg" | cut -d' ' -f1)
EOF
  echo "::notice::seed: Gallery data written"
}

# What the switch-back guide asks before a trial boot of stock Immich: no Gallery jobs left in Redis.
# Gallery's workflow plugin stays enabled: its WASM imports only upstream's host functions.
stock_prepare() {
  docker exec redis valkey-cli FLUSHALL >/dev/null
  psql_q "SELECT id FROM plugin WHERE name = 'gallery-core'" >"$STATE_DIR/plugin-id"
}

# bull_add QUEUE JOB: queue a job the way the server does, from inside the running server container.
bull_add() {
  docker exec -w /usr/src/app/server server node -e "
    const { Queue } = require('bullmq');
    const queue = new Queue('$1', { prefix: 'immich_bull', connection: { host: process.env.REDIS_HOSTNAME || 'redis' } });
    queue.add('$2', {}).then(() => queue.close());
  "
}

# shellcheck disable=SC2153 # vars come from the sourced $STATE file
stock_assert() {
  local drift=$1 baseline=$2 revert_sql=$3
  # shellcheck source=/dev/null
  . "$STATE"
  failed=0
  local owner
  owner=$(login owner@example.com)

  # Never `grep -q` on `docker logs`: it exits at the first match, docker logs dies of SIGPIPE, and
  # pipefail turns the match into a failure.
  check stock "stock loads Gallery's enabled workflow plugin" \
    "$(docker logs server 2>&1 | grep -F 'Loaded plugin: gallery-core@' >/dev/null && echo yes)" yes

  # Stock's drift check flags only Gallery's trigger functions and Gallery's migration_overrides rows: extra
  # tables (with their constraints), columns, indexes and triggers are ignored by design. No migration
  # issue either: Gallery records its own migrations outside kysely_migrations. The allowed items are the
  # functions and override rows the revert script removes, so a new one must reach the script first.
  comm -23 "$drift" "$baseline" >"$STATE_DIR/drift-stock-new.txt"
  echo "Stock drift on the Gallery database, beyond the fresh-install baseline:"
  cat "$STATE_DIR/drift-stock-new.txt"
  {
    sed -nE 's/^DROP FUNCTION IF EXISTS ([a-z_]+)\(.*/FunctionDrop \1/p' "$revert_sql"
    awk '/DELETE FROM "migration_overrides"/{f=1} f; /;$/{f=0}' "$revert_sql" |
      grep -oE "'(function|trigger|index)_[A-Za-z0-9_]+'" | tr -d "'" | sed 's/^/OverrideDrop /'
  } | sort -u >"$STATE_DIR/drift-allowed.txt"
  check stock 'drift is only the Gallery functions and override rows the revert script removes' \
    "$(sed -E 's/^  - FunctionDrop: The function "([^"]+)".*/FunctionDrop \1/; s/^  - OverrideDrop: The override "([^"]+)".*/OverrideDrop \1/' \
      "$STATE_DIR/drift-stock-new.txt" | sort -u | comm -23 - "$STATE_DIR/drift-allowed.txt")" ''

  check stock 'own photo served' "$(api GET "/assets/$PHOTO_A" "$owner" | jq -r .ownerId)" "$OWNER_ID"
  check stock 'owner favorite shown' "$(api GET "/assets/$PHOTO_A" "$owner" | jq -r .isFavorite)" true
  check stock "a member's favorite not shown as the owner's" "$(api GET "/assets/$PHOTO_B" "$owner" | jq -r .isFavorite)" false
  check stock 'trimmed video shows its original duration' "$(api GET "/assets/$VIDEO" "$owner" | jq -r .duration)" "$ORIGINAL_DURATION"
  # Stock web then asks for the edited thumbnail, which Gallery made from the trimmed part.
  check stock 'trimmed video keeps its edited thumbnail' "$(api GET "/assets/$VIDEO" "$owner" | jq -r .isEdited)" true
  api GET "/assets/$VIDEO/thumbnail?edited=true" "$owner" >"$STATE_DIR/stock-poster-edited"
  api GET "/assets/$VIDEO/thumbnail?edited=false" "$owner" >"$STATE_DIR/stock-poster-original"
  check stock 'trimmed video poster differs from the untrimmed one' \
    "$(cmp -s "$STATE_DIR/stock-poster-edited" "$STATE_DIR/stock-poster-original" || echo differs)" differs
  # Stock plays the original file: upstream reads only the unedited encoded video.
  api GET "/assets/$VIDEO/video/playback" "$owner" >"$STATE_DIR/stock-playback.mp4"
  docker cp "$STATE_DIR/stock-playback.mp4" server:/tmp/stock-playback.mp4
  check stock 'trimmed video plays at full length' \
    "$(docker exec server ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/stock-playback.mp4 |
      awk '{ printf "%.0f", $1 }')" "$(((ORIGINAL_DURATION + 500) / 1000))"
  local bucket
  bucket=$(api GET '/timeline/bucket?timeBucket=2024-01-01&visibility=timeline' "$owner")
  check stock 'timeline holds the owner photos and video' \
    "$(jq -c '[.id[]] | sort' <<<"$bucket")" "$(jq -nc --arg a "$PHOTO_A" --arg b "$PHOTO_B" --arg v "$VIDEO" '[$a, $b, $v] | sort')"
  check stock 'timeline favorites' "$(jq -c '[.id as $ids | .isFavorite | to_entries[] | select(.value) | $ids[.key]]' <<<"$bucket")" "[\"$PHOTO_A\"]"
  check stock 'timeline video duration' \
    "$(jq -r --arg v "$VIDEO" '.duration[.id | index($v)]' <<<"$bucket")" "$ORIGINAL_DURATION"
  check stock 'favorite toggle' "$(api PUT "/assets/$VIDEO" "$owner" '{"isFavorite":true}' | jq -r .isFavorite)" true

  # Jobs only Gallery knows: stock skips a fork job name in a queue it serves, and never reads a queue
  # only Gallery has.
  bull_add backgroundTask SharedSpaceAlbumGrantReconcileSweep
  bull_add classification AssetClassifyQueueAll
  local deadline=$(($(date +%s) + 60))
  until docker logs server 2>&1 | grep -F 'Skipping unknown job: "SharedSpaceAlbumGrantReconcileSweep"' >/dev/null; do
    [ "$(date +%s)" -lt "$deadline" ] || {
      echo "::error::stock: the fork job in a stock queue was not skipped within 60s"
      failed=1
      break
    }
    sleep 2
  done
  check stock 'a job in a Gallery-only queue stays queued' "$(docker exec redis valkey-cli LLEN immich_bull:classification:wait)" 1

  # What the guide's trial caveats say, so they stay true. A stock mobile app gets the rule memory and
  # the pet ("stops syncing", "pets show up as people").
  stock_sync_checks stock "$owner" true

  # Person sharing fails on Gallery's person_personGroupId_key index (stock logs no constraint name, so
  # a 200 here is what shows the index is gone). Sharing needs both users in one
  # cluster group, which Gallery cannot set up, so the member joins the owner's for this request only.
  local member_id member_cluster human_group
  member_id=$(psql_q "SELECT id FROM \"user\" WHERE email = 'member@example.com'")
  member_cluster=$(psql_q "SELECT \"clusterGroupId\" FROM \"user\" WHERE id = '$member_id'")
  human_group=$(psql_q "SELECT \"personGroupId\" FROM person WHERE name = 'Revert Human'")
  psql_q "UPDATE \"user\" SET \"clusterGroupId\" = (SELECT \"clusterGroupId\" FROM \"user\" WHERE id = '$OWNER_ID')
    WHERE id = '$member_id'" >/dev/null
  check stock 'person sharing fails with a server error' "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/people/users" \
    -H "Authorization: Bearer $owner" -H 'Content-Type: application/json' \
    --data "{\"personIds\":[\"$human_group\"],\"sharedWithIds\":[\"$member_id\"],\"role\":\"read\"}")" 500
  check stock 'failed person sharing saved nothing' "$(psql_q "SELECT count(*) FROM person_user")" 0
  psql_q "UPDATE \"user\" SET \"clusterGroupId\" = '$member_cluster' WHERE id = '$member_id'" >/dev/null

  # A settings save keeps only the settings stock knows, so Gallery's classification category goes.
  # Last here: nothing above depends on the config, and gallery-assert checks the loss.
  local config
  config=$(api GET /system-config "$owner")
  api PUT /system-config "$owner" "$config" >/dev/null
  check stock 'a settings save drops the Gallery settings' \
    "$(psql_q "SELECT coalesce(bool_or(value ? 'classification'), false) FROM system_metadata WHERE key = 'system-config'")" f

  [ "$failed" = 0 ] || exit 1
  echo "::notice::stock: Immich serves the owner on the Gallery database"
}

# The guide's steps for going back: flush what stock queued.
gallery_prepare() {
  docker exec redis valkey-cli FLUSHALL >/dev/null
}

# shellcheck disable=SC2153 # vars come from the sourced $STATE file
gallery_assert() {
  # shellcheck source=/dev/null
  . "$STATE"
  failed=0
  local owner member
  owner=$(login owner@example.com)
  member=$(login member@example.com)

  check gallery 'space assets kept' "$(psql_q "SELECT count(*) FROM shared_space_asset WHERE \"spaceId\" = '$SPACE'")" 3
  check gallery "member's favorite on the owner's photo kept" "$(api GET "/assets/$PHOTO_B" "$member" | jq -r .isFavorite)" true
  check gallery "owner's favorite kept" "$(api GET "/assets/$PHOTO_A" "$owner" | jq -r .isFavorite)" true
  check gallery 'favorite set on stock arrives' "$(api GET "/assets/$VIDEO" "$owner" | jq -r .isFavorite)" true
  check gallery 'trim kept' "$(api GET "/assets/$VIDEO/trim" "$owner" | jq -c '[.startTime, .endTime]')" '[1,3]'
  check gallery 'trimmed duration served again' \
    "$([ "$(api GET "/assets/$VIDEO" "$owner" | jq -r .duration)" -lt "$ORIGINAL_DURATION" ] && echo yes)" yes
  check gallery 'pet kept' "$(psql_q "SELECT count(*) FROM person WHERE name = 'Revert Pet'")" 1
  check gallery 'pet recognition kept' "$(psql_q "SELECT count(*) FROM pet_search")" 1
  check gallery 'rule memory kept' "$(psql_q "SELECT count(*) FROM memory WHERE type = 'rule'")" 1
  check gallery 'plugin row kept' "$(psql_q "SELECT id FROM plugin WHERE name = 'gallery-core' AND enabled")" "$(cat "$STATE_DIR/plugin-id")"
  check gallery 'plugin workflow step kept' "$(psql_q "
    SELECT count(*) FROM workflow_step s JOIN plugin_method m ON m.id = s.\"pluginMethodId\"
      JOIN plugin p ON p.id = m.\"pluginId\" WHERE p.name = 'gallery-core'")" 1
  # The guide's caveat: the stock settings save erased it. Saved again, for the revert to strip.
  check gallery 'classification category lost to the stock settings save' \
    "$(api GET /system-config "$owner" | jq '.classification.categories | length')" 0
  seed_category "$owner"

  # The workflow runs again: a new upload lands in the space through the Gallery plugin.
  local uploaded
  uploaded=$(upload "$owner" "$STATE_DIR/media/144x108.jpg")
  poll 120 "SELECT count(*) FROM shared_space_asset WHERE \"spaceId\" = '$SPACE' AND \"assetId\" = '$uploaded'" '^1$' >/dev/null

  [ "$failed" = 0 ] || exit 1
  echo "::notice::gallery: everything seeded survived the stock Immich boot"
}

s3_guard() {
  local revert_sql=$1 out
  psql_q "UPDATE \"user\" SET \"profileImagePath\" = 'profile/s3-key.jpg' WHERE email = 'member@example.com'" >/dev/null
  if out=$({ echo "SET gallery.revert_token = 'i_accept_data_loss';"; cat "$revert_sql"; } |
    docker exec -i database psql -U "${DB_USERNAME:-postgres}" -d "${DB_DATABASE_NAME:-immich}" -v ON_ERROR_STOP=1 2>&1); then
    fail "s3-guard: the revert script ran with an S3 path present"
  fi
  grep -qF 'Run the Storage Migration to disk first' <<<"$out" || fail "s3-guard: unexpected failure: $out"
  [ "$(psql_q "SELECT to_regclass('public.shared_space') IS NOT NULL")" = t ] ||
    fail "s3-guard: the refused run still changed the schema"
  psql_q "UPDATE \"user\" SET \"profileImagePath\" = '' WHERE email = 'member@example.com'" >/dev/null
  echo "::notice::s3-guard: revert refused an S3 path and left the database untouched"
}

# check PHASE NAME ACTUAL EXPECTED; sets failed=1 on a mismatch
check() {
  if [ "$3" != "$4" ]; then
    echo "::error::$1: $2: expected '$4', got '$3'"
    failed=1
  fi
}

# stock_sync_checks PHASE TOKEN [LEAKS]: what a stock mobile app would receive. The server streams
# whatever it sends; the stock app is what fails to decode a value its enums lack. So check the rows
# themselves. LEAKS is true for stock Immich on the unreverted database, which sends both.
stock_sync_checks() {
  local phase=$1 leaks=${3:-false} body
  body=$(curl -fsS --max-time 120 -X POST "$API/sync/stream" -H "Authorization: Bearer $2" \
    -H 'Content-Type: application/json' --data "{\"types\":${SYNC_TYPES:?}}") || {
    echo "::error::$phase: stock /sync/stream request failed"
    failed=1
  }
  check "$phase" 'sync stream completes' "$(jq -r .type <<<"$body" | tail -n1)" SyncCompleteV1
  check "$phase" 'sync sends a rule memory' \
    "$(jq -s 'any(.[]; (.type | startswith("MemoryV")) and .data.type == "rule")' <<<"$body")" "$leaks"
  check "$phase" 'sync sends the pet' "$(jq -s 'any(.[]; .type == "PersonV1" and .data.name == "Revert Pet")' <<<"$body")" "$leaks"
}

# shellcheck disable=SC2153 # vars come from the sourced $STATE file
assert() {
  # shellcheck source=/dev/null
  . "$STATE"
  failed=0
  local owner
  owner=$(login owner@example.com)

  check assert 'original downloads' "$(api GET "/assets/$PHOTO_A/original" "$owner" | sha1sum | cut -d' ' -f1)" "$PHOTO_A_SHA"
  check assert 'owner favorite kept' "$(api GET "/assets/$PHOTO_A" "$owner" | jq -r .isFavorite)" true
  check assert 'non-owner favorite not promoted' "$(api GET "/assets/$PHOTO_B" "$owner" | jq -r .isFavorite)" false
  # A Gallery trigger left on asset would make this write fail once asset_favorite is gone.
  check assert 'stock favorite toggle works' "$(api PUT "/assets/$PHOTO_B" "$owner" '{"isFavorite":true}' | jq -r .isFavorite)" true
  check assert 'stock unfavorite works' "$(api PUT "/assets/$PHOTO_B" "$owner" '{"isFavorite":false}' | jq -r .isFavorite)" false

  check assert 'pet person removed' "$(psql_q "SELECT count(*) FROM person WHERE name = 'Revert Pet'")" 0
  check assert 'pet faces removed' "$(psql_q "SELECT count(*) FROM asset_face WHERE \"assetId\" = '$PHOTO_B'")" 0
  check assert 'human face kept' "$(psql_q "SELECT count(*) FROM asset_face f JOIN person p ON p.\"personGroupId\" = f.\"personGroupId\" WHERE p.name = 'Revert Human'")" 1
  check assert 'pet absent from people API' "$(api GET /people "$owner" | jq '[.people[] | select(.name == "Revert Pet")] | length')" 0

  check assert 'rule memory removed' "$(psql_q "SELECT count(*) FROM memory WHERE type = 'rule'")" 0
  check assert 'memories API returns no rule' "$(api GET /memories "$owner" | jq '[.[] | select(.type == "rule")] | length')" 0

  check assert 'trim duration restored' "$(psql_q "SELECT duration FROM asset WHERE id = '$VIDEO'")" "$ORIGINAL_DURATION"
  check assert 'trimmed video no longer edited' "$(psql_q "SELECT \"isEdited\" FROM asset WHERE id = '$VIDEO'")" f
  check assert 'trimmed files unreferenced' "$(psql_q "SELECT count(*) FROM asset_file WHERE \"assetId\" = '$VIDEO' AND \"isEdited\"")" 0
  check assert 'trimmed thumbhash cleared' "$(psql_q "SELECT thumbhash IS NULL FROM asset WHERE id = '$VIDEO'")" t

  check assert 'space link keeps own photo' "$(status GET "/assets/$PHOTO_A?key=$MIXED_LINK")" 200
  check assert "space link stops serving the member's photo" "$(status GET "/assets/$MEMBER_PHOTO?key=$MIXED_LINK")" 400
  check assert "space link lists only the owner's photo" \
    "$(api GET "/shared-links/me?key=$MIXED_LINK" '' | jq -c '[.assets[].id]')" "[\"$PHOTO_A\"]"
  check assert 'space link with only the member photo removed' "$(status GET "/shared-links/me?key=$MEMBER_LINK")" 401
  check assert "space album link to the member's album removed" "$(status GET "/shared-links/me?key=$MEMBER_ALBUM_LINK")" 401
  check assert "partner link keeps the partner's photo" "$(status GET "/assets/$PARTNER_PHOTO?key=$PARTNER_LINK")" 200
  check assert "partner link stops serving the archived photo" "$(status GET "/assets/$PARTNER_ARCHIVED?key=$PARTNER_LINK")" 400
  check assert "space album link to the owner's album kept" "$(status GET "/shared-links/me?key=$OWNER_ALBUM_LINK")" 200
  check assert "space album link to an album the owner edits kept" "$(status GET "/shared-links/me?key=$EDITOR_ALBUM_LINK")" 200
  check assert "space album link to an album the owner only views removed" "$(status GET "/shared-links/me?key=$VIEWER_ALBUM_LINK")" 401

  check assert 'Gallery settings stripped' \
    "$(psql_q "SELECT coalesce(bool_or(value ? 'classification'), false) FROM system_metadata WHERE key = 'system-config'")" f
  check assert 'stock finds no unknown config keys' "$(docker logs server 2>&1 | grep -c 'Unknown keys found' || true)" 0

  stock_sync_checks assert "$owner"

  check assert 'no space converted without the setting' \
    "$(psql_q "SELECT count(*) FROM album WHERE \"albumName\" IN ('Revert test', 'Favorites from shared spaces')")" 0

  [ "$failed" = 0 ] || exit 1
  echo "::notice::assert: reverted data checks passed on stock Immich"
}

# On the copy only, as they would trip the main run's checks: the partner joins the space as a viewer,
# and the owner's video moves into a library linked to the space. The album must then hold the space's
# photos (the gallery phase's upload among them) and the video; the linked albums add none of their own.
# shellcheck disable=SC2153 # vars come from the sourced $STATE file
convert_seed() {
  # shellcheck source=/dev/null
  . "$STATE"
  psql_q "
    INSERT INTO shared_space_member (\"spaceId\", \"userId\", role)
    SELECT '$SPACE', id, 'viewer' FROM \"user\" WHERE email = 'partner@example.com';
    WITH l AS (INSERT INTO library (\"ownerId\", name, \"importPaths\", \"exclusionPatterns\")
               VALUES ('$OWNER_ID', 'Revert library', '{}', '{}') RETURNING id),
         s AS (INSERT INTO shared_space_library (\"spaceId\", \"libraryId\") SELECT '$SPACE', id FROM l)
    UPDATE asset SET \"libraryId\" = (SELECT id FROM l) WHERE id = '$VIDEO';
  " >/dev/null
  psql_q "SELECT \"assetId\" FROM shared_space_asset WHERE \"spaceId\" = '$SPACE' UNION SELECT '$VIDEO'" |
    jq -R . | jq -sc sort >"$STATE_DIR/convert-photos"
}

# shellcheck disable=SC2153 # vars come from the sourced $STATE file
convert_assert() {
  # shellcheck source=/dev/null
  . "$STATE"
  failed=0
  local owner member partner album photos user
  owner=$(login owner@example.com)
  member=$(login member@example.com)
  partner=$(login partner@example.com)

  check convert 'one album for the space' "$(psql_q "SELECT count(*) FROM album WHERE \"albumName\" = 'Revert test'")" 1
  album=$(psql_q "SELECT id FROM album WHERE \"albumName\" = 'Revert test' LIMIT 1")
  check convert 'space members keep their roles' \
    "$(api GET "/albums/$album" "$owner" | jq -c '[.albumUsers[] | [.user.email, .role]] | sort')" \
    '[["member@example.com","editor"],["owner@example.com","owner"],["partner@example.com","viewer"]]'
  photos=$(cat "$STATE_DIR/convert-photos")
  for user in "$owner" "$member" "$partner"; do
    check convert 'every member sees the space photos' \
      "$(api GET "/timeline/bucket?albumId=$album&timeBucket=2024-01-01" "$user" | jq -c '[.id[]] | sort')" "$photos"
  done

  album_roles() {
    psql_q "SELECT string_agg(u.email || ':' || au.role, ',' ORDER BY u.email)
      FROM album_user au JOIN \"user\" u ON u.id = au.\"userId\" WHERE au.\"albumId\" = '$1'"
  }
  check convert 'linked album granted to the space members' "$(album_roles "$MEMBER_ALBUM")" \
    'member@example.com:owner,owner@example.com:editor,partner@example.com:viewer'
  check convert 'an existing album role is left alone' "$(album_roles "$VIEWER_ALBUM")" \
    'member@example.com:owner,owner@example.com:viewer,partner@example.com:viewer'

  check convert "the member's favorites of the owner's photos kept" \
    "$(api GET /albums "$member" | jq -c '[.[] | select(.albumName == "Favorites from shared spaces") | .assetCount]')" '[2]'
  check convert 'only the member gets a favorites album' \
    "$(psql_q "SELECT count(*) FROM album WHERE \"albumName\" = 'Favorites from shared spaces'")" 1

  check convert 'Add to space step moved to Add to Album(s)' "$(psql_q "
    SELECT m.name || ' ' || (s.config -> 'albumIds')::text FROM workflow_step s JOIN plugin_method m ON m.id = s.\"pluginMethodId\"")" \
    "assetAddToAlbums [\"$album\"]"
  local uploaded
  uploaded=$(upload "$owner" "$STATE_DIR/media/160x120.jpg")
  poll 120 "SELECT count(*) FROM album_asset WHERE \"albumId\" = '$album' AND \"assetId\" = '$uploaded'" '^1$' >/dev/null

  [ "$failed" = 0 ] || exit 1
  echo "::notice::convert: the space is a shared album on stock Immich"
}

case ${1:-} in
  seed) seed ;;
  stock-prepare) stock_prepare ;;
  stock-assert) stock_assert "${2:?stock drift file}" "${3:?baseline drift file}" "${4:?path to revert-to-immich.sql}" ;;
  gallery-prepare) gallery_prepare ;;
  gallery-assert) gallery_assert ;;
  s3-guard) s3_guard "${2:?path to revert-to-immich.sql}" ;;
  assert) assert ;;
  convert-seed) convert_seed ;;
  convert-assert) convert_assert ;;
  *) fail "usage: $0 seed | stock-prepare | stock-assert <drift> <baseline> <revert-to-immich.sql> | gallery-prepare | gallery-assert | s3-guard <revert-to-immich.sql> | assert | convert-seed | convert-assert" ;;
esac
