#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[live-only-audit] start"
python3 "$ROOT_DIR/scripts/audit_live_only.py" --root "$ROOT_DIR" "$@"
echo "[live-only-audit] pass"
