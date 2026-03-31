#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1}"
SKIP_FRONTEND_VALIDATION="${SKIP_FRONTEND_VALIDATION:-0}"
CORE_SERVICES=(db redis backend celery_worker celery_beat frontend nginx)
BACKEND_TESTS=(
  "tests/test_realtime_defaults.py"
)

has_docker_access() {
  docker compose version >/dev/null 2>&1 || return 1
  docker compose ps >/dev/null 2>&1
}

run_compose() {
  if has_docker_access; then
    docker compose "$@"
    return 0
  fi

  if command -v sg >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
    sg docker -c "cd '$ROOT_DIR' && docker compose $*"
    return 0
  fi

  return 1
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

echo "[1/7] Check workspace root"
cd "$ROOT_DIR"

echo "[2/7] Run live-only audit gate"
bash scripts/audit_live_only.sh

if run_compose ps >/dev/null 2>&1; then
  echo "[3/7] Start core workspace stack with Docker Compose"
  run_compose up -d --build --force-recreate "${CORE_SERVICES[@]}"

  echo "[4/7] Wait for core HTTP health"
  wait_for_http "$BASE_URL/api/v2/system/health" 30 2
  wait_for_http "$BASE_URL/" 30 2

  echo "[5/7] Run backend regression in container"
  run_compose exec -T backend pytest -q "${BACKEND_TESTS[@]}"

  if [[ "$SKIP_FRONTEND_VALIDATION" == "1" ]]; then
    echo "[6/7] Skip frontend tests/build/performance because a separate CI frontend job already validated them"
  else
    echo "[6/7] Run frontend tests/build/performance locally"
    (cd frontend && npm test)
    (cd frontend && npm run build)
    (cd frontend && npm run check:performance)
  fi

  echo "[7/7] Run runtime smoke scripts"
  BASE_URL="$BASE_URL" bash scripts/smoke_frontend_routes.sh
  BASE_URL="$BASE_URL" bash scripts/smoke_runtime.sh
else
  echo "[3/7] Docker unavailable, fallback to local validation"

  echo "[4/7] Run backend regression locally"
  python3 -m pytest -q "${BACKEND_TESTS[@]/#/backend/}"

  if [[ "$SKIP_FRONTEND_VALIDATION" == "1" ]]; then
    echo "[5/7] Skip frontend tests/build locally because a separate CI frontend job already validated them"
    echo "[6/7] Skip frontend performance gate locally because a separate CI frontend job already validated them"
  else
    echo "[5/7] Run frontend tests/build locally"
    (cd frontend && npm test)
    (cd frontend && npm run build)

    echo "[6/7] Run frontend performance gate locally"
    (cd frontend && npm run check:performance)
  fi

  echo "[7/7] Skip runtime smoke because Docker/stack access is unavailable in this shell"
fi

echo "Workspace validation passed."
