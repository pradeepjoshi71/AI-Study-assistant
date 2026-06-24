# ============================================================
# ECS MODULE — Cluster + Task Definitions + Services
# ============================================================

# ─── ECS Cluster ──────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs_exec.name
      }
    }
  }

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1 # Always keep at least 1 FARGATE task (not SPOT) for stability
  }
}

resource "aws_cloudwatch_log_group" "ecs_exec" {
  name              = "/aws/ecs/${var.name_prefix}/exec"
  retention_in_days = 7
}

# ─── CloudWatch Log Groups per service ────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name_prefix}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "ai_service" {
  name              = "/ecs/${var.name_prefix}/ai-service"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.name_prefix}/worker"
  retention_in_days = 14
}

# ─── SERVICE DISCOVERY (Cloud Map) ────────────────────────

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${var.name_prefix}.local"
  vpc         = var.vpc_id
  description = "Private DNS namespace for ECS service discovery"
}

resource "aws_service_discovery_service" "ai_service" {
  name = "ai-service"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"
    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ─── API SERVICE (NestJS) ─────────────────────────────────

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name_prefix}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.api_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_ecr_image
      essential = true

      portMappings = [{ containerPort = 3001, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV",    value = var.environment },
        { name = "API_PORT",    value = "3001" },
        { name = "API_PREFIX",  value = "api/v1" },
        { name = "DATABASE_URL", value = "postgresql://${var.db_username}:${var.db_password}@${var.db_host}:5432/${var.db_name}?schema=public" },
        { name = "REDIS_HOST",  value = var.redis_endpoint },
        { name = "REDIS_PORT",  value = "6379" },
        { name = "S3_BUCKET",   value = var.s3_bucket_name },
        { name = "AWS_REGION",  value = var.aws_region },
      ]

      secrets = [
        {
          name      = "JWT_SECRET"
          valueFrom = var.jwt_secret_arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3001/api/v1/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = { Name = "${var.name_prefix}-api-task" }
}

resource "aws_ecs_service" "api" {
  name                               = "${var.name_prefix}-api"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.api_desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = 60
  enable_execute_command             = true # ECS Exec for debugging

  deployment_circuit_breaker {
    enable   = true
    rollback = true # ← auto-rollback on deployment failure
  }

  deployment_controller {
    type = "ECS" # Rolling update (change to CODE_DEPLOY for blue/green)
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.api_sg_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.api_target_group_arn
    container_name   = "api"
    container_port   = 3001
  }

  lifecycle {
    ignore_changes = [desired_count] # managed by autoscaling
  }
}

# ─── AI SERVICE (FastAPI) ─────────────────────────────────

resource "aws_ecs_task_definition" "ai_service" {
  family                   = "${var.name_prefix}-ai-service"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ai_cpu
  memory                   = var.ai_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.ai_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "ai-service"
      image     = var.ai_ecr_image
      essential = true

      portMappings = [{ containerPort = 8000, protocol = "tcp" }]

      environment = [
        { name = "AI_PORT",       value = "8000" },
        { name = "AI_HOST",       value = "0.0.0.0" },
        { name = "AI_REDIS_HOST", value = var.redis_endpoint },
        { name = "AI_REDIS_PORT", value = "6379" },
        { name = "QDRANT_HOST",   value = var.qdrant_host },
        { name = "QDRANT_PORT",   value = "6333" },
        { name = "AWS_REGION",    value = var.aws_region },
        { name = "ENVIRONMENT",   value = var.environment },
      ]

      secrets = [
        {
          name      = "GEMINI_API_KEY"
          valueFrom = var.gemini_api_key_secret_arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ai_service.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ai-service"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 90 # LLM startup can be slow
      }
    }
  ])
}

resource "aws_ecs_service" "ai_service" {
  name                              = "${var.name_prefix}-ai-service"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.ai_service.arn
  desired_count                     = var.ai_desired_count
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 120
  enable_execute_command            = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ai_sg_id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.ai_service.arn
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# ─── WORKER SERVICE (BullMQ) ─────────────────────────────

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name_prefix}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.api_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = var.worker_ecr_image
      essential = true

      environment = [
        { name = "NODE_ENV",     value = var.environment },
        { name = "WORKER_MODE",  value = "true" },
        { name = "DATABASE_URL", value = "postgresql://${var.db_username}:${var.db_password}@${var.db_host}:5432/${var.db_name}?schema=public" },
        { name = "REDIS_HOST",   value = var.redis_endpoint },
        { name = "REDIS_PORT",   value = "6379" },
        { name = "AI_SERVICE_URL", value = "http://ai-service.${var.name_prefix}.local:8000" },
        { name = "S3_BUCKET",    value = var.s3_bucket_name },
        { name = "AWS_REGION",   value = var.aws_region },
      ]

      secrets = [
        { name = "JWT_SECRET",     valueFrom = var.jwt_secret_arn },
        { name = "GEMINI_API_KEY", valueFrom = var.gemini_api_key_secret_arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "worker" {
  name             = "${var.name_prefix}-worker"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.worker.arn
  desired_count    = var.worker_desired_count

  # Workers run on FARGATE_SPOT for cost savings (~70% cheaper)
  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 4
  }
  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.worker_sg_id]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}
