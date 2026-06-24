#!/usr/bin/env bash
# ============================================================
# health-check.sh — Post-deploy health validation
# Usage: ./health-check.sh <URL> <MAX_RETRIES> <SLEEP_SECONDS>
# ============================================================

set -euo pipefail

URL="${1:-}"
MAX_RETRIES="${2:-30}"
SLEEP_SECONDS="${3:-5}"

if [ -z "$URL" ]; then
  echo "❌ Error: URL required"
  echo "Usage: $0 <URL> [MAX_RETRIES] [SLEEP_SECONDS]"
  exit 1
fi

echo "🔍 Health check: ${URL}"
echo "   Max retries: ${MAX_RETRIES} | Sleep: ${SLEEP_SECONDS}s"

attempt=0
while [ $attempt -lt "$MAX_RETRIES" ]; do
  attempt=$((attempt + 1))
  echo "   Attempt ${attempt}/${MAX_RETRIES}..."

  HTTP_STATUS=$(curl \
    --silent \
    --output /dev/null \
    --write-out "%{http_code}" \
    --max-time 10 \
    --connect-timeout 5 \
    "${URL}" || echo "000")

  if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Health check passed (HTTP ${HTTP_STATUS}) after ${attempt} attempt(s)"
    exit 0
  else
    echo "   ⚠️  Got HTTP ${HTTP_STATUS}, retrying in ${SLEEP_SECONDS}s..."
    sleep "$SLEEP_SECONDS"
  fi
done

echo "❌ Health check FAILED after ${MAX_RETRIES} attempts"
echo "   Last status: ${HTTP_STATUS}"
exit 1
