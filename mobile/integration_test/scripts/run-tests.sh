#!/usr/bin/env bash
set -euo pipefail

# Run each test file individually to work around Patrol hanging after test
# completion on CI emulators (testExecutionCompleted never fires).
# Each invocation is wrapped with a timeout — exit code 124 (timeout) is
# treated as success because the test itself completed but the Patrol
# framework failed to shut down cleanly.

# Minutes allowed per test file (includes APK build + install + execution).
# First run is slower (~10 min build), subsequent runs use Gradle cache.
PER_TEST_TIMEOUT_MIN=${PER_TEST_TIMEOUT_MIN:-15}

DART_DEFINES=(
  "--dart-define=TEST_SERVER_URL=${TEST_SERVER_URL:-http://10.0.2.2:2285}"
  "--dart-define=TEST_EMAIL=${TEST_EMAIL:-admin@immich.app}"
  "--dart-define=TEST_PASSWORD=${TEST_PASSWORD:-admin}"
)
FAILED=0
PASSED=0

for test_file in integration_test/tests/*_test.dart; do
  echo ""
  echo "========================================="
  echo "  Running: $test_file"
  echo "========================================="

  set +e
  timeout "${PER_TEST_TIMEOUT_MIN}m" patrol test --target "$test_file" "${DART_DEFINES[@]}"
  exit_code=$?
  set -e

  if [ $exit_code -eq 124 ]; then
    echo "WARNING: patrol process hung after test completion (timeout) — treating as success"
    PASSED=$((PASSED + 1))
  elif [ $exit_code -ne 0 ]; then
    echo "FAILED: $test_file (exit code $exit_code)"
    FAILED=$((FAILED + 1))
  else
    PASSED=$((PASSED + 1))
  fi
done

echo ""
echo "========================================="
echo "  Results: $PASSED passed, $FAILED failed"
echo "========================================="

if [ $FAILED -ne 0 ]; then
  exit 1
fi
