#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1}"
CORE_SERVICES=(db redis backend frontend nginx)
BACKEND_TESTS=(
  "tests/test_app_runtime.py"
  "tests/test_ohlcv_store.py"
  "tests/test_backtest.py"
  "tests/test_backtest_api.py"
  "tests/test_market_quote_api.py"
  "tests/test_factors_api.py"
  "tests/test_backtest_lab_contract_api.py"
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

echo "[1/6] Check workspace root"
cd "$ROOT_DIR"

if run_compose ps >/dev/null 2>&1; then
  echo "[2/6] Start core workspace stack with Docker Compose"
  run_compose up -d --build "${CORE_SERVICES[@]}"

  echo "[3/6] Wait for core HTTP health"
  wait_for_http "$BASE_URL/api/v1/health" 30 2
  wait_for_http "$BASE_URL/market" 30 2

  echo "[4/6] Run backend regression in container"
  run_compose exec -T backend pytest -q "${BACKEND_TESTS[@]}"

  echo "[5/6] Run frontend performance gate locally"
  (cd frontend && npm run build)
  (cd frontend && npm run check:performance)

  echo "[6/6] Run runtime smoke scripts"
  BASE_URL="$BASE_URL" bash scripts/smoke_frontend_routes.sh
  BASE_URL="$BASE_URL" bash scripts/smoke_runtime.sh
else
  echo "[2/6] Docker unavailable, fallback to local validation"

  echo "[3/6] Run backend regression locally"
  python3 -m pytest -q "backend/${BACKEND_TESTS[0]}" "backend/${BACKEND_TESTS[1]}" "backend/${BACKEND_TESTS[2]}" "backend/${BACKEND_TESTS[3]}" "backend/${BACKEND_TESTS[4]}" "backend/${BACKEND_TESTS[5]}" "backend/${BACKEND_TESTS[6]}"

  echo "[4/6] Run frontend tests/build locally"
  (cd frontend && npm test)
  (cd frontend && npm run build)

  echo "[5/6] Run frontend performance gate locally"
  (cd frontend && npm run check:performance)

  echo "[6/6] Skip runtime smoke because Docker/stack access is unavailable in this shell"
fi

echo "Workspace validation passed."
