#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SMOKE_EMAIL="${SMOKE_EMAIL:-smoketest.admin@example.com}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-SmokeTest#2026}"

echo "[1/5] health"
curl -s "${BASE_URL}/health"
echo
echo "---"

echo "[2/5] login"
LOGIN_RESPONSE="$(curl -s -X POST "${BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASSWORD}\"}")"
echo "${LOGIN_RESPONSE}"
echo
echo "---"

TOKEN="$(printf '%s' "${LOGIN_RESPONSE}" | node -e "const fs=require('fs'); const body=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(body.accessToken || '');")"

if [[ -z "${TOKEN}" ]]; then
  echo "login failed: no access token returned" >&2
  exit 1
fi

echo "[3/5] auth/me"
curl -s -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/auth/me"
echo
echo "---"

echo "[4/5] dashboard"
curl -s -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/dashboard/stats"
echo
echo "---"

echo "[5/5] create session"
curl -s -X POST "${BASE_URL}/checkin/session/start" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"academicYear":2026,"examRound":"MORNING","name":"Smoke Test Session"}'
echo