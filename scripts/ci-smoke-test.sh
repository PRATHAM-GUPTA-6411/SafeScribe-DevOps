#!/usr/bin/env bash
# Smoke test for the built API image. Starts it the way production should (read-only filesystem,
# no capabilities, non-root) and checks the properties we rely on.
# Usage: bash scripts/ci-smoke-test.sh <image> <expected-version>
set -euo pipefail

IMAGE="${1:?usage: ci-smoke-test.sh <image> <expected-version>}"
EXPECTED_VERSION="${2:?usage: ci-smoke-test.sh <image> <expected-version>}"
NAME="safescribe-smoke-$$"
PORT=18080
FAILURES=0

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

check() { # check "<description>" <command...>
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS  $description"
  else
    echo "FAIL  $description"
    FAILURES=$((FAILURES + 1))
  fi
}

http_code() { curl -s -o /dev/null -w '%{http_code}' "$1" || true; }

echo "Starting $IMAGE ..."
docker run -d --name "$NAME" --init -p "$PORT:8080" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --health-interval 3s --health-timeout 3s --health-start-period 3s --health-retries 5 \
  -e COGNITO_USER_POOL_ID=us-east-1_SmokeTest -e COGNITO_CLIENT_ID=smoke \
  -e COGNITO_DOMAIN=https://smoke.auth.us-east-1.amazoncognito.com \
  -e AWS_ACCESS_KEY_ID=smoke -e AWS_SECRET_ACCESS_KEY=smoke \
  "$IMAGE" >/dev/null

echo "Waiting for the container to report healthy ..."
status="starting"
for _ in $(seq 1 40); do
  if [ "$(docker inspect --format '{{.State.Running}}' "$NAME")" != "true" ]; then
    echo "Container stopped unexpectedly. Logs:"
    docker logs "$NAME" || true
    exit 1
  fi
  status="$(docker inspect --format '{{.State.Health.Status}}' "$NAME")"
  [ "$status" = "healthy" ] && break
  sleep 2
done
if [ "$status" != "healthy" ]; then
  echo "Container never became healthy (status: $status). Logs:"
  docker logs "$NAME" || true
  exit 1
fi
echo "PASS  container reports healthy"

BASE="http://127.0.0.1:$PORT"
check "/health reports version $EXPECTED_VERSION" bash -c "curl -fsS '$BASE/health' | grep -q '\"version\":\"$EXPECTED_VERSION\"'"
check "/ serves the frontend (200)" test "$(http_code "$BASE/")" = "200"
check "/config.js is served (200)" test "$(http_code "$BASE/config.js")" = "200"
check "/api/notes without a token is rejected (401)" test "$(http_code "$BASE/api/notes")" = "401"
check "/metrics is NOT available on the public port (404)" test "$(http_code "$BASE/metrics")" = "404"
check "process runs as uid 1000 (not root)" test "$(docker exec "$NAME" id -u)" = "1000"
check "tests are not shipped in the image" bash -c "! docker exec '$NAME' test -e /app/frontend/test && ! docker exec '$NAME' test -e /app/backend/test"
check "dev dependencies are not shipped in the image" bash -c "! docker exec '$NAME' test -e /app/backend/node_modules/jsdom"

echo "Stopping (SIGTERM) ..."
docker stop --time 15 "$NAME" >/dev/null
check "container exits cleanly on SIGTERM (exit code 0)" test "$(docker inspect --format '{{.State.ExitCode}}' "$NAME")" = "0"

size_bytes="$(docker image inspect --format '{{.Size}}' "$IMAGE")"
size_mb=$((size_bytes / 1024 / 1024))
echo "Image size: ${size_mb} MB"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Docker smoke test"
    echo "- Image: \`$IMAGE\` (${size_mb} MB)"
    echo "- Version: \`$EXPECTED_VERSION\`"
    echo "- Failed checks: $FAILURES"
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "$FAILURES check(s) failed."
  exit 1
fi
echo "All smoke-test checks passed."
