#!/usr/bin/env bash
# Deploy Mr Storage Backend to Render from this repo.
# Prereqs:
#   1. Render CLI installed (~/.local/bin/render or `brew install render`)
#   2. Authenticated: `render login`  OR  export RENDER_API_KEY=rnd_...
#   3. Latest code pushed to GitHub (Render builds from the remote repo)
#   4. Local .env present for non-Mongo secrets (JWT, SendGrid, AWS, etc.)
set -euo pipefail

export PATH="${HOME}/.local/bin:${PATH}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v render >/dev/null 2>&1; then
  echo "Render CLI not found. Install: brew install render"
  echo "Or download from https://github.com/render-oss/cli/releases"
  exit 1
fi

if ! render whoami >/dev/null 2>&1; then
  echo "Not logged in to Render."
  echo "Run: render login"
  echo "Or:  export RENDER_API_KEY=rnd_xxxxxxxx"
  exit 1
fi

# Prefer explicit MONGO_URI arg / env; fall back to the provided Atlas URL only if set externally.
MONGO_URI="${1:-${MONGO_URI:-}}"
if [[ -z "${MONGO_URI}" ]]; then
  echo "Usage: MONGO_URI='mongodb+srv://...' ./scripts/deploy-render.sh"
  echo "   or: ./scripts/deploy-render.sh 'mongodb+srv://...'"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env — needed for JWT / email / AWS secrets."
  exit 1
fi

get_env() {
  local key="$1"
  # shellcheck disable=SC1091
  set -a
  # Load .env without printing
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | sed 's/\r$//')
  set +a
  printf '%s' "${!key-}"
}

REPO_URL="$(git remote get-url origin)"
# Normalize to https for Render
if [[ "$REPO_URL" == git@github.com:* ]]; then
  REPO_URL="https://github.com/${REPO_URL#git@github.com:}"
  REPO_URL="${REPO_URL%.git}.git"
fi

SERVICE_NAME="${RENDER_SERVICE_NAME:-mr-storage-backend}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Creating/deploying Render web service: ${SERVICE_NAME}"
echo "Repo:   ${REPO_URL}"
echo "Branch: ${BRANCH}"

# Build --env-var flags from .env + provided MONGO_URI
ENV_FLAGS=(
  --env-var "NODE_ENV=production"
  --env-var "MONGO_URI=${MONGO_URI}"
)

for key in \
  JWT_ACCESS_SECRET JWT_REFRESH_SECRET JWT_RESET_SECRET \
  CLIENT_URL ANTHROPIC_API_KEY ANTHROPIC_MODEL \
  AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_S3_BUCKET \
  SENDGRID_API_KEY SENDGRID_FROM MAIL_FROM \
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS \
  INVOICE_COMPANY_NAME INVOICE_COMPANY_ADDRESS INVOICE_COMPANY_EMAIL \
  INVOICE_COMPANY_WEBSITE INVOICE_LOGO_URL
do
  val="$(get_env "$key")"
  if [[ -n "${val}" ]]; then
    ENV_FLAGS+=(--env-var "${key}=${val}")
  fi
done

# JWT_RESET_SECRET fallback
if [[ -z "$(get_env JWT_RESET_SECRET)" ]]; then
  ENV_FLAGS+=(--env-var "JWT_RESET_SECRET=$(get_env JWT_ACCESS_SECRET)")
fi

render services create \
  --name "${SERVICE_NAME}" \
  --type web_service \
  --runtime node \
  --plan free \
  --region oregon \
  --repo "${REPO_URL}" \
  --branch "${BRANCH}" \
  --build-command "npm install" \
  --start-command "npm start" \
  "${ENV_FLAGS[@]}" \
  --output text \
  --confirm

echo ""
echo "Done. Check status with: render services"
echo "Logs: render logs -r ${SERVICE_NAME} --tail"
