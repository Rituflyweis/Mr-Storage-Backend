#!/usr/bin/env bash
# Push tax/Avalara env vars from local .env to Render (mr-storage-backend).
# Does NOT replace unrelated Render env vars (uses per-key PUT).
#
# Prereqs:
#   export RENDER_API_KEY=rnd_...   (Dashboard → Account Settings → API Keys)
#   or add RENDER_API_KEY= to .env (gitignored)
#
# Usage:
#   ./scripts/sync-render-tax-env.sh
#   RENDER_SERVICE_NAME=my-service ./scripts/sync-render-tax-env.sh
#   ./scripts/sync-render-tax-env.sh --deploy   # trigger redeploy after sync
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEPLOY_AFTER=false
for arg in "$@"; do
  if [[ "$arg" == "--deploy" ]]; then DEPLOY_AFTER=true; fi
done

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | sed 's/\r$//')
  set +a
fi

API_KEY="${RENDER_API_KEY:-}"
if [[ -z "$API_KEY" ]]; then
  echo "Missing RENDER_API_KEY."
  echo "Create one at https://dashboard.render.com/u/settings#api-keys"
  echo "Then: export RENDER_API_KEY=rnd_... && $0"
  exit 1
fi

SERVICE_NAME="${RENDER_SERVICE_NAME:-mr-storage-backend}"

TAX_KEYS=(
  TAX_ENGINE
  TAX_BLOCK_ON_TAX_FAILURE
  AVATAX_ACCOUNT_ID
  AVATAX_LICENSE_KEY
  AVATAX_COMPANY_CODE
  AVATAX_ENV
  AVATAX_SHIP_FROM_LINE1
  AVATAX_SHIP_FROM_CITY
  AVATAX_SHIP_FROM_STATE
  AVATAX_SHIP_FROM_POSTAL
  AVATAX_SHIP_FROM_COUNTRY
  AVALARA_ACCOUNT_ID
  AVALARA_LICENSE_KEY
  AVALARA_COMPANY_CODE
  AVALARA_COMPANY_ID
  AVALARA_ENV
  AVALARA_BASE_URL
  AVALARA_RETURNS_CLIENT_ID
  AVALARA_RETURNS_CLIENT_SECRET
  AVALARA_RETURNS_API_URL
  AVALARA_AUTH_URL
)

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "https://api.render.com/v1${path}" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "https://api.render.com/v1${path}" \
      -H "Authorization: Bearer ${API_KEY}" \
      -H "Accept: application/json"
  fi
}

echo "Resolving Render service: ${SERVICE_NAME}..."
SERVICES_JSON="$(api GET "/services?limit=100")"
SERVICE_ID="$(node -e "
const name = process.argv[1];
const raw = process.argv[2];
let data;
try { data = JSON.parse(raw); } catch { process.exit(2); }
const rows = Array.isArray(data) ? data : [];
for (const row of rows) {
  const svc = row.service || row;
  if ((svc.name || svc.slug) === name) {
    console.log(svc.id || row.id);
    process.exit(0);
  }
}
process.exit(1);
" "$SERVICE_NAME" "$SERVICES_JSON")" || {
  echo "Service not found. Set RENDER_SERVICE_ID or RENDER_SERVICE_NAME."
  exit 1
}

echo "Service id: ${SERVICE_ID}"

UPDATED=0
SKIPPED=0
for key in "${TAX_KEYS[@]}"; do
  val="${!key-}"
  if [[ -z "$val" ]]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  payload="$(node -e "console.log(JSON.stringify({ value: process.argv[1] }))" "$val")"
  resp="$(api PUT "/services/${SERVICE_ID}/env-vars/${key}" "$payload")"
  if echo "$resp" | grep -q '"message"'; then
    if echo "$resp" | grep -qi 'unauthorized\|forbidden'; then
      echo "Render API auth failed: $resp"
      exit 1
    fi
  fi
  echo "  ✓ ${key}"
  UPDATED=$((UPDATED + 1))
done

echo "Updated ${UPDATED} key(s); skipped ${SKIPPED} unset locally."

if [[ "$DEPLOY_AFTER" == true ]]; then
  echo "Triggering deploy..."
  api POST "/services/${SERVICE_ID}/deploys" '{"clearCache":"do_not_clear"}' >/dev/null
  echo "Deploy triggered."
else
  echo "Note: Render applies env changes on next deploy. Re-run with --deploy or redeploy from dashboard."
fi
