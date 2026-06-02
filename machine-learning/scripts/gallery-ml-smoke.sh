#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKER_BIN="${GALLERY_ML_SMOKE_DOCKER_BIN:-docker}"
IMAGE_NAME="${GALLERY_ML_SMOKE_IMAGE:-gallery-ml-smoke:local}"
CONTAINER_NAME="${GALLERY_ML_SMOKE_CONTAINER:-gallery-ml-smoke-$$}"
CONTAINER_STARTED=0
HEALTH_TIMEOUT_SECONDS=180
HEALTH_SLEEP_SECONDS=2
HEALTH_ATTEMPTS=$((HEALTH_TIMEOUT_SECONDS / HEALTH_SLEEP_SECONDS))

cleanup() {
  local status=$?
  set +e

  if [[ "$CONTAINER_STARTED" == "1" ]]; then
    if [[ "$status" -ne 0 ]]; then
      echo "--- gallery-ml-smoke container logs ---" >&2
      "$DOCKER_BIN" logs "$CONTAINER_NAME" >&2 || true
      echo "--- end gallery-ml-smoke container logs ---" >&2
    fi
    "$DOCKER_BIN" rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi

  exit "$status"
}
trap cleanup EXIT

if ! command -v "$DOCKER_BIN" >/dev/null 2>&1; then
  echo "ERROR: Docker is required for gallery-ml-smoke; install Docker or run the dispatchable gallery-ml-smoke workflow." >&2
  exit 1
fi

if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  echo "ERROR: Docker is required for gallery-ml-smoke, but the Docker daemon is not reachable." >&2
  exit 1
fi

if ! "$DOCKER_BIN" buildx version >/dev/null 2>&1; then
  echo "ERROR: Docker Buildx is required for gallery-ml-smoke; install Buildx or run the dispatchable gallery-ml-smoke workflow." >&2
  exit 1
fi

echo "=== Gallery ML smoke ==="
echo "--- Building CPU ML image: $IMAGE_NAME ---"
"$DOCKER_BIN" buildx build \
  --load \
  --build-arg DEVICE=cpu \
  --tag "$IMAGE_NAME" \
  --file "$REPO_ROOT/machine-learning/Dockerfile" \
  "$REPO_ROOT/machine-learning"

echo "--- Starting ML container: $CONTAINER_NAME ---"
"$DOCKER_BIN" run --detach --name "$CONTAINER_NAME" "$IMAGE_NAME" >/dev/null
CONTAINER_STARTED=1

echo "--- Waiting for ML container health ---"
for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  runtime_state="$("$DOCKER_BIN" inspect --format '{{.State.Status}}' "$CONTAINER_NAME")"
  health_status="$("$DOCKER_BIN" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}}' "$CONTAINER_NAME")"

  if [[ "$runtime_state" != "running" ]]; then
    echo "ERROR: ML container is not running; state: $runtime_state, health: $health_status" >&2
    exit 1
  fi

  case "$health_status" in
    healthy)
      echo "ML container is healthy"
      break
      ;;
    missing-healthcheck)
      echo "ERROR: ML container has no Docker healthcheck metadata" >&2
      exit 1
      ;;
    unhealthy)
      echo "ERROR: ML container healthcheck is unhealthy" >&2
      exit 1
      ;;
  esac

  if [[ "$attempt" -eq "$HEALTH_ATTEMPTS" ]]; then
    echo "ERROR: ML container did not become healthy within $HEALTH_TIMEOUT_SECONDS seconds; last state: $runtime_state, health: $health_status" >&2
    exit 1
  fi

  sleep "$HEALTH_SLEEP_SECONDS"
done

echo "--- Probing ML /ping healthcheck ---"
"$DOCKER_BIN" exec "$CONTAINER_NAME" python3 healthcheck.py

echo "--- Verifying Gallery ML imports ---"
"$DOCKER_BIN" exec "$CONTAINER_NAME" python3 - <<'PY'
import importlib

for module_name in (
    "immich_ml.main",
    "immich_ml.models",
    "immich_ml.config",
    "immich_ml.metrics",
):
    importlib.import_module(module_name)

print("Gallery ML imports loaded")
PY

echo "=== Gallery ML smoke passed ==="
