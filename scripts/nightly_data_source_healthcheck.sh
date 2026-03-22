#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs/maintenance"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
OUTPUT_PATH="$LOG_DIR/provider_healthcheck_${STAMP}.json"

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

mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"

echo "[1/4] Start backend health-check runtime"
run_compose up -d db redis backend

echo "[2/4] Wait for backend health"
wait_for_http "http://127.0.0.1:8000/api/v1/health" 30 2

echo "[3/4] Run provider health checks"
if [[ "${FAIL_ON_DEGRADED:-0}" == "1" ]]; then
  run_compose exec -T backend python scripts/provider_healthcheck.py --fail-on-degraded > "$OUTPUT_PATH"
else
  run_compose exec -T backend python scripts/provider_healthcheck.py > "$OUTPUT_PATH"
fi

echo "[4/4] Health report saved to $OUTPUT_PATH"
python3 - <<'PY' "$OUTPUT_PATH"
import json
import sys

payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
summary = payload.get("summary", {})
print(f"status={summary.get('status')} ok={summary.get('ok_checks')} degraded={summary.get('degraded_checks')} error={summary.get('error_checks')}")
PY
