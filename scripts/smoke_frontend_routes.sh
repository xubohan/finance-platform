#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1}"
TMP_DIR="$(mktemp -d)"

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
    if [[ "$code" == "200" || "$code" == "301" || "$code" == "302" ]]; then
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

echo "[1/2] Check main market route"
html_file="$TMP_DIR/market.html"
code="$(curl_with_retry "$html_file" "$BASE_URL/market")"
if [[ "$code" != "200" ]]; then
  echo "Route /market failed: HTTP $code"
  cat "$html_file"
  exit 1
fi

python3 - "$html_file" <<'PY'
import sys

with open(sys.argv[1], "r", encoding="utf-8", errors="ignore") as fh:
    html = fh.read()

assert 'id="root"' in html
assert "/assets/" in html
print("/market ok")
PY

echo "[2/2] Check legacy routes redirect or render the app shell"
legacy_routes=(chart screener factors backtest ai)

for route in "${legacy_routes[@]}"; do
  html_file="$TMP_DIR/${route}.html"
  headers_file="$TMP_DIR/${route}.headers"
  code="$(curl_with_retry "$html_file" -D "$headers_file" "$BASE_URL/$route")"
  if [[ "$code" != "200" && "$code" != "301" && "$code" != "302" ]]; then
    echo "Legacy route /$route failed: HTTP $code"
    cat "$html_file"
    exit 1
  fi

  python3 - "$headers_file" "$html_file" "$route" <<'PY'
import sys

headers = open(sys.argv[1], "r", encoding="utf-8", errors="ignore").read().lower()
html = open(sys.argv[2], "r", encoding="utf-8", errors="ignore").read()
route = sys.argv[3]

if "location:" in headers:
    assert "/market" in headers, f"/{route}: expected redirect to /market"
else:
    assert 'id="root"' in html, f"/{route}: root node missing"
print(f"/{route} legacy route ok")
PY
done

echo "Frontend route smoke passed."
