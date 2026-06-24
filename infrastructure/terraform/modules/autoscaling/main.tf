# ============================================================
# AUTO SCALING MODULE — ECS Application Auto Scaling
# ============================================================

# ─── API SERVICE SCALING ──────────────────────────────────

resource "aws_appautoscaling_target" "api" {
  max_capacity       = var.api_max_count
  min_capacity       = var.api_min_count
  resource_id        = "service/${var.cluster_name}/${var.api_service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Scale out on CPU > 60%
resource "aws_appautoscaling_policy" "api_cpu_scale_out" {
  name               = "${var.name_prefix}-api-cpu-scale-out"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 20
      scaling_adjustment          = 1
    }
    step_adjustment {
      metric_interval_lower_bound = 20
      scaling_adjustment          = 2
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "api_cpu_high" {
  alarm_name          = "${var.name_prefix}-api-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 60

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = var.api_service_name
  }

  alarm_actions = [aws_appautoscaling_policy.api_cpu_scale_out.arn]
}

# Scale in on CPU < 30%
resource "aws_appautoscaling_policy" "api_cpu_scale_in" {
  name               = "${var.name_prefix}-api-cpu-scale-in"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300 # 5 min cooldown before scaling in
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "api_cpu_low" {
  alarm_name          = "${var.name_prefix}-api-cpu-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 5 # Wait 5 periods before scaling in (avoid flapping)
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 60
  statistic           = "Average"
  threshold           = 30

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = var.api_service_name
  }

  alarm_actions = [aws_appautoscaling_policy.api_cpu_scale_in.arn]
}

# API Memory scaling
resource "aws_appautoscaling_policy" "api_memory_scale_out" {
  name               = "${var.name_prefix}-api-memory-scale-out"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 75.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

# ─── AI SERVICE SCALING ───────────────────────────────────

resource "aws_appautoscaling_target" "ai_service" {
  max_capacity       = var.ai_max_count
  min_capacity       = var.ai_min_count
  resource_id        = "service/${var.cluster_name}/${var.ai_service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# AI service scales on CPU > 70% (LLM inference is CPU-heavy)
resource "aws_appautoscaling_policy" "ai_cpu_scaling" {
  name               = "${var.name_prefix}-ai-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ai_service.resource_id
  scalable_dimension = aws_appautoscaling_target.ai_service.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ai_service.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70.0
    scale_in_cooldown  = 600 # Longer cooldown — LLM tasks are heavy to start
    scale_out_cooldown = 120

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# ─── WORKER SERVICE SCALING ───────────────────────────────

resource "aws_appautoscaling_target" "worker" {
  max_capacity       = var.worker_max_count
  min_capacity       = var.worker_min_count
  resource_id        = "service/${var.cluster_name}/${var.worker_service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Worker scales on Redis queue depth
resource "aws_appautoscaling_policy" "worker_queue_scale_out" {
  name               = "${var.name_prefix}-worker-queue-scale-out"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 120
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 50
      scaling_adjustment          = 1
    }
    step_adjustment {
      metric_interval_lower_bound = 50
      scaling_adjustment          = 2
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_queue_depth" {
  alarm_name          = "${var.name_prefix}-worker-queue-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "CurrItems"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Maximum"
  threshold           = 20 # scale when > 20 items waiting

  alarm_actions = [aws_appautoscaling_policy.worker_queue_scale_out.arn]
}

# Scheduled scaling — scale down overnight (IST)
resource "aws_appautoscaling_scheduled_action" "api_scale_down_night" {
  name               = "${var.name_prefix}-api-night-scale-down"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(0 19 * * ? *)" # 19:00 UTC = 00:30 IST

  scalable_target_action {
    min_capacity = 1
    max_capacity = 3
  }
}

resource "aws_appautoscaling_scheduled_action" "api_scale_up_morning" {
  name               = "${var.name_prefix}-api-morning-scale-up"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(0 3 * * ? *)" # 03:00 UTC = 08:30 IST

  scalable_target_action {
    min_capacity = 2
    max_capacity = 10
  }
}

variable "name_prefix"          { type = string }
variable "cluster_name"         { type = string }
variable "api_service_name"     { type = string }
variable "api_min_count"        { type = number }
variable "api_max_count"        { type = number }
variable "ai_service_name"      { type = string }
variable "ai_min_count"         { type = number }
variable "ai_max_count"         { type = number }
variable "worker_service_name"  { type = string }
variable "worker_min_count"     { type = number }
variable "worker_max_count"     { type = number }
variable "redis_queue_alarm_arn"{ type = string; default = "" }
