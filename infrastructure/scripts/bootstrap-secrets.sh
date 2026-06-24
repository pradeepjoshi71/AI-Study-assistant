#!/usr/bin/env bash
# ============================================================
# bootstrap-secrets.sh — Initialize AWS Secrets Manager secrets
# Run ONCE manually before first Terraform apply
# Usage: ./bootstrap-secrets.sh <ENVIRONMENT>
# ============================================================

set -euo pipefail

ENVIRONMENT="${1:-staging}"
REGION="ap-south-1"
NAME_PREFIX="ai-study-assistant-${ENVIRONMENT}"

echo "🔐 Bootstrapping secrets for: ${NAME_PREFIX}"
echo "   Region: ${REGION}"
echo ""

# Helper to create or update a secret
upsert_secret() {
  local SECRET_NAME="$1"
  local SECRET_VALUE="$2"
  local DESCRIPTION="$3"

  if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" &>/dev/null; then
    echo "   ↻ Updating secret: ${SECRET_NAME}"
    aws secretsmanager put-secret-value \
      --secret-id "$SECRET_NAME" \
      --secret-string "$SECRET_VALUE" \
      --region "$REGION" \
      --no-cli-pager
  else
    echo "   + Creating secret: ${SECRET_NAME}"
    aws secretsmanager create-secret \
      --name "$SECRET_NAME" \
      --description "$DESCRIPTION" \
      --secret-string "$SECRET_VALUE" \
      --region "$REGION" \
      --no-cli-pager
  fi
}

# ── GEMINI API KEY ────────────────────────────────────────
read -rsp "Enter GEMINI_API_KEY: " GEMINI_KEY
echo ""
upsert_secret \
  "${NAME_PREFIX}/gemini/api-key" \
  "$GEMINI_KEY" \
  "Google Gemini API key for ${ENVIRONMENT}"

# ── JWT SECRET ────────────────────────────────────────────
JWT_SECRET=$(openssl rand -hex 64)
echo "   Generated JWT_SECRET (length: ${#JWT_SECRET})"
upsert_secret \
  "${NAME_PREFIX}/jwt/secret" \
  "$JWT_SECRET" \
  "JWT signing secret for ${ENVIRONMENT} NestJS API"

# ── DATABASE PASSWORD ─────────────────────────────────────
read -rsp "Enter RDS database password: " DB_PASS
echo ""
upsert_secret \
  "${NAME_PREFIX}/db/password" \
  "$DB_PASS" \
  "RDS PostgreSQL master password for ${ENVIRONMENT}"

echo ""
echo "✅ All secrets bootstrapped successfully!"
echo ""
echo "Secret ARNs (copy these into your Terraform tfvars):"
for SECRET in "gemini/api-key" "jwt/secret" "db/password"; do
  ARN=$(aws secretsmanager describe-secret \
    --secret-id "${NAME_PREFIX}/${SECRET}" \
    --query ARN \
    --output text \
    --region "$REGION")
  echo "   ${NAME_PREFIX}/${SECRET}: ${ARN}"
done
