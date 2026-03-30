#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
TMP_DIR="$(mktemp -d)"
ROOT_HTML="$TMP_DIR/root.html"
ROOT_HEADERS="$TMP_DIR/root.headers"
WATCHLIST_SYMBOL="SMOKE_AAPL"
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
    if [[ "$code" == "200" || "$code" == "202" ]]; then
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

echo "[1/9] Check root page"
ROOT_CODE="$(curl_with_retry "$ROOT_HTML" -L -D "$ROOT_HEADERS" "$BASE_URL/")"
if [[ "$ROOT_CODE" != "200" ]]; then
  echo "Root page check failed: HTTP $ROOT_CODE"
  exit 1
fi

echo "[2/9] Check asset bundles"
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

echo "[3/9] Check v2 system health and observability surface"
HEALTH_JSON="$TMP_DIR/system_health.json"
HEALTH_CODE="$(curl_with_retry "$HEALTH_JSON" "$BASE_URL/api/v2/system/health")"
if [[ "$HEALTH_CODE" != "200" ]]; then
  echo "System health failed: HTTP $HEALTH_CODE"
  cat "$HEALTH_JSON"
  exit 1
fi
OBS_JSON="$TMP_DIR/observability.json"
OBS_CODE="$(curl_with_retry "$OBS_JSON" "$BASE_URL/api/v2/system/observability")"
if [[ "$OBS_CODE" != "200" ]]; then
  echo "Observability failed: HTTP $OBS_CODE"
  cat "$OBS_JSON"
  exit 1
fi
CACHE_JSON="$TMP_DIR/cache_maintenance.json"
CACHE_CODE="$(curl_with_retry "$CACHE_JSON" "$BASE_URL/api/v2/system/cache-maintenance")"
if [[ "$CACHE_CODE" != "200" ]]; then
  echo "Cache maintenance failed: HTTP $CACHE_CODE"
  cat "$CACHE_JSON"
  exit 1
fi
python3 - "$HEALTH_JSON" "$OBS_JSON" "$CACHE_JSON" <<'PY'
import json
import sys

health = json.load(open(sys.argv[1], "r", encoding="utf-8"))
obs = json.load(open(sys.argv[2], "r", encoding="utf-8"))
cache = json.load(open(sys.argv[3], "r", encoding="utf-8"))

assert health.get("status") == "ok"
assert health.get("version") == "v2"
assert isinstance(health.get("features"), dict)
assert isinstance(obs.get("data"), dict)
assert "generated_at" in cache.get("meta", {})
print("system v2 checks ok")
PY

echo "[4/9] Check v2 market search, movers, quote and kline"
SEARCH_JSON="$TMP_DIR/search.json"
SEARCH_CODE="$(curl_with_retry "$SEARCH_JSON" "$BASE_URL/api/v2/market/search?q=AAPL&type=stock&market=us&limit=5")"
if [[ "$SEARCH_CODE" != "200" ]]; then
  echo "Market search failed: HTTP $SEARCH_CODE"
  cat "$SEARCH_JSON"
  exit 1
fi
MOVERS_JSON="$TMP_DIR/movers.json"
MOVERS_CODE="$(curl_with_retry "$MOVERS_JSON" "$BASE_URL/api/v2/market/movers?market=us&direction=gain&limit=5")"
if [[ "$MOVERS_CODE" != "200" ]]; then
  echo "Movers failed: HTTP $MOVERS_CODE"
  cat "$MOVERS_JSON"
  exit 1
fi
QUOTE_JSON="$TMP_DIR/quote.json"
QUOTE_CODE="$(curl_with_retry "$QUOTE_JSON" "$BASE_URL/api/v2/market/AAPL/quote")"
if [[ "$QUOTE_CODE" != "200" ]]; then
  echo "Quote failed: HTTP $QUOTE_CODE"
  cat "$QUOTE_JSON"
  exit 1
fi
KLINE_JSON="$TMP_DIR/kline.json"
KLINE_CODE="$(curl_with_retry "$KLINE_JSON" "$BASE_URL/api/v2/market/AAPL/kline?period=1d&start=$START_3Y&end=$TODAY")"
if [[ "$KLINE_CODE" != "200" ]]; then
  echo "Kline failed: HTTP $KLINE_CODE"
  cat "$KLINE_JSON"
  exit 1
fi
python3 - "$SEARCH_JSON" "$MOVERS_JSON" "$QUOTE_JSON" "$KLINE_JSON" <<'PY'
import json
import sys

search = json.load(open(sys.argv[1], "r", encoding="utf-8"))
movers = json.load(open(sys.argv[2], "r", encoding="utf-8"))
quote = json.load(open(sys.argv[3], "r", encoding="utf-8"))
kline = json.load(open(sys.argv[4], "r", encoding="utf-8"))
allowed_market_sources = {"live", "delayed", "eod"}

assert isinstance(search.get("data"), list)
assert search.get("meta", {}).get("source") == "live"
assert movers.get("meta", {}).get("count") == len(movers.get("data", []))
assert movers.get("meta", {}).get("source") == "live"
assert not bool(movers.get("meta", {}).get("stale"))
assert quote.get("data", {}).get("symbol") == "AAPL"
assert quote.get("meta", {}).get("source") in allowed_market_sources
assert str(quote.get("meta", {}).get("fetch_source") or "").startswith("persisted") is False
assert isinstance(kline.get("data"), list)
assert kline.get("meta", {}).get("source") in allowed_market_sources
assert str(kline.get("meta", {}).get("fetch_source") or "").startswith("persisted") is False
print("market v2 checks ok")
PY

echo "[5/9] Check v2 history status and explicit sync"
STATUS_JSON="$TMP_DIR/history_status.json"
STATUS_CODE="$(curl_with_retry "$STATUS_JSON" "$BASE_URL/api/v2/market/AAPL/history-status")"
if [[ "$STATUS_CODE" != "200" ]]; then
  echo "History status failed: HTTP $STATUS_CODE"
  cat "$STATUS_JSON"
  exit 1
fi
SYNC_JSON="$TMP_DIR/history_sync.json"
SYNC_CODE="$(curl_with_retry "$SYNC_JSON" -X POST "$BASE_URL/api/v2/market/AAPL/sync" -H 'Content-Type: application/json' -d "{\"start_date\":\"$START_1Y\",\"end_date\":\"$TODAY\",\"period\":\"1d\"}")"
if [[ "$SYNC_CODE" != "200" ]]; then
  echo "History sync failed: HTTP $SYNC_CODE"
  cat "$SYNC_JSON"
  exit 1
fi
python3 - "$STATUS_JSON" "$SYNC_JSON" <<'PY'
import json
import sys

status = json.load(open(sys.argv[1], "r", encoding="utf-8"))
sync = json.load(open(sys.argv[2], "r", encoding="utf-8"))
allowed_market_sources = {"live", "delayed", "eod"}
assert status.get("data", {}).get("symbol") == "AAPL"
assert sync.get("data", {}).get("symbol") == "AAPL"
assert sync.get("data", {}).get("local_rows", 0) >= 0
assert sync.get("meta", {}).get("source") in allowed_market_sources
assert str(sync.get("meta", {}).get("fetch_source") or "").startswith("persisted") is False
print("market sync checks ok")
PY

echo "[6/9] Check v2 news/events/analysis"
NEWS_JSON="$TMP_DIR/news_feed.json"
NEWS_CODE="$(curl_with_retry "$NEWS_JSON" "$BASE_URL/api/v2/news/feed?market=all&page=1&page_size=5")"
if [[ "$NEWS_CODE" != "200" ]]; then
  echo "News feed failed: HTTP $NEWS_CODE"
  cat "$NEWS_JSON"
  exit 1
fi
EVENTS_JSON="$TMP_DIR/events_calendar.json"
EVENTS_CODE="$(curl_with_retry "$EVENTS_JSON" "$BASE_URL/api/v2/events/calendar?start=$START_1Y&end=$TODAY&market=us")"
if [[ "$EVENTS_CODE" != "200" ]]; then
  echo "Events calendar failed: HTTP $EVENTS_CODE"
  cat "$EVENTS_JSON"
  exit 1
fi
SENTIMENT_JSON="$TMP_DIR/sentiment.json"
SENTIMENT_CODE="$(curl_with_retry "$SENTIMENT_JSON" -X POST "$BASE_URL/api/v2/analysis/sentiment" -H 'Content-Type: application/json' -d '{"text":"Fed keeps rates unchanged and guides two cuts this year.","context_symbols":["SPY"]}')"
if [[ "$SENTIMENT_CODE" != "200" ]]; then
  echo "Analysis sentiment failed: HTTP $SENTIMENT_CODE"
  cat "$SENTIMENT_JSON"
  exit 1
fi
python3 - "$NEWS_JSON" "$EVENTS_JSON" "$SENTIMENT_JSON" <<'PY'
import json
import sys

news = json.load(open(sys.argv[1], "r", encoding="utf-8"))
events = json.load(open(sys.argv[2], "r", encoding="utf-8"))
sentiment = json.load(open(sys.argv[3], "r", encoding="utf-8"))

assert isinstance(news.get("data"), list)
assert isinstance(news.get("meta"), dict)
assert isinstance(events.get("data"), list)
assert sentiment.get("data", {}).get("sentiment_label") in {"positive", "neutral", "negative"}
print("news/events/analysis checks ok")
PY

echo "[7/9] Check v2 watchlist CRUD and quote aggregation"
WATCHLIST_ADD_JSON="$TMP_DIR/watchlist_add.json"
WATCHLIST_ADD_CODE="$(curl_with_retry "$WATCHLIST_ADD_JSON" -X POST "$BASE_URL/api/v2/watchlist" -H 'Content-Type: application/json' -d "{\"symbol\":\"$WATCHLIST_SYMBOL\",\"asset_type\":\"stock\"}")"
if [[ "$WATCHLIST_ADD_CODE" != "200" ]]; then
  echo "Watchlist add failed: HTTP $WATCHLIST_ADD_CODE"
  cat "$WATCHLIST_ADD_JSON"
  exit 1
fi
WATCHLIST_QUOTES_JSON="$TMP_DIR/watchlist_quotes.json"
WATCHLIST_QUOTES_CODE="$(curl_with_retry "$WATCHLIST_QUOTES_JSON" "$BASE_URL/api/v2/watchlist/quotes")"
if [[ "$WATCHLIST_QUOTES_CODE" != "200" ]]; then
  echo "Watchlist quotes failed: HTTP $WATCHLIST_QUOTES_CODE"
  cat "$WATCHLIST_QUOTES_JSON"
  exit 1
fi
WATCHLIST_DELETE_JSON="$TMP_DIR/watchlist_delete.json"
WATCHLIST_DELETE_CODE="$(curl_with_retry "$WATCHLIST_DELETE_JSON" -X DELETE "$BASE_URL/api/v2/watchlist/$WATCHLIST_SYMBOL?asset_type=stock")"
if [[ "$WATCHLIST_DELETE_CODE" != "200" ]]; then
  echo "Watchlist delete failed: HTTP $WATCHLIST_DELETE_CODE"
  cat "$WATCHLIST_DELETE_JSON"
  exit 1
fi
python3 - "$WATCHLIST_ADD_JSON" "$WATCHLIST_QUOTES_JSON" "$WATCHLIST_DELETE_JSON" "$WATCHLIST_SYMBOL" <<'PY'
import json
import sys

added = json.load(open(sys.argv[1], "r", encoding="utf-8"))
quotes = json.load(open(sys.argv[2], "r", encoding="utf-8"))
deleted = json.load(open(sys.argv[3], "r", encoding="utf-8"))
symbol = sys.argv[4]

assert added.get("data", {}).get("symbol") == symbol
assert isinstance(quotes.get("data"), list)
for row in quotes.get("data", []):
    if row.get("error"):
        continue
    assert row.get("source") in {"live", "delayed", "eod"}
assert deleted.get("meta", {}).get("count", 0) >= 1
print("watchlist checks ok")
PY

echo "[8/10] Check v2 screener"
SCREENER_SYMBOLS_JSON="$TMP_DIR/screener_symbols.json"
SCREENER_SYMBOLS_CODE="$(curl_with_retry "$SCREENER_SYMBOLS_JSON" "$BASE_URL/api/v2/screener/symbols?market=us&limit=20")"
if [[ "$SCREENER_SYMBOLS_CODE" != "200" ]]; then
  echo "Screener symbols failed: HTTP $SCREENER_SYMBOLS_CODE"
  cat "$SCREENER_SYMBOLS_JSON"
  exit 1
fi
SCREENER_RUN_JSON="$TMP_DIR/screener_run.json"
SCREENER_RUN_CODE="$(curl_with_retry "$SCREENER_RUN_JSON" -X POST "$BASE_URL/api/v2/screener/run" -H 'Content-Type: application/json' -d '{"market":"us","symbol_limit":100,"page":1,"page_size":50,"force_refresh":true,"allow_stale":false,"min_roe":0.05}')"
if [[ "$SCREENER_RUN_CODE" != "200" ]]; then
  echo "Screener run failed: HTTP $SCREENER_RUN_CODE"
  cat "$SCREENER_RUN_JSON"
  exit 1
fi
python3 - "$SCREENER_SYMBOLS_JSON" "$SCREENER_RUN_JSON" <<'PY'
import json
import sys

symbols = json.load(open(sys.argv[1], "r", encoding="utf-8"))
run = json.load(open(sys.argv[2], "r", encoding="utf-8"))
assert isinstance(symbols.get("data"), list)
assert isinstance(run.get("data"), list)
assert run.get("meta", {}).get("market") == "us"
print("screener v2 checks ok")
PY

echo "[9/10] Check v2 backtest run"
BACKTEST_JSON="$TMP_DIR/backtest.json"
BACKTEST_CODE="$(curl_with_retry "$BACKTEST_JSON" -X POST "$BASE_URL/api/v2/backtest/run" -H 'Content-Type: application/json' -d "{\"symbol\":\"AAPL\",\"asset_type\":\"stock\",\"strategy_name\":\"ma_cross\",\"parameters\":{\"fast\":5,\"slow\":20},\"start_date\":\"$START_1Y\",\"end_date\":\"$TODAY\",\"initial_capital\":1000000,\"sync_if_missing\":true}")"
if [[ "$BACKTEST_CODE" != "200" ]]; then
  echo "Backtest failed: HTTP $BACKTEST_CODE"
  cat "$BACKTEST_JSON"
  exit 1
fi
python3 - "$BACKTEST_JSON" <<'PY'
import json
import sys

result = json.load(open(sys.argv[1], "r", encoding="utf-8"))
allowed_market_sources = {"live", "delayed", "eod"}
assert isinstance(result.get("data", {}).get("equity_curve"), list)
assert isinstance(result.get("meta"), dict)
assert result.get("meta", {}).get("ohlcv_source") in allowed_market_sources
assert result.get("meta", {}).get("storage_source") in allowed_market_sources
assert str(result.get("meta", {}).get("fetch_source") or "").startswith("persisted") is False
print("backtest v2 check ok")
PY

echo "[10/10] Check v2 deprecated predecessor headers on v1 bridge"
V1_HEALTH_HEADERS="$TMP_DIR/v1_health.headers"
V1_HEALTH_BODY="$TMP_DIR/v1_health.json"
V1_HEALTH_CODE="$(curl --noproxy '*' -sS -o "$V1_HEALTH_BODY" -D "$V1_HEALTH_HEADERS" -w '%{http_code}' "$BASE_URL/api/v1/health")"
if [[ "$V1_HEALTH_CODE" != "200" ]]; then
  echo "v1 compatibility check failed: HTTP $V1_HEALTH_CODE"
  cat "$V1_HEALTH_BODY"
  exit 1
fi
python3 - "$V1_HEALTH_HEADERS" <<'PY'
import sys

headers = open(sys.argv[1], "r", encoding="utf-8", errors="ignore").read().lower()
assert "deprecation: true" in headers
assert "link:" in headers and "/api/v2" in headers
print("v1 bridge headers ok")
PY

echo "Runtime smoke passed."
