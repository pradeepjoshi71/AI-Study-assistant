# ============================================================
# ELASTICACHE MODULE — Redis Replication Group (Cluster Mode)
# ============================================================

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.name_prefix}-redis-subnet-group"
  subnet_ids = var.subnet_ids
  tags       = { Name = "${var.name_prefix}-redis-subnet-group" }
}

resource "aws_elasticache_parameter_group" "main" {
  name   = "${var.name_prefix}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru" # evict LRU keys when memory full
  }

  parameter {
    name  = "notify-keyspace-events"
    value = "Ex" # Enable keyspace notifications for BullMQ
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.name_prefix}-redis"
  description          = "Redis cluster for AI Study Assistant"

  node_type            = var.redis_node_type
  num_cache_clusters   = var.redis_num_cache_clusters
  port                 = 6379

  # HA configuration
  automatic_failover_enabled = true # requires num_cache_clusters >= 2
  multi_az_enabled           = true

  parameter_group_name = aws_elasticache_parameter_group.main.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [var.redis_sg_id]

  # Encryption
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = random_password.redis_auth.result

  # Snapshots
  snapshot_retention_limit = 5
  snapshot_window          = "03:00-05:00"
  maintenance_window       = "sun:05:00-sun:06:00"

  auto_minor_version_upgrade = true

  tags = { Name = "${var.name_prefix}-redis" }
}

resource "random_password" "redis_auth" {
  length  = 32
  special = false # Redis auth tokens cannot contain certain special chars
}

# Store Redis auth token in Secrets Manager
resource "aws_secretsmanager_secret" "redis_auth" {
  name                    = "${var.name_prefix}/redis/auth-token"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

variable "name_prefix"             { type = string }
variable "subnet_ids"              { type = list(string) }
variable "redis_sg_id"             { type = string }
variable "redis_node_type"         { type = string }
variable "redis_num_cache_clusters"{ type = number }

output "primary_endpoint"   { value = aws_elasticache_replication_group.main.primary_endpoint_address; sensitive = true }
output "reader_endpoint"    { value = aws_elasticache_replication_group.main.reader_endpoint_address; sensitive = true }
output "cluster_id"         { value = aws_elasticache_replication_group.main.id }
output "auth_token_arn"     { value = aws_secretsmanager_secret.redis_auth.arn }
