# ============================================================
# PHASE 4.0 — GLOBAL MULTI-REGION VARIABLES
# Supports: us-east-1 (primary), eu-west-1, ap-south-1
# ============================================================

variable "project" {
  description = "Project name prefix"
  type        = string
  default     = "ai-platform"
}

variable "primary_region" {
  description = "Primary AWS region (writer DB, CI/CD)"
  type        = string
  default     = "us-east-1"
}

variable "secondary_regions" {
  description = "Additional AWS regions for active-active deployment"
  type        = list(string)
  default     = ["eu-west-1", "ap-south-1"]
}

variable "all_regions" {
  description = "All regions to deploy into"
  type        = list(string)
  default     = ["us-east-1", "eu-west-1", "ap-south-1"]
}

variable "domain_name" {
  description = "Root domain name (e.g., studyassist.ai)"
  type        = string
}

variable "gemini_api_key_secret_arn" {
  description = "AWS Secrets Manager ARN for Gemini API key (primary region)"
  type        = string
}

variable "jwt_secret_arn" {
  description = "AWS Secrets Manager ARN for JWT signing secret"
  type        = string
}

variable "db_master_password" {
  description = "Aurora Global Database master password"
  type        = string
  sensitive   = true
}

variable "db_master_username" {
  description = "Aurora Global Database master username"
  type        = string
  default     = "platform_admin"
  sensitive   = true
}

# ── VPC CIDRs per region (must not overlap) ───────────────────────────────────
variable "region_vpc_cidrs" {
  description = "VPC CIDR blocks per AWS region (must not overlap for VPC peering)"
  type        = map(string)
  default = {
    "us-east-1"  = "10.0.0.0/16"
    "eu-west-1"  = "10.1.0.0/16"
    "ap-south-1" = "10.2.0.0/16"
  }
}

# ── EKS Cluster Sizing ────────────────────────────────────────────────────────
variable "eks_node_instance_types" {
  description = "EKS managed node group instance types"
  type        = list(string)
  default     = ["m6g.xlarge", "m6g.2xlarge"]
}

variable "eks_node_min_size" {
  type    = number
  default = 2
}

variable "eks_node_max_size" {
  type    = number
  default = 50   # Supports up to ~1M users per region at peak
}

variable "eks_node_desired_size" {
  type    = number
  default = 3
}

# ── Aurora Global DB ──────────────────────────────────────────────────────────
variable "aurora_instance_class" {
  description = "Aurora PostgreSQL instance class"
  type        = string
  default     = "db.r6g.xlarge"   # 4 vCPU, 32 GB RAM
}

variable "aurora_reader_count_per_region" {
  description = "Number of Aurora read replicas per region"
  type        = number
  default     = 2
}

# ── ElastiCache Global ────────────────────────────────────────────────────────
variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.r6g.xlarge"  # 4 vCPU, 26 GB RAM
}

variable "redis_cluster_size" {
  description = "Number of nodes per Redis regional cluster"
  type        = number
  default     = 3   # 1 primary + 2 replicas per region
}

# ── Qdrant Sharding ───────────────────────────────────────────────────────────
variable "qdrant_shard_count" {
  description = "Number of Qdrant shards per region"
  type        = number
  default     = 8   # Supports up to 800M vectors per region
}

variable "qdrant_replication_factor" {
  description = "Qdrant vector replication factor within a region"
  type        = number
  default     = 2
}

# ── CloudFront CDN ────────────────────────────────────────────────────────────
variable "cloudfront_price_class" {
  description = "CloudFront price class (PriceClass_All = all edge locations)"
  type        = string
  default     = "PriceClass_All"
}

variable "cloudfront_default_ttl" {
  description = "Default CloudFront cache TTL in seconds"
  type        = number
  default     = 3600  # 1 hour
}

# ── Disaster Recovery ─────────────────────────────────────────────────────────
variable "rto_target_minutes" {
  description = "Recovery Time Objective (minutes)"
  type        = number
  default     = 5
}

variable "rpo_target_minutes" {
  description = "Recovery Point Objective (minutes)"
  type        = number
  default     = 1
}

variable "backup_retention_days" {
  description = "RDS automated backup retention period"
  type        = number
  default     = 35   # Maximum for Aurora
}
