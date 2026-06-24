# ============================================================
# DISASTER RECOVERY RUNBOOK — Phase 4.0
# AI Study Platform · Global Multi-Region Deployment
# RTO: < 5 minutes | RPO: < 1 minute
# ============================================================

## Overview

This runbook governs all disaster recovery procedures for the AI Study Platform.
The system runs active-active across **3 AWS regions** (us-east-1, eu-west-1, ap-south-1).

### Severity Definitions

| Level | Definition | RTO | Response Team |
|-------|-----------|-----|---------------|
| P0 — Critical | Full region outage, data loss risk | < 5 min | On-call SRE + CTO |
| P1 — High | Partial outage, > 10% error rate | < 15 min | On-call SRE |
| P2 — Medium | Degraded performance, SLO at risk | < 30 min | Engineering team |
| P3 — Low | Minor anomaly, no user impact | < 2 hours | Business hours team |

---

## 1. Region Failover Procedure (P0)

### Scenario: Complete AWS Region Failure (e.g., us-east-1 outage)

**Trigger**: Route53 health check for region fails 3 consecutive checks (30 seconds).

### Automatic (happens without human intervention):
1. **Route53** stops routing traffic to failed region via latency-based failover
2. **AWS Global Accelerator** removes unhealthy endpoint from anycast pool
3. **Aurora Global Database** can be promoted manually (RTO adds ~5 min if auto-failover not enabled)
4. **ElastiCache Global** automatically promotes regional cluster to primary
5. **EKS** continues serving from the 2 healthy regions

### Manual Steps (SRE action required within 5 minutes):

```bash
# Step 1: Verify region failure (run from ops laptop or AWS CloudShell)
aws route53 get-health-check-status \
  --health-check-id <us-east-1-health-check-id> \
  --region us-east-1

# Step 2: Confirm Global Accelerator removed us-east-1 endpoint
aws globalaccelerator list-endpoint-groups \
  --listener-arn <listener-arn>

# Step 3: Promote Aurora Global cluster to eu-west-1 (if not auto-promoted)
aws rds failover-global-cluster \
  --global-cluster-identifier ai-platform-global-aurora \
  --target-db-cluster-identifier ai-platform-aurora-eu-west-1 \
  --region us-east-1

# Step 4: Verify Aurora promotion (takes ~60 seconds)
aws rds describe-global-clusters \
  --global-cluster-identifier ai-platform-global-aurora

# Step 5: Update application DATABASE_URL secret for primary writer
aws secretsmanager update-secret \
  --secret-id ai-platform/prod/database-url \
  --secret-string '{"writer": "aurora.cluster.eu-west-1.rds.amazonaws.com", "reader": "aurora.reader.cluster.eu-west-1.rds.amazonaws.com"}' \
  --region eu-west-1

# Step 6: Force EKS pods to pick up new secret (rolling restart)
kubectl rollout restart deployment/api -n api --context=eks-eu-west-1

# Step 7: Verify health in eu-west-1
kubectl get pods -n api --context=eks-eu-west-1
curl https://api-eu.studyassist.ai/api/health
```

### Estimated Timeline
- T+0s: Region failure begins
- T+30s: Route53 health check fails × 3
- T+30s: Global Accelerator removes endpoint automatically
- T+60s: SRE alerted via PagerDuty
- T+90s: SRE verifies incident, begins Aurora promotion
- T+150s: Aurora promotion complete, eu-west-1 accepting writes
- T+180s: API pods restarting with new DB endpoints
- T+240s: Full service restoration — **Total: < 5 minutes**

---

## 2. Database Recovery Procedures

### Scenario A: Aurora Data Corruption

```bash
# 1. Identify corruption scope
psql -h aurora-writer.us-east-1.rds.amazonaws.com -U platform_admin -d ai_platform \
  -c "SELECT schemaname, tablename, n_dead_tup FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 20;"

# 2. Enable point-in-time restore (PITR) — target 2 minutes before corruption
aws rds restore-db-cluster-to-point-in-time \
  --db-cluster-identifier ai-platform-aurora-recovery \
  --restore-type full-copy \
  --source-db-cluster-identifier ai-platform-aurora-primary \
  --restore-to-time "2025-01-15T10:28:00Z" \  # 2 min before incident
  --db-subnet-group-name ai-platform-db-subnet-us-east-1

# 3. Extract corrupted data from recovery cluster
pg_dump -h ai-platform-aurora-recovery.us-east-1.rds.amazonaws.com \
  -U platform_admin -d ai_platform \
  -t affected_table \
  --file=recovery_dump.sql

# 4. Apply to production (surgically)
psql -h aurora-writer.us-east-1.rds.amazonaws.com -U platform_admin -d ai_platform \
  < recovery_dump.sql
```

### Scenario B: Accidental DROP TABLE

```bash
# IMMEDIATE: Prevent further writes (if still within replication lag window)
# Contact AWS Support for binlog restore if > 1 minute ago

# Aurora backtrack (if enabled — <= 72 hours window)
aws rds backtrack-db-cluster \
  --db-cluster-identifier ai-platform-aurora-primary \
  --backtrack-to "2025-01-15T10:30:00Z" \
  --use-earliest-time-on-point-in-time-unavailable

# Verify backtrack complete
aws rds describe-db-cluster-backtracks \
  --db-cluster-identifier ai-platform-aurora-primary \
  --filters 'Name=db-cluster-backtrack-status,Values=applying,completed'
```

---

## 3. Redis Recovery Procedures

### Scenario: ElastiCache Global Datastore Split-Brain

```bash
# 1. Identify which regional cluster has the latest data
redis-cli -h <us-east-1-redis-endpoint> -p 6379 --tls INFO replication

# 2. Force eu-west-1 to sync from us-east-1 (if us-east-1 is healthy)
redis-cli -h <eu-west-1-redis-endpoint> -p 6379 --tls \
  SLAVEOF <us-east-1-redis-endpoint> 6379

# 3. Verify replication lag
redis-cli -h <eu-west-1-redis-endpoint> -p 6379 --tls INFO replication | grep lag

# 4. Re-enable replica after sync
redis-cli -h <eu-west-1-redis-endpoint> -p 6379 --tls SLAVEOF NO ONE
```

### Scenario: Complete Redis Failure (Cache Cold Start)

The application will gracefully degrade:
- AI responses: direct LLM calls (no cache, 3x cost temporarily)
- API throttling: falls back to in-memory token bucket
- Session data: JWT is stateless, no impact

```bash
# Drain and restart Redis cluster
aws elasticache reboot-replication-group \
  --replication-group-id ai-platform-redis-us-east-1 \
  --reboot-cache-cluster-ids <node-1-id> <node-2-id>

# Monitor warm-up (cache hit ratio will climb back to 65%+ within 30 min)
watch -n 5 "redis-cli -h <endpoint> --tls INFO stats | grep hit"
```

---

## 4. Qdrant Vector DB Recovery

### Scenario: Qdrant Collection Corruption

```bash
# 1. List all collections and shard status
curl https://qdrant.internal:6333/collections | jq '.result.collections[]'

# 2. Check specific collection health
curl https://qdrant.internal:6333/collections/tenant_shard_0 | jq '.result.status'

# 3. Trigger optimizers (rebuilds HNSW index)
curl -X POST https://qdrant.internal:6333/collections/tenant_shard_0/optimizer \
  -H 'Content-Type: application/json' \
  -d '{"optimization_params": {"max_indexing_threads": 4}}'

# 4. If collection is unrecoverable — restore from S3 backup snapshot
aws s3 cp s3://ai-platform-backups/qdrant/tenant_shard_0/latest.snapshot \
  /tmp/qdrant_restore.snapshot

curl -X POST https://qdrant.internal:6333/collections/tenant_shard_0/snapshots/recover \
  -H 'Content-Type: application/json' \
  -d '{"location": "/tmp/qdrant_restore.snapshot"}'
```

---

## 5. Service Degradation Runbook

### Graceful Degraded Mode (AI Service Down)

If the FastAPI AI service is completely unavailable, the NestJS API switches to:

1. **Cache-first mode** — serve last AI response from Redis (TTL up to 1 hour)
2. **Fallback responses** — pre-generated study tips per subject category
3. **Queue mode** — accept requests, queue them, respond async via webhook/email

**Circuit breaker states** are managed by `@nestjs/axios` + `opossum`:
```bash
# Check circuit breaker state via API
curl https://api.studyassist.ai/api/internal/circuit-breakers \
  -H "X-Admin-Secret: $ADMIN_SECRET"

# Force-open (bypass AI service) for testing
curl -X POST https://api.studyassist.ai/api/internal/circuit-breakers/ai-service/open \
  -H "X-Admin-Secret: $ADMIN_SECRET"
```

---

## 6. Backup Verification (Monthly Drill)

Run this checklist monthly to verify backup integrity:

```bash
#!/bin/bash
# scripts/dr-drill.sh

echo "=== DR Drill: Backup Verification ==="
echo "Date: $(date)"

# 1. Verify Aurora automated backups exist (< 24 hours old)
aws rds describe-db-cluster-snapshots \
  --db-cluster-identifier ai-platform-aurora-primary \
  --snapshot-type automated \
  --query 'DBClusterSnapshots[0].{Created:SnapshotCreateTime,Status:Status}' \
  --output table

# 2. Verify S3 cross-region replication is working
aws s3api list-objects-v2 \
  --bucket ai-platform-backups-eu-west-1 \
  --prefix qdrant/ \
  --max-items 1 \
  --query 'Contents[0].{Key:Key,Modified:LastModified}' \
  --output table

# 3. Test PITR connectivity (create test cluster, don't restore)
aws rds describe-db-cluster-snapshots \
  --db-cluster-identifier ai-platform-aurora-primary \
  --query 'length(DBClusterSnapshots)' \
  --output text

echo "=== Drill Complete. Review results above. ==="
```

---

## 7. Communication Template (P0 Incidents)

### Status Page Update (automated via Better Uptime / Statuspage.io)

```
🔴 [INCIDENT] Partial service degradation — us-east-1

Status: IDENTIFIED
Affected: API requests originating in North America (some users)
Impact: ~15% elevated latency during automatic region failover

We identified an issue with our us-east-1 infrastructure at 14:23 UTC.
Traffic has been automatically rerouted to eu-west-1. 
All data is safe. No data loss occurred.

Next update: 14:30 UTC

— AI Study Platform SRE Team
```

### Slack #incidents template:
```
🚨 P0 INCIDENT DECLARED
Region: us-east-1
Time: <time>
Impact: North America traffic rerouting
RTO Target: 5 minutes
Incident Commander: @on-call-sre
Bridge: https://meet.google.com/ai-platform-incident

Steps taken:
- [ ] Aurora failover initiated
- [ ] Global Accelerator updated  
- [ ] EKS pods restarted
- [ ] Health checks green
- [ ] Post-mortem scheduled
```

---

## 8. Post-Incident Checklist

After every P0/P1 incident:

- [ ] Timeline documented (minute-by-minute)
- [ ] Root cause identified
- [ ] Immediate mitigation applied
- [ ] Monitoring gap identified (why didn't we alert sooner?)
- [ ] Runbook updated with new learnings
- [ ] Action items created in Jira with owners and due dates
- [ ] Post-mortem meeting scheduled within 48 hours
- [ ] Blameless post-mortem document published in Notion within 5 days
- [ ] Customer communication sent (if user-impacting > 5 minutes)

---

*Last updated: Phase 4.0 deployment*  
*Owner: Platform SRE Team*  
*Review cycle: Monthly + after every P0/P1 incident*
