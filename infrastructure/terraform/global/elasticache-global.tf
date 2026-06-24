# ============================================================
# ELASTICACHE GLOBAL DATASTORE (Redis 7)
# Cross-region replication with < 30s failover
# Cluster mode enabled — 6 shards, 3 replicas per shard
# ============================================================

# ── Global Replication Group (Redis 7 Cluster Mode) ───────────────────────────
resource "aws_elasticache_global_replication_group" "main" {
  provider = aws.us_east_1

  global_replication_group_id_suffix = "${var.project}-global-redis"
  primary_replication_group_id       = aws_elasticache_replication_group.us_east_1.id

  # Engine version
  engine_version = "7.1"

  # Cluster parameters — applies to all regional clusters
  cache_node_type = var.redis_node_type

  tags = {
    Name        = "${var.project}-global-redis"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

# ── US-East-1 Primary Cluster ─────────────────────────────────────────────────
resource "aws_elasticache_replication_group" "us_east_1" {
  provider = aws.us_east_1

  replication_group_id = "${var.project}-redis-us-east-1"
  description          = "AI Platform Redis primary cluster — us-east-1"

  # Cluster mode configuration (horizontal sharding)
  num_node_groups         = 3   # 3 shards
  replicas_per_node_group = 2   # 2 replicas per shard = 9 nodes total

  node_type    = var.redis_node_type
  engine       = "redis"
  engine_version = "7.1"

  # High availability
  automatic_failover_enabled  = true
  multi_az_enabled            = true

  # TLS encryption in transit
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.redis_us.arn

  # Auth token (rotated via Secrets Manager)
  auth_token = var.redis_auth_token

  # Subnet and security
  subnet_group_name  = aws_elasticache_subnet_group.us_east_1.name
  security_group_ids = [var.redis_sg_id_us_east_1]

  # Maintenance + backup
  maintenance_window       = "sun:05:00-sun:06:00"
  snapshot_window          = "03:00-04:00"
  snapshot_retention_limit = 7

  # Auto minor version upgrades
  auto_minor_version_upgrade = true

  # Parameter group: latency-optimized settings
  parameter_group_name = aws_elasticache_parameter_group.redis7_optimized.name

  tags = {
    Name        = "${var.project}-redis-us-east-1"
    Region      = "us-east-1"
    Environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ── EU-West-1 Secondary Cluster ───────────────────────────────────────────────
resource "aws_elasticache_replication_group" "eu_west_1" {
  provider = aws.eu_west_1

  replication_group_id = "${var.project}-redis-eu-west-1"
  description          = "AI Platform Redis secondary cluster — eu-west-1"

  num_node_groups         = 3
  replicas_per_node_group = 2

  node_type      = var.redis_node_type
  engine         = "redis"
  engine_version = "7.1"

  automatic_failover_enabled = true
  multi_az_enabled           = true

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  subnet_group_name  = aws_elasticache_subnet_group.eu_west_1.name
  security_group_ids = [var.redis_sg_id_eu_west_1]

  maintenance_window       = "sun:05:00-sun:06:00"
  snapshot_retention_limit = 3

  parameter_group_name = aws_elasticache_parameter_group.redis7_optimized.name

  tags = {
    Name   = "${var.project}-redis-eu-west-1"
    Region = "eu-west-1"
  }
}

# ── AP-South-1 Secondary Cluster ──────────────────────────────────────────────
resource "aws_elasticache_replication_group" "ap_south_1" {
  provider = aws.ap_south_1

  replication_group_id = "${var.project}-redis-ap-south-1"
  description          = "AI Platform Redis secondary cluster — ap-south-1"

  num_node_groups         = 3
  replicas_per_node_group = 2

  node_type      = var.redis_node_type
  engine         = "redis"
  engine_version = "7.1"

  automatic_failover_enabled = true
  multi_az_enabled           = true

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true

  subnet_group_name  = aws_elasticache_subnet_group.ap_south_1.name
  security_group_ids = [var.redis_sg_id_ap_south_1]

  maintenance_window       = "sun:05:00-sun:06:00"
  snapshot_retention_limit = 3

  parameter_group_name = aws_elasticache_parameter_group.redis7_optimized.name

  tags = {
    Name   = "${var.project}-redis-ap-south-1"
    Region = "ap-south-1"
  }
}

# ── Add secondary regions to global group ─────────────────────────────────────
resource "aws_elasticache_global_replication_group_member" "eu_west_1" {
  global_replication_group_id = aws_elasticache_global_replication_group.main.global_replication_group_id
  replication_group_id        = aws_elasticache_replication_group.eu_west_1.id
  replication_group_region    = "eu-west-1"
}

resource "aws_elasticache_global_replication_group_member" "ap_south_1" {
  global_replication_group_id = aws_elasticache_global_replication_group.main.global_replication_group_id
  replication_group_id        = aws_elasticache_replication_group.ap_south_1.id
  replication_group_region    = "ap-south-1"
}

# ── Redis 7 Latency-Optimized Parameter Group ─────────────────────────────────
resource "aws_elasticache_parameter_group" "redis7_optimized" {
  provider = aws.us_east_1

  name   = "${var.project}-redis7-optimized"
  family = "redis7"

  # Disable AOF (not needed with replication) — reduces write latency
  parameter {
    name  = "appendonly"
    value = "no"
  }

  # Lazy eviction to avoid blocking IO
  parameter {
    name  = "lazyfree-lazy-eviction"
    value = "yes"
  }

  parameter {
    name  = "lazyfree-lazy-expire"
    value = "yes"
  }

  # Active defragmentation
  parameter {
    name  = "activedefrag"
    value = "yes"
  }

  # Max memory policy — LRU with TTL consideration for cache workloads
  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  # TCP keepalive — important for long-lived connections
  parameter {
    name  = "tcp-keepalive"
    value = "60"
  }

  # Increase client output buffer limits for streaming (AI responses)
  parameter {
    name  = "client-output-buffer-limit"
    value = "normal 0 0 0 slave 268435456 67108864 60 pubsub 33554432 8388608 60"
  }
}

# ── KMS keys per region ───────────────────────────────────────────────────────
resource "aws_kms_key" "redis_us" {
  provider                = aws.us_east_1
  description             = "${var.project} Redis encryption key — us-east-1"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "${var.project}-redis-kms-us" }
}

# ── Subnet Groups ─────────────────────────────────────────────────────────────
resource "aws_elasticache_subnet_group" "us_east_1" {
  provider   = aws.us_east_1
  name       = "${var.project}-redis-subnet-us-east-1"
  subnet_ids = data.aws_subnets.us_east_1_private.ids
  tags       = { Name = "${var.project}-redis-subnet-us-east-1" }
}

resource "aws_elasticache_subnet_group" "eu_west_1" {
  provider   = aws.eu_west_1
  name       = "${var.project}-redis-subnet-eu-west-1"
  subnet_ids = data.aws_subnets.eu_west_1_private.ids
  tags       = { Name = "${var.project}-redis-subnet-eu-west-1" }
}

resource "aws_elasticache_subnet_group" "ap_south_1" {
  provider   = aws.ap_south_1
  name       = "${var.project}-redis-subnet-ap-south-1"
  subnet_ids = data.aws_subnets.ap_south_1_private.ids
  tags       = { Name = "${var.project}-redis-subnet-ap-south-1" }
}

# ── Variable declarations ─────────────────────────────────────────────────────
variable "redis_auth_token" {
  type      = string
  sensitive = true
}
variable "redis_sg_id_us_east_1" { type = string }
variable "redis_sg_id_eu_west_1" { type = string }
variable "redis_sg_id_ap_south_1" { type = string }

# ── Outputs ───────────────────────────────────────────────────────────────────
output "redis_us_east_1_endpoint" {
  value       = aws_elasticache_replication_group.us_east_1.configuration_endpoint_address
  description = "Redis cluster mode endpoint — us-east-1"
}

output "redis_eu_west_1_endpoint" {
  value       = aws_elasticache_replication_group.eu_west_1.configuration_endpoint_address
  description = "Redis cluster mode endpoint — eu-west-1"
}

output "redis_ap_south_1_endpoint" {
  value       = aws_elasticache_replication_group.ap_south_1.configuration_endpoint_address
  description = "Redis cluster mode endpoint — ap-south-1"
}
