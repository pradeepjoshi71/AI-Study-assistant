# ============================================================
# QDRANT MODULE — Self-hosted Qdrant on ECS Fargate + EFS
# ============================================================

# CloudWatch log group
resource "aws_cloudwatch_log_group" "qdrant" {
  name              = "/ecs/${var.name_prefix}/qdrant"
  retention_in_days = 14
}

# Qdrant ECS task definition with EFS volume mount
resource "aws_ecs_task_definition" "qdrant" {
  family                   = "${var.name_prefix}-qdrant"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024  # 1 vCPU — vector ops need compute
  memory                   = 2048  # 2 GB — for in-memory vector index
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "qdrant"
      image     = "qdrant/qdrant:v1.9.0"  # Pin version for stability
      essential = true

      portMappings = [
        { containerPort = 6333, protocol = "tcp", name = "http" },
        { containerPort = 6334, protocol = "tcp", name = "grpc" }
      ]

      environment = [
        { name = "QDRANT__SERVICE__HTTP_PORT", value = "6333" },
        { name = "QDRANT__SERVICE__GRPC_PORT", value = "6334" },
        { name = "QDRANT__STORAGE__STORAGE_PATH", value = "/qdrant/storage" },
        { name = "QDRANT__LOG_LEVEL", value = "INFO" },
        # Collection optimizer — tune for production
        { name = "QDRANT__OPTIMIZERS__DEFAULT_SEGMENT_NUMBER", value = "2" },
        { name = "QDRANT__OPTIMIZERS__MAX_OPTIMIZATION_THREADS", value = "2" },
      ]

      mountPoints = [
        {
          sourceVolume  = "qdrant-storage"
          containerPath = "/qdrant/storage"
          readOnly      = false
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.qdrant.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "qdrant"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:6333/healthz || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  # EFS volume binding
  volume {
    name = "qdrant-storage"

    efs_volume_configuration {
      file_system_id          = var.efs_volume_id
      transit_encryption      = "ENABLED"
      authorization_config {
        iam = "ENABLED"
      }
    }
  }

  tags = { Name = "${var.name_prefix}-qdrant-task" }
}

# Qdrant ECS service — single task, internal only
resource "aws_ecs_service" "qdrant" {
  name                = "${var.name_prefix}-qdrant"
  cluster             = var.cluster_id
  task_definition     = aws_ecs_task_definition.qdrant.arn
  desired_count       = 1   # single instance — Qdrant handles sharding internally
  launch_type         = "FARGATE"
  platform_version    = "LATEST"

  # Qdrant is stateful — avoid unnecessary restarts
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Use FARGATE (not SPOT) for stateful Qdrant — SPOT can be interrupted
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.qdrant_sg_id]
    assign_public_ip = false
  }

  # Service Connect for internal DNS
  service_connect_configuration {
    enabled   = true
    namespace = "${var.name_prefix}.local"
    service {
      port_name      = "http"
      discovery_name = "qdrant"
      client_alias {
        port = 6333
      }
    }
  }

  tags = { Name = "${var.name_prefix}-qdrant-service" }
}

variable "name_prefix"        { type = string }
variable "aws_region"         { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "qdrant_sg_id"       { type = string }
variable "execution_role_arn" { type = string }
variable "efs_volume_id"      { type = string }
variable "cluster_id"         { type = string }

output "service_discovery_dns" { value = "qdrant.${var.name_prefix}.local" }
output "service_name"          { value = aws_ecs_service.qdrant.name }
