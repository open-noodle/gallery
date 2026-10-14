#!/usr/bin/env bash
# Seeds a Gallery database with the data scripts/revert-to-immich.sql has to clean up, then checks
# the result through a stock Immich server. Used by gallery-revert-to-immich-validation.yml.
#
#   revert-to-immich-data.sh seed          Gallery server running on :2283
#   revert-to-immich-data.sh s3-guard      no server running; the script must refuse an S3 path
#   revert-to-immich-data.sh assert        stock Immich server running on :2283, after the revert
#
# Expects containers named `server` and `database`. SYNC_TYPES (seed, assert) is a JSON array of the
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
  for size in 64x48 80x60 96x72 112x84 128x96; do
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

  # Trim needs the extracted duration; the trim job rewrites asset.duration when it finishes.
  local original_duration
  original_duration=$(poll 180 "SELECT coalesce(duration, 0) FROM asset WHERE id = '$video'" '^[1-9][0-9]*$')
  api PUT "/assets/$video/edits" "$owner" \
    '{"edits":[{"action":"trim","parameters":{"startTime":1,"endTime":3}}]}' >/dev/null
  poll 180 "SELECT duration FROM asset WHERE id = '$video' AND duration <> $original_duration" '^[0-9]+$' >/dev/null

  # A space with the member as editor, holding both owners' photos.
  local space
  space=$(api POST /shared-spaces "$owner" '{"name":"Revert test"}' | jq -r .id)
  api POST "/shared-spaces/$space/members" "$owner" "{\"userId\":\"$member_id\",\"role\":\"editor\"}" >/dev/null
  api POST "/shared-spaces/$space/assets" "$owner" "{\"assetIds\":[\"$photo_a\",\"$photo_b\"]}" >/dev/null
  api POST "/shared-spaces/$space/assets" "$member" "{\"assetIds\":[\"$member_photo\"]}" >/dev/null

  # photo_a: owner and member favorite. photo_b: only the member (not the owner) favorites.
  api PUT /assets "$owner" "{\"ids\":[\"$photo_a\"],\"isFavorite\":true}" >/dev/null
  api PUT /assets "$member" "{\"ids\":[\"$photo_a\",\"$photo_b\"],\"isFavorite\":true}" >/dev/null

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
         p AS (INSERT INTO person (\"ownerId\", \"personGroupId\", name, type, species)
               SELECT '$owner_id', id, 'Revert Pet', 'pet', 'dog' FROM g RETURNING \"personGroupId\")
    INSERT INTO asset_face (\"assetId\", \"personGroupId\") SELECT '$photo_b', \"personGroupId\" FROM p;
    WITH f AS (INSERT INTO asset_face (\"assetId\") VALUES ('$photo_b') RETURNING id)
    INSERT INTO pet_search (\"faceId\", embedding, species)
    SELECT id, ('[' || array_to_string(array_fill(0.1, ARRAY[512]), ',') || ']')::vector, 'dog' FROM f;
    WITH g AS (INSERT INTO person_group (\"clusterGroupId\") SELECT \"clusterGroupId\" FROM \"user\" WHERE id = '$owner_id' RETURNING id),
         p AS (INSERT INTO person (\"ownerId\", \"personGroupId\", name)
               SELECT '$owner_id', id, 'Revert Human' FROM g RETURNING \"personGroupId\")
    INSERT INTO asset_face (\"assetId\", \"personGroupId\") SELECT '$photo_a', \"personGroupId\" FROM p;
  " >/dev/null

  # The same stock request against Gallery itself: the gating, not the revert, keeps these out.
  failed=0
  stock_sync_checks seed "$owner"
  [ "$failed" = 0 ] || exit 1

  cat >"$STATE" <<EOF
OWNER_ID=$owner_id
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
PARTNER_PHOTO=$partner_photo
PARTNER_ARCHIVED=$partner_archived
PARTNER_LINK=$partner_link
PHOTO_A_SHA=$(sha1sum "$media/64x48.jpg" | cut -d' ' -f1)
EOF
  echo "::notice::seed: Gallery data written"
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

# stock_sync_checks PHASE TOKEN: what a stock mobile app would receive. The server streams whatever it
# sends; the stock app is what fails to decode a value its enums lack. So check the rows themselves.
stock_sync_checks() {
  local phase=$1 body
  body=$(curl -fsS --max-time 120 -X POST "$API/sync/stream" -H "Authorization: Bearer $2" \
    -H 'Content-Type: application/json' --data "{\"types\":${SYNC_TYPES:?}}") || {
    echo "::error::$phase: stock /sync/stream request failed"
    failed=1
  }
  check "$phase" 'sync stream completes' "$(jq -r .type <<<"$body" | tail -n1)" SyncCompleteV1
  check "$phase" 'sync sends no trim edit' "$(jq -c 'select(.type == "AssetEditV1" and .data.action == "trim")' <<<"$body")" ''
  check "$phase" 'sync sends no rule memory' "$(jq -c 'select((.type | startswith("MemoryV")) and .data.type == "rule")' <<<"$body")" ''
  check "$phase" 'sync sends no pet' "$(jq -c 'select(.type == "PersonV1" and .data.name == "Revert Pet")' <<<"$body")" ''
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

  check assert 'pet person removed' "$(psql_q "SELECT count(*) FROM person WHERE name = 'Revert Pet'")" 0
  check assert 'pet faces removed' "$(psql_q "SELECT count(*) FROM asset_face WHERE \"assetId\" = '$PHOTO_B'")" 0
  check assert 'human face kept' "$(psql_q "SELECT count(*) FROM asset_face f JOIN person p ON p.\"personGroupId\" = f.\"personGroupId\" WHERE p.name = 'Revert Human'")" 1
  check assert 'pet absent from people API' "$(api GET /people "$owner" | jq '[.people[] | select(.name == "Revert Pet")] | length')" 0

  check assert 'rule memory removed' "$(psql_q "SELECT count(*) FROM memory WHERE type = 'rule'")" 0
  check assert 'memories API returns no rule' "$(api GET /memories "$owner" | jq '[.[] | select(.type == "rule")] | length')" 0

  check assert 'trim duration restored' "$(psql_q "SELECT duration FROM asset WHERE id = '$VIDEO'")" "$ORIGINAL_DURATION"
  check assert 'trim edit removed' "$(psql_q "SELECT count(*) FROM asset_edit WHERE \"assetId\" = '$VIDEO'")" 0
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

  stock_sync_checks assert "$owner"

  [ "$failed" = 0 ] || exit 1
  echo "::notice::assert: reverted data checks passed on stock Immich"
}

case ${1:-} in
  seed) seed ;;
  s3-guard) s3_guard "${2:?path to revert-to-immich.sql}" ;;
  assert) assert ;;
  *) fail "usage: $0 seed | s3-guard <revert-to-immich.sql> | assert" ;;
esac
