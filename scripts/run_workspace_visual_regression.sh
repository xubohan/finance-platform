#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/logs/visual-regression/$(date -u +"%Y%m%dT%H%M%SZ")}"
BASELINE_PATH="${BASELINE_PATH:-$ROOT_DIR/docs/visual-regression/market_workspace_baseline.json}"
CORE_SERVICES=(db redis backend frontend nginx)

run_compose() {
  if docker compose version >/dev/null 2>&1 && docker compose ps >/dev/null 2>&1; then
    docker compose "$@"
    return 0
  fi
  if command -v sg >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
    sg docker -c "cd '$ROOT_DIR' && docker compose $*"
    return 0
  fi
  echo "Docker Compose is unavailable in this shell." >&2
  exit 1
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-30}"
  local sleep_seconds="${3:-2}"
  local attempt=1
  while (( attempt <= attempts )); do
    if curl --noproxy '*' -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done
  return 1
}

mkdir -p "$OUTPUT_DIR"
cd "$ROOT_DIR"

echo "[1/4] Start core stack for visual regression"
run_compose up -d --build "${CORE_SERVICES[@]}"

echo "[2/4] Wait for market page"
wait_for_http "$BASE_URL/market" 30 2

echo "[3/4] Capture workspace sections"
CAPTURE_ARGS=(--base-url "$BASE_URL" --output-dir "$OUTPUT_DIR" --baseline "$BASELINE_PATH")
if [[ "${WRITE_BASELINE:-0}" == "1" ]]; then
  CAPTURE_ARGS+=(--write-baseline "$BASELINE_PATH")
fi
(cd frontend && node ./scripts/capture_workspace_visual_regression.mjs "${CAPTURE_ARGS[@]}") | tee "$OUTPUT_DIR/run.log"

echo "[4/4] Visual regression artifacts saved to $OUTPUT_DIR"
