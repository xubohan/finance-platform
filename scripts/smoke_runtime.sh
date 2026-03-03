#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
TMP_DIR="$(mktemp -d)"
ROOT_HTML="$TMP_DIR/root.html"
ROOT_HEADERS="$TMP_DIR/root.headers"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[1/6] Check root page"
ROOT_CODE="$(curl --noproxy '*' -sS -L -D "$ROOT_HEADERS" -o "$ROOT_HTML" -w '%{http_code}' "$BASE_URL/")"
if [[ "$ROOT_CODE" != "200" ]]; then
  echo "Root page check failed: HTTP $ROOT_CODE"
  exit 1
fi

echo "[2/6] Check static assets referenced by root page"
python3 - "$BASE_URL" "$ROOT_HTML" <<'PY'
import re
import subprocess
import sys

base = sys.argv[1].rstrip("/")
html = open(sys.argv[2], "r", encoding="utf-8", errors="ignore").read()
asset_paths = re.findall(r'(?:src|href)="(/assets/[^"]+\.(?:js|css))"', html)
if not asset_paths:
    raise SystemExit("No /assets/*.js|css references found in root page")

for path in asset_paths:
    cmd = [
        "curl",
        "--noproxy",
        "*",
        "-sS",
        "-o",
        "/dev/null",
        "-D",
        "-",
        f"{base}{path}",
    ]
    out = subprocess.check_output(cmd, text=True)
    status_line = next((line for line in out.splitlines() if line.startswith("HTTP/")), "")
    content_type = next((line for line in out.splitlines() if line.lower().startswith("content-type:")), "")
    if " 200 " not in status_line:
        raise SystemExit(f"Asset check failed for {path}: {status_line}")
    if "text/html" in content_type.lower():
        raise SystemExit(f"Asset check failed for {path}: unexpected content type {content_type}")
print(f"Asset checks passed for {len(asset_paths)} files")
PY

echo "[3/6] Check screener symbols (live)"
SYMBOLS_JSON="$TMP_DIR/symbols.json"
SYMBOLS_CODE="$(curl --noproxy '*' -sS -o "$SYMBOLS_JSON" -w '%{http_code}' "$BASE_URL/api/v1/screener/symbols?market=us&limit=20")"
if [[ "$SYMBOLS_CODE" != "200" ]]; then
  echo "Screener symbols failed: HTTP $SYMBOLS_CODE"
  cat "$SYMBOLS_JSON"
  exit 1
fi
python3 - "$SYMBOLS_JSON" <<'PY'
import json
import sys
j = json.load(open(sys.argv[1], "r", encoding="utf-8"))
meta = j.get("meta", {})
assert isinstance(j.get("data"), list) and len(j["data"]) > 0
assert meta.get("source") == "live"
assert meta.get("stale") is False
print("Screener symbols meta ok")
PY

echo "[4/6] Check screener run pagination"
RUN_JSON="$TMP_DIR/screener_run.json"
RUN_CODE="$(curl --noproxy '*' -sS -o "$RUN_JSON" -w '%{http_code}' -X POST "$BASE_URL/api/v1/screener/run" -H 'Content-Type: application/json' -d '{"market":"us","symbol_limit":500,"page":1,"page_size":50}')"
if [[ "$RUN_CODE" != "200" ]]; then
  echo "Screener run failed: HTTP $RUN_CODE"
  cat "$RUN_JSON"
  exit 1
fi
python3 - "$RUN_JSON" <<'PY'
import json
import sys
j = json.load(open(sys.argv[1], "r", encoding="utf-8"))
meta = j.get("meta", {})
assert meta.get("count", 0) <= 50
assert meta.get("total_items", 0) >= meta.get("count", 0)
assert meta.get("total_pages", 0) >= 1
assert meta.get("source") == "live"
assert meta.get("stale") is False
print("Screener run pagination/meta ok")
PY

echo "[5/6] Check factors and movers (live)"
FACTORS_JSON="$TMP_DIR/factors.json"
FACTORS_CODE="$(curl --noproxy '*' -sS -o "$FACTORS_JSON" -w '%{http_code}' -X POST "$BASE_URL/api/v1/factors/score" -H 'Content-Type: application/json' -d '{"weights":{"value":25,"growth":25,"momentum":25,"quality":25},"market":"us","symbol_limit":500,"page":1,"page_size":50}')"
if [[ "$FACTORS_CODE" != "200" ]]; then
  echo "Factors failed: HTTP $FACTORS_CODE"
  cat "$FACTORS_JSON"
  exit 1
fi
python3 - "$FACTORS_JSON" <<'PY'
import json
import sys
j = json.load(open(sys.argv[1], "r", encoding="utf-8"))
meta = j.get("meta", {})
assert meta.get("count", 0) <= 50
assert meta.get("source") == "live"
assert meta.get("stale") is False
print("Factors meta ok")
PY

MOVERS_JSON="$TMP_DIR/movers.json"
MOVERS_CODE="$(curl --noproxy '*' -sS -o "$MOVERS_JSON" -w '%{http_code}' "$BASE_URL/api/v1/market/top-movers?type=stock&limit=5")"
if [[ "$MOVERS_CODE" != "200" ]]; then
  echo "Top movers failed: HTTP $MOVERS_CODE"
  cat "$MOVERS_JSON"
  exit 1
fi
python3 - "$MOVERS_JSON" <<'PY'
import json
import sys
j = json.load(open(sys.argv[1], "r", encoding="utf-8"))
meta = j.get("meta", {})
assert meta.get("count") == len(j.get("data", []))
assert meta.get("source") == "live"
assert meta.get("stale") is False
print("Top movers meta ok")
PY

echo "[6/6] Check backtest run (live OHLCV)"
BACKTEST_JSON="$TMP_DIR/backtest.json"
BACKTEST_CODE="$(curl --noproxy '*' -sS -o "$BACKTEST_JSON" -w '%{http_code}' -X POST "$BASE_URL/api/v1/backtest/run" -H 'Content-Type: application/json' -d '{"symbol":"AAPL","asset_type":"stock","strategy_name":"ma_cross","parameters":{"fast":5,"slow":20},"start_date":"2024-01-01","end_date":"2024-12-31","initial_capital":1000000}')"
if [[ "$BACKTEST_CODE" != "200" ]]; then
  echo "Backtest run failed: HTTP $BACKTEST_CODE"
  cat "$BACKTEST_JSON"
  exit 1
fi
python3 - "$BACKTEST_JSON" <<'PY'
import json
import sys
j = json.load(open(sys.argv[1], "r", encoding="utf-8"))
meta = j.get("meta", {})
assert meta.get("ohlcv_source") == "live"
assert meta.get("stale") is False
assert isinstance(j.get("data"), dict)
print("Backtest run meta ok")
PY

echo "Smoke checks passed."
