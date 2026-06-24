# ============================================================
# GLOBAL VARIABLES
# ============================================================

variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment: staging | production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Must be 'staging' or 'production'."
  }
}

variable "project" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "ai-study-assistant"
}

# ============================================================
# NETWORKING
# ============================================================

variable "vpc_cidr" {
  description = "CIDR block for the primary VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to use"
  type        = number
  default     = 2
}

# ============================================================
# ECS CLUSTER
# ============================================================

variable "ecs_capacity_providers" {
  description = "Capacity providers for ECS (FARGATE | FARGATE_SPOT)"
  type        = list(string)
  default     = ["FARGATE", "FARGATE_SPOT"]
}

# ============================================================
# API SERVICE (NestJS)
# ============================================================

variable "api_image_tag" {
  description = "ECR image tag for api-service"
  type        = string
  default     = "latest"
}

variable "api_cpu" {
  description = "CPU units for api task (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Memory (MiB) for api task"
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Desired number of api service tasks"
  type        = number
  default     = 2
}

variable "api_min_count" {
  description = "Minimum tasks for API auto-scaling"
  type        = number
  default     = 2
}

variable "api_max_count" {
  description = "Maximum tasks for API auto-scaling"
  type        = number
  default     = 10
}

# ============================================================
# AI SERVICE (FastAPI)
# ============================================================

variable "ai_image_tag" {
  description = "ECR image tag for ai-service"
  type        = string
  default     = "latest"
}

variable "ai_cpu" {
  description = "CPU units for ai-service task (LLM is CPU-intensive)"
  type        = number
  default     = 1024
}

variable "ai_memory" {
  description = "Memory (MiB) for ai-service task"
  type        = number
  default     = 2048
}

variable "ai_desired_count" {
  description = "Desired number of ai-service tasks"
  type        = number
  default     = 2
}

variable "ai_min_count" {
  description = "Minimum tasks for AI service auto-scaling"
  type        = number
  default     = 1
}

variable "ai_max_count" {
  description = "Maximum tasks for AI service auto-scaling"
  type        = number
  default     = 8
}

# ============================================================
# WORKER SERVICE (BullMQ)
# ============================================================

variable "worker_image_tag" {
  description = "ECR image tag for worker-service"
  type        = string
  default     = "latest"
}

variable "worker_cpu" {
  description = "CPU units for worker task"
  type        = number
  default     = 512
}

variable "worker_memory" {
  description = "Memory (MiB) for worker task"
  type        = number
  default     = 1024
}

variable "worker_desired_count" {
  description = "Desired number of worker tasks"
  type        = number
  default     = 1
}

variable "worker_min_count" {
  description = "Minimum tasks for worker auto-scaling"
  type        = number
  default     = 1
}

variable "worker_max_count" {
  description = "Maximum tasks for worker auto-scaling"
  type        = number
  default     = 6
}

# ============================================================
# RDS (PostgreSQL)
# ============================================================

variable "db_instance_class" {
  description = "RDS instance type"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 50
}

variable "db_max_allocated_storage" {
  description = "RDS max storage for autoscaling (GB)"
  type        = number
  default     = 200
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "study_assistant"
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  default     = "postgres"
  sensitive   = true
}

variable "db_password" {
  description = "RDS master password — set via TF_VAR_db_password env var"
  type        = string
  sensitive   = true
}

variable "db_read_replica_count" {
  description = "Number of RDS read replicas"
  type        = number
  default     = 1
}

# ============================================================
# ELASTICACHE (Redis)
# ============================================================

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t4g.medium"
}

variable "redis_num_cache_clusters" {
  description = "Number of nodes in Redis cluster (min 2 for Multi-AZ)"
  type        = number
  default     = 2
}

# ============================================================
# DOMAIN / TLS
# ============================================================

variable "domain_name" {
  description = "Primary domain name (e.g. studyassist.ai)"
  type        = string
}

variable "api_subdomain" {
  description = "Subdomain for API"
  type        = string
  default     = "api"
}

variable "ai_subdomain" {
  description = "Subdomain for AI service (internal — not public-facing)"
  type        = string
  default     = "ai-internal"
}

# ============================================================
# SECRETS
# ============================================================

variable "gemini_api_key_secret_arn" {
  description = "ARN of the Secrets Manager secret holding GEMINI_API_KEY"
  type        = string
}

variable "jwt_secret_arn" {
  description = "ARN of the Secrets Manager secret holding JWT_SECRET"
  type        = string
}
