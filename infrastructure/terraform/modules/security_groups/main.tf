# ============================================================
# SECURITY GROUPS MODULE — Strict least-privilege rules
# ============================================================

# ─── ALB Security Group ─────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "Allow HTTPS from internet to ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP redirect to HTTPS"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS from internet"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = { Name = "${var.name_prefix}-alb-sg" }
}

# ─── API Service Security Group ─────────────────────────

resource "aws_security_group" "api" {
  name        = "${var.name_prefix}-api-sg"
  description = "NestJS API — allow traffic from ALB only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "API traffic from ALB"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound (DB, Redis, S3, AI service)"
  }

  tags = { Name = "${var.name_prefix}-api-sg" }
}

# ─── AI Service Security Group ──────────────────────────

resource "aws_security_group" "ai_service" {
  name        = "${var.name_prefix}-ai-sg"
  description = "FastAPI AI service — allow traffic from API and Worker only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
    description     = "AI service traffic from API"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound (Qdrant, Redis, Gemini API)"
  }

  tags = { Name = "${var.name_prefix}-ai-sg" }
}

# ─── Worker Security Group ──────────────────────────────

resource "aws_security_group" "worker" {
  name        = "${var.name_prefix}-worker-sg"
  description = "BullMQ worker — no inbound needed"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound (Redis, DB, AI service, S3)"
  }

  tags = { Name = "${var.name_prefix}-worker-sg" }
}

# ─── RDS Security Group ─────────────────────────────────

resource "aws_security_group" "rds" {
  name        = "${var.name_prefix}-rds-sg"
  description = "RDS PostgreSQL — allow API and worker only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.worker.id]
    description     = "PostgreSQL from API and Worker"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
    description = "Allow VPC outbound only"
  }

  tags = { Name = "${var.name_prefix}-rds-sg" }
}

# ─── Redis Security Group ───────────────────────────────

resource "aws_security_group" "redis" {
  name        = "${var.name_prefix}-redis-sg"
  description = "ElastiCache Redis — allow API, AI service, worker"
  vpc_id      = var.vpc_id

  ingress {
    from_port = 6379
    to_port   = 6379
    protocol  = "tcp"
    security_groups = [
      aws_security_group.api.id,
      aws_security_group.ai_service.id,
      aws_security_group.worker.id
    ]
    description = "Redis from services"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${var.name_prefix}-redis-sg" }
}

# ─── Qdrant Security Group ──────────────────────────────

resource "aws_security_group" "qdrant" {
  name        = "${var.name_prefix}-qdrant-sg"
  description = "Qdrant vector DB — allow AI service only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6333
    to_port         = 6334
    protocol        = "tcp"
    security_groups = [aws_security_group.ai_service.id]
    description     = "Qdrant HTTP + gRPC from AI service"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${var.name_prefix}-qdrant-sg" }
}

# ─── EFS Security Group ─────────────────────────────────

resource "aws_security_group" "efs" {
  name        = "${var.name_prefix}-efs-sg"
  description = "EFS — allow Qdrant ECS tasks only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.qdrant.id]
    description     = "NFS from Qdrant"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${var.name_prefix}-efs-sg" }
}

variable "name_prefix" { type = string }
variable "vpc_id"      { type = string }
variable "vpc_cidr"    { type = string }

output "alb_sg_id"    { value = aws_security_group.alb.id }
output "api_sg_id"    { value = aws_security_group.api.id }
output "ai_sg_id"     { value = aws_security_group.ai_service.id }
output "worker_sg_id" { value = aws_security_group.worker.id }
output "rds_sg_id"    { value = aws_security_group.rds.id }
output "redis_sg_id"  { value = aws_security_group.redis.id }
output "qdrant_sg_id" { value = aws_security_group.qdrant.id }
output "efs_sg_id"    { value = aws_security_group.efs.id }
