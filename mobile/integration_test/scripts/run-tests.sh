#!/usr/bin/env bash
set -euo pipefail

# Run each test file individually to avoid Android Test Orchestrator
# hanging after the first test (known Patrol issue on CI emulators).

DART_DEFINES=(
  "--dart-define=TEST_SERVER_URL=${TEST_SERVER_URL:-http://10.0.2.2:2285}"
  "--dart-define=TEST_EMAIL=${TEST_EMAIL:-admin@immich.app}"
  "--dart-define=TEST_PASSWORD=${TEST_PASSWORD:-admin}"
)
FAILED=0

for test_file in integration_test/tests/*_test.dart; do
  echo ""
  echo "========================================="
  echo "  Running: $test_file"
  echo "========================================="
  if ! patrol test --target "$test_file" "${DART_DEFINES[@]}"; then
    echo "FAILED: $test_file"
    FAILED=1
  fi
done

if [ $FAILED -ne 0 ]; then
  echo "One or more test files failed"
  exit 1
fi

echo ""
echo "All tests passed!"
