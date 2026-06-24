# ============================================================
# ROOT MAIN — composes all modules
# ============================================================

locals {
  name_prefix = "${var.project}-${var.environment}"
  
  # Availability Zones — dynamically fetched
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# ============================================================
# 1. NETWORKING — VPC, Subnets, NAT Gateway, IGW
# ============================================================

module "vpc" {
  source = "./modules/vpc"

  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
  azs         = local.azs
}

# ============================================================
# 2. ECR REPOSITORIES — one per service
# ============================================================

module "ecr" {
  source = "./modules/ecr"

  name_prefix = local.name_prefix
  services    = ["api", "ai-service", "worker"]
}

# ============================================================
# 3. IAM — Task execution roles + task roles per service
# ============================================================

module "iam" {
  source = "./modules/iam"

  name_prefix              = local.name_prefix
  account_id               = data.aws_caller_identity.current.account_id
  aws_region               = var.aws_region
  gemini_api_key_secret_arn = var.gemini_api_key_secret_arn
  jwt_secret_arn           = var.jwt_secret_arn
  s3_bucket_arn            = module.s3.bucket_arn
}

# ============================================================
# 4. SECURITY GROUPS — one per tier
# ============================================================

module "security_groups" {
  source = "./modules/security_groups"

  name_prefix = local.name_prefix
  vpc_id      = module.vpc.vpc_id
  vpc_cidr    = var.vpc_cidr
}

# ============================================================
# 5. APPLICATION LOAD BALANCER
# ============================================================

module "alb" {
  source = "./modules/alb"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  alb_sg_id          = module.security_groups.alb_sg_id
  acm_certificate_arn = module.acm.certificate_arn
  domain_name        = var.domain_name
  api_subdomain      = var.api_subdomain
}

# ============================================================
# 6. ACM TLS CERTIFICATE
# ============================================================

module "acm" {
  source = "./modules/acm"

  domain_name    = var.domain_name
  api_subdomain  = var.api_subdomain
  route53_zone_id = module.route53.zone_id

  providers = {
    aws = aws
  }
}

# ============================================================
# 7. ECS CLUSTER + SERVICES
# ============================================================

module "ecs" {
  source = "./modules/ecs"

  name_prefix         = local.name_prefix
  aws_region          = var.aws_region
  environment         = var.environment
  private_subnet_ids  = module.vpc.private_subnet_ids

  # Security groups
  api_sg_id    = module.security_groups.api_sg_id
  ai_sg_id     = module.security_groups.ai_sg_id
  worker_sg_id = module.security_groups.worker_sg_id

  # ALB target groups
  api_target_group_arn = module.alb.api_target_group_arn

  # ECR image URIs
  api_ecr_image    = "${module.ecr.repository_urls["api"]}:${var.api_image_tag}"
  ai_ecr_image     = "${module.ecr.repository_urls["ai-service"]}:${var.ai_image_tag}"
  worker_ecr_image = "${module.ecr.repository_urls["worker"]}:${var.worker_image_tag}"

  # IAM roles
  execution_role_arn = module.iam.ecs_execution_role_arn
  api_task_role_arn  = module.iam.api_task_role_arn
  ai_task_role_arn   = module.iam.ai_task_role_arn

  # Secrets
  gemini_api_key_secret_arn = var.gemini_api_key_secret_arn
  jwt_secret_arn            = var.jwt_secret_arn

  # Task sizing
  api_cpu    = var.api_cpu
  api_memory = var.api_memory
  api_desired_count = var.api_desired_count

  ai_cpu    = var.ai_cpu
  ai_memory = var.ai_memory
  ai_desired_count = var.ai_desired_count

  worker_cpu    = var.worker_cpu
  worker_memory = var.worker_memory
  worker_desired_count = var.worker_desired_count

  # Data layer endpoints
  db_host           = module.rds.primary_endpoint
  db_name           = var.db_name
  db_username       = var.db_username
  db_password       = var.db_password
  redis_endpoint    = module.elasticache.primary_endpoint
  qdrant_host       = module.ecs_qdrant.service_discovery_dns
  s3_bucket_name    = module.s3.bucket_name
}

# ============================================================
# 8. QDRANT (Self-hosted on ECS — separate service)
# ============================================================

module "ecs_qdrant" {
  source = "./modules/qdrant"

  name_prefix        = local.name_prefix
  aws_region         = var.aws_region
  private_subnet_ids = module.vpc.private_subnet_ids
  qdrant_sg_id       = module.security_groups.qdrant_sg_id
  execution_role_arn = module.iam.ecs_execution_role_arn
  efs_volume_id      = module.efs.volume_id
  cluster_id         = module.ecs.cluster_id
}

# ============================================================
# 9. EFS (Persistent storage for Qdrant vectors)
# ============================================================

module "efs" {
  source = "./modules/efs"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  efs_sg_id          = module.security_groups.efs_sg_id
}

# ============================================================
# 10. RDS — PostgreSQL Multi-AZ + Read Replica
# ============================================================

module "rds" {
  source = "./modules/rds"

  name_prefix              = local.name_prefix
  db_subnet_ids            = module.vpc.private_subnet_ids
  rds_sg_id                = module.security_groups.rds_sg_id
  db_instance_class        = var.db_instance_class
  db_allocated_storage     = var.db_allocated_storage
  db_max_allocated_storage = var.db_max_allocated_storage
  db_name                  = var.db_name
  db_username              = var.db_username
  db_password              = var.db_password
  db_read_replica_count    = var.db_read_replica_count
}

# ============================================================
# 11. ELASTICACHE — Redis Cluster Mode
# ============================================================

module "elasticache" {
  source = "./modules/elasticache"

  name_prefix             = local.name_prefix
  subnet_ids              = module.vpc.private_subnet_ids
  redis_sg_id             = module.security_groups.redis_sg_id
  redis_node_type         = var.redis_node_type
  redis_num_cache_clusters = var.redis_num_cache_clusters
}

# ============================================================
# 12. S3 — Document storage + backups + lifecycle
# ============================================================

module "s3" {
  source = "./modules/s3"

  name_prefix = local.name_prefix
  environment = var.environment
}

# ============================================================
# 13. AUTO SCALING — per ECS service
# ============================================================

module "autoscaling" {
  source = "./modules/autoscaling"

  name_prefix   = local.name_prefix
  cluster_name  = module.ecs.cluster_name

  api_service_name    = module.ecs.api_service_name
  api_min_count       = var.api_min_count
  api_max_count       = var.api_max_count

  ai_service_name     = module.ecs.ai_service_name
  ai_min_count        = var.ai_min_count
  ai_max_count        = var.ai_max_count

  worker_service_name = module.ecs.worker_service_name
  worker_min_count    = var.worker_min_count
  worker_max_count    = var.worker_max_count

  redis_queue_alarm_arn = module.cloudwatch.redis_queue_depth_alarm_arn
}

# ============================================================
# 14. CLOUDWATCH — Dashboards + Alarms
# ============================================================

module "cloudwatch" {
  source = "./modules/cloudwatch"

  name_prefix        = local.name_prefix
  environment        = var.environment
  aws_region         = var.aws_region
  cluster_name       = module.ecs.cluster_name
  api_service_name   = module.ecs.api_service_name
  ai_service_name    = module.ecs.ai_service_name
  alb_arn_suffix     = module.alb.alb_arn_suffix
  rds_identifier     = module.rds.db_identifier
  elasticache_id     = module.elasticache.cluster_id
  alert_email        = "ops@${var.domain_name}"
}

# ============================================================
# 15. WAF — Web Application Firewall on ALB
# ============================================================

module "waf" {
  source = "./modules/waf"

  name_prefix = local.name_prefix
  alb_arn     = module.alb.alb_arn
}

# ============================================================
# 16. ROUTE 53 — DNS + Health Checks + Failover
# ============================================================

module "route53" {
  source = "./modules/route53"

  domain_name      = var.domain_name
  api_subdomain    = var.api_subdomain
  alb_dns_name     = module.alb.alb_dns_name
  alb_zone_id      = module.alb.alb_zone_id
}
