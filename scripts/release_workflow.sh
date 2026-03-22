#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/logs/releases"
CORE_SERVICES=(db redis backend frontend nginx)
CORE_IMAGES=(
  "backend:finance-plat-backend:latest"
  "frontend:finance-plat-frontend:latest"
)

usage() {
  cat <<'EOF'
Usage:
  bash scripts/release_workflow.sh snapshot
  bash scripts/release_workflow.sh promote
  bash scripts/release_workflow.sh rollback <snapshot_json>
  bash scripts/release_workflow.sh status

Commands:
  snapshot   Save current core image ids for rollback.
  promote    Snapshot current images, rebuild/start core stack, run schema + runtime gates, archive logs.
  rollback   Retag saved image ids back to latest and restart core runtime, then rerun validation.
  status     List saved release snapshots.
EOF
}

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

run_docker() {
  if docker version >/dev/null 2>&1; then
    docker "$@"
    return 0
  fi

  if command -v sg >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
    sg docker -c "docker $*"
    return 0
  fi

  echo "Docker is unavailable in this shell." >&2
  exit 1
}

timestamp() {
  date -u +"%Y%m%dT%H%M%SZ"
}

ensure_release_dir() {
  mkdir -p "$RELEASE_DIR"
}

snapshot_release() {
  ensure_release_dir
  local stamp
  stamp="$(timestamp)"
  local output_path="$RELEASE_DIR/release_state_${stamp}.json"

  local backend_id frontend_id
  backend_id="$(run_docker image inspect --format '{{.Id}}' finance-plat-backend:latest 2>/dev/null || true)"
  frontend_id="$(run_docker image inspect --format '{{.Id}}' finance-plat-frontend:latest 2>/dev/null || true)"

  python3 - <<'PY' "$output_path" "$backend_id" "$frontend_id" "$ROOT_DIR"
import json
import subprocess
import sys
from pathlib import Path

output_path = Path(sys.argv[1])
backend_id = sys.argv[2] or None
frontend_id = sys.argv[3] or None
root_dir = sys.argv[4]

def git_head() -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", root_dir, "rev-parse", "HEAD"],
            text=True,
        ).strip()
    except Exception:
        return None

payload = {
    "created_at": output_path.stem.removeprefix("release_state_"),
    "git_head": git_head(),
    "images": {
        "backend": {"name": "finance-plat-backend:latest", "id": backend_id},
        "frontend": {"name": "finance-plat-frontend:latest", "id": frontend_id},
    },
}
output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(output_path)
PY
}

schema_check() {
  local query="
SELECT
  to_regclass('public.assets') IS NOT NULL AS assets_ok,
  to_regclass('public.ohlcv_daily') IS NOT NULL AS ohlcv_ok,
  to_regclass('public.market_snapshot_daily') IS NOT NULL AS market_snapshot_daily_ok,
  to_regclass('public.backtest_cache') IS NOT NULL AS backtest_cache_ok;
"
  run_compose exec -T db psql -U "${DB_USER:-finuser}" -d "${DB_NAME:-finterminal}" -P pager=off -x -c "$query"
}

archive_release_logs() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  run_compose ps > "$target_dir/compose_ps.txt" || true
  run_compose logs --tail=300 backend frontend nginx > "$target_dir/compose_runtime.log" || true
}

promote_release() {
  ensure_release_dir
  local snapshot_path
  snapshot_path="$(snapshot_release)"
  local stamp
  stamp="$(basename "$snapshot_path" .json)"
  local target_dir="$RELEASE_DIR/$stamp"
  mkdir -p "$target_dir"

  echo "Pre-release snapshot: $snapshot_path"
  echo "[promote 1/5] Build and start core stack"
  run_compose up -d --build "${CORE_SERVICES[@]}"

  echo "[promote 2/5] Verify schema baseline"
  schema_check | tee "$target_dir/schema_check.txt"

  echo "[promote 3/5] Run workspace validation"
  bash "$ROOT_DIR/scripts/run_workspace_validation.sh" | tee "$target_dir/workspace_validation.log"

  echo "[promote 4/5] Archive runtime evidence"
  archive_release_logs "$target_dir"

  echo "[promote 5/5] Save snapshot pointer"
  cp "$snapshot_path" "$target_dir/pre_release_state.json"
  echo "Release promote flow completed: $target_dir"
}

rollback_release() {
  local snapshot_path="${1:-}"
  if [[ -z "$snapshot_path" ]]; then
    echo "rollback requires a snapshot json path" >&2
    usage
    exit 1
  fi
  if [[ ! -f "$snapshot_path" ]]; then
    echo "Snapshot file not found: $snapshot_path" >&2
    exit 1
  fi

  mapfile -t image_pairs < <(python3 - <<'PY' "$snapshot_path"
import json
import sys

payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
for service, config in payload.get("images", {}).items():
    image_id = config.get("id")
    image_name = config.get("name")
    if image_id and image_name:
        print(f"{service}|{image_id}|{image_name}")
PY
)

  if [[ "${#image_pairs[@]}" -eq 0 ]]; then
    echo "No rollback image ids found in $snapshot_path" >&2
    exit 1
  fi

  echo "[rollback 1/3] Restore image tags"
  local pair service image_id image_name
  for pair in "${image_pairs[@]}"; do
    IFS='|' read -r service image_id image_name <<<"$pair"
    echo "Retag $service -> $image_name from $image_id"
    run_docker image tag "$image_id" "$image_name"
  done

  echo "[rollback 2/3] Restart core runtime"
  run_compose up -d backend frontend nginx

  echo "[rollback 3/3] Re-run workspace validation"
  bash "$ROOT_DIR/scripts/run_workspace_validation.sh"
}

status_release() {
  ensure_release_dir
  ls -1 "$RELEASE_DIR"/release_state_*.json 2>/dev/null || echo "No release snapshots yet."
}

main() {
  cd "$ROOT_DIR"
  local command="${1:-}"
  case "$command" in
    snapshot)
      snapshot_release
      ;;
    promote)
      promote_release
      ;;
    rollback)
      rollback_release "${2:-}"
      ;;
    status)
      status_release
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
