#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
TMP_DIR="$(mktemp -d)"
ROOT_HTML="$TMP_DIR/root.html"
ROOT_HEADERS="$TMP_DIR/root.headers"
read -r START_1Y START_3Y TODAY <<EOF
$(python3 - <<'PY'
from datetime import datetime

def years_ago(d, years):
    try:
        return d.replace(year=d.year - years)
    except ValueError:
        return d.replace(year=d.year - years, month=2, day=28)

today = datetime.utcnow().date()
print(
    years_ago(today, 1).isoformat(),
    years_ago(today, 3).isoformat(),
    today.isoformat(),
)
PY
)
EOF

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

curl_with_retry() {
  local output_file="$1"
  shift

  local attempts="${CURL_RETRY_ATTEMPTS:-3}"
  local delay_seconds="${CURL_RETRY_DELAY_SECONDS:-2}"
  local attempt=1
  local code="000"
  local curl_status=0

  while (( attempt <= attempts )); do
    set +e
    code="$(curl --noproxy '*' -sS -o "$output_file" -w '%{http_code}' "$@")"
    curl_status=$?
    set -e
    if [[ "$curl_status" -ne 0 ]]; then
      code="000"
    fi
    if [[ "$code" == "200" ]]; then
      echo "$code"
      return 0
    fi
    if [[ "$attempt" -lt "$attempts" && "$code" =~ ^(429|5[0-9][0-9]|000)$ ]]; then
      sleep "$delay_seconds"
      attempt=$((attempt + 1))
      continue
    fi
    echo "$code"
    return 0
  done

  echo "$code"
}

echo "[1/7] Check root page"
ROOT_CODE="$(curl_with_retry "$ROOT_HTML" -L -D "$ROOT_HEADERS" "$BASE_URL/")"
if [[ "$ROOT_CODE" != "200" ]]; then
  echo "Root page check failed: HTTP $ROOT_CODE"
  exit 1
fi

echo "[2/7] Check asset bundles"
python3 - "$BASE_URL" "$ROOT_HTML" <<'PY'
import re
import subprocess
import sys

base = sys.argv[1].rstrip("/")
html = open(sys.argv[2], "r", encoding="utf-8", errors="ignore").read()
asset_paths = re.findall(r'(?:src|href)="(/assets/[^"]+\.(?:js|css))"', html)
if not asset_paths:
    raise SystemExit("No /assets bundle references found")

for path in asset_paths:
    out = subprocess.check_output(
        ["curl", "--noproxy", "*", "-sS", "-o", "/dev/null", "-D", "-", f"{base}{path}"],
        text=True,
    )
    status_line = next((line for line in out.splitlines() if line.startswith("HTTP/")), "")
    content_type = next((line for line in out.splitlines() if line.lower().startswith("content-type:")), "")
    if " 200 " not in status_line:
        raise SystemExit(f"Asset check failed for {path}: {status_line}")
    if "text/html" in content_type.lower():
        raise SystemExit(f"Asset check failed for {path}: unexpected content type {content_type}")
print(f"Asset checks passed for {len(asset_paths)} files")
PY

echo "[3/7] Check market search and movers"
SEARCH_JSON="$TMP_DIR/search.json"
SEARCH_CODE="$(curl_with_retry "$SEARCH_JSON" "$BASE_URL/api/v1/market/search?q=AAPL&type=stock&limit=5")"
if [[ "$SEARCH_CODE" != "200" ]]; then
  echo "Market search failed: HTTP $SEARCH_CODE"
  cat "$SEARCH_JSON"
  exit 1
fi
MOVERS_JSON="$TMP_DIR/movers.json"
MOVERS_CODE="$(curl_with_retry "$MOVERS_JSON" "$BASE_URL/api/v1/market/top-movers?type=stock&limit=5")"
if [[ "$MOVERS_CODE" != "200" ]]; then
  echo "Top movers failed: HTTP $MOVERS_CODE"
  cat "$MOVERS_JSON"
  exit 1
fi
python3 - "$SEARCH_JSON" "$MOVERS_JSON" <<'PY'
import json
import sys

search = json.load(open(sys.argv[1], "r", encoding="utf-8"))
movers = json.load(open(sys.argv[2], "r", encoding="utf-8"))
assert isinstance(search.get("data"), list) and len(search["data"]) > 0
assert movers.get("meta", {}).get("count") == len(movers.get("data", []))
print("Market search and movers ok")
PY

echo "[4/7] Check quote, kline and local history status"
QUOTE_JSON="$TMP_DIR/quote.json"
QUOTE_CODE="$(curl_with_retry "$QUOTE_JSON" "$BASE_URL/api/v1/market/AAPL/quote")"
if [[ "$QUOTE_CODE" != "200" ]]; then
  echo "Quote failed: HTTP $QUOTE_CODE"
  cat "$QUOTE_JSON"
  exit 1
fi
KLINE_JSON="$TMP_DIR/kline.json"
KLINE_CODE="$(curl_with_retry "$KLINE_JSON" "$BASE_URL/api/v1/market/AAPL/kline?period=1d&start=$START_3Y&end=$TODAY")"
if [[ "$KLINE_CODE" != "200" ]]; then
  echo "Kline failed: HTTP $KLINE_CODE"
  cat "$KLINE_JSON"
  exit 1
fi
STATUS_JSON="$TMP_DIR/status.json"
STATUS_CODE="$(curl_with_retry "$STATUS_JSON" "$BASE_URL/api/v1/market/AAPL/history-status")"
if [[ "$STATUS_CODE" != "200" ]]; then
  echo "History status failed: HTTP $STATUS_CODE"
  cat "$STATUS_JSON"
  exit 1
fi
python3 - "$QUOTE_JSON" "$KLINE_JSON" "$STATUS_JSON" <<'PY'
import json
import sys

quote = json.load(open(sys.argv[1], "r", encoding="utf-8"))
kline = json.load(open(sys.argv[2], "r", encoding="utf-8"))
status = json.load(open(sys.argv[3], "r", encoding="utf-8"))
assert quote.get("data", {}).get("asset_type") == "stock"
assert float(quote.get("data", {}).get("price", 0)) > 0
assert isinstance(kline.get("data"), list) and len(kline.get("data")) > 100
assert status.get("data", {}).get("symbol") == "AAPL"
print("Quote/Kline/history status ok")
PY

echo "[5/7] Check explicit history sync"
SYNC_JSON="$TMP_DIR/sync.json"
SYNC_CODE="$(curl_with_retry "$SYNC_JSON" -X POST "$BASE_URL/api/v1/market/AAPL/sync" -H 'Content-Type: application/json' -d "{\"start_date\":\"$START_1Y\",\"end_date\":\"$TODAY\",\"period\":\"1d\"}")"
if [[ "$SYNC_CODE" != "200" ]]; then
  echo "History sync failed: HTTP $SYNC_CODE"
  cat "$SYNC_JSON"
  exit 1
fi
python3 - "$SYNC_JSON" <<'PY'
import json
import sys

sync = json.load(open(sys.argv[1], "r", encoding="utf-8"))
assert sync.get("data", {}).get("rows_synced", 0) > 0
assert sync.get("data", {}).get("local_rows", 0) > 0
print("History sync ok")
PY

echo "[6/7] Check backtest local-first behavior after sync"
BACKTEST_JSON="$TMP_DIR/backtest.json"
BACKTEST_CODE="$(curl_with_retry "$BACKTEST_JSON" -X POST "$BASE_URL/api/v1/backtest/run" -H 'Content-Type: application/json' -d "{\"symbol\":\"AAPL\",\"asset_type\":\"stock\",\"strategy_name\":\"ma_cross\",\"parameters\":{\"fast\":5,\"slow\":20},\"start_date\":\"$START_1Y\",\"end_date\":\"$TODAY\",\"initial_capital\":1000000,\"sync_if_missing\":false}")"
if [[ "$BACKTEST_CODE" != "200" ]]; then
  echo "Backtest failed: HTTP $BACKTEST_CODE"
  cat "$BACKTEST_JSON"
  exit 1
fi
python3 - "$BACKTEST_JSON" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], "r", encoding="utf-8"))
meta = result.get("meta", {})
assert meta.get("storage_source") == "local"
assert meta.get("sync_performed") is False
assert meta.get("coverage_complete") is True
assert isinstance(result.get("data", {}).get("equity_curve"), list)
print("Backtest local-first flow ok")
PY

echo "[7/7] Check runtime observability"
OBS_JSON="$TMP_DIR/observability.json"
OBS_CODE="$(curl_with_retry "$OBS_JSON" "$BASE_URL/api/v1/system/observability")"
if [[ "$OBS_CODE" != "200" ]]; then
  echo "Observability failed: HTTP $OBS_CODE"
  cat "$OBS_JSON"
  exit 1
fi
python3 - "$OBS_JSON" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
data = payload.get("data", {})
http = data.get("http", {})
routes = http.get("routes", [])
market = data.get("market", {})
assert int(http.get("total_requests", 0)) > 0
assert int(http.get("slow_request_threshold_ms", 0)) > 0
assert isinstance(data.get("counters"), dict)
assert isinstance(market.get("quotes", {}), dict)
assert "crypto" in market.get("quotes", {})
assert any(item.get("path") == "/api/v1/market/{symbol}/quote" for item in routes)
print("Observability ok")
PY

CACHE_JSON="$TMP_DIR/cache_maintenance.json"
CACHE_CODE="$(curl_with_retry "$CACHE_JSON" "$BASE_URL/api/v1/system/cache-maintenance")"
if [[ "$CACHE_CODE" != "200" ]]; then
  echo "Cache maintenance failed: HTTP $CACHE_CODE"
  cat "$CACHE_JSON"
  exit 1
fi
python3 - "$CACHE_JSON" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
data = payload.get("data", {})
snapshot = data.get("market_snapshot_daily", {})
backtest = data.get("backtest_cache", {})
assert "total_rows" in snapshot
assert "purgeable_rows" in snapshot
assert "expired_rows" in backtest
print("Cache maintenance ok")
PY

echo "Runtime smoke passed."
