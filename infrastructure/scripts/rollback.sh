#!/usr/bin/env bash
# ============================================================
# rollback.sh — Roll back ECS service to previous task definition
# Usage: ./rollback.sh <CLUSTER> <SERVICE> [REVISION]
# ============================================================

set -euo pipefail

CLUSTER="${1:-}"
SERVICE="${2:-}"
REVISION="${3:-}"  # Optional: specific revision number

if [ -z "$CLUSTER" ] || [ -z "$SERVICE" ]; then
  echo "❌ Usage: $0 <CLUSTER_NAME> <SERVICE_NAME> [REVISION]"
  exit 1
fi

echo "🔄 Rolling back ECS service..."
echo "   Cluster: ${CLUSTER}"
echo "   Service: ${SERVICE}"

# Get current task definition family + revision
CURRENT_TASK_DEF=$(aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --query "services[0].taskDefinition" \
  --output text)

TASK_FAMILY=$(echo "$CURRENT_TASK_DEF" | cut -d':' -f6 | cut -d'/' -f2)
CURRENT_REV=$(echo "$CURRENT_TASK_DEF" | cut -d':' -f7)

echo "   Current task definition: ${TASK_FAMILY}:${CURRENT_REV}"

if [ -n "$REVISION" ]; then
  TARGET_REV="$REVISION"
else
  # Rollback to previous revision
  TARGET_REV=$((CURRENT_REV - 1))
fi

if [ "$TARGET_REV" -lt 1 ]; then
  echo "❌ Cannot rollback: target revision ${TARGET_REV} is invalid"
  exit 1
fi

TARGET_TASK_DEF="${TASK_FAMILY}:${TARGET_REV}"
echo "   Rolling back to: ${TARGET_TASK_DEF}"

# Update service to use previous task definition
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$TARGET_TASK_DEF" \
  --force-new-deployment \
  --no-cli-pager

echo "   ⏳ Waiting for service to stabilize..."
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE"

echo "✅ Rollback complete: ${SERVICE} now running ${TARGET_TASK_DEF}"
