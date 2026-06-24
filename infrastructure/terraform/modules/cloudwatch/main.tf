# ============================================================
# CLOUDWATCH MODULE — Dashboards, Alarms, SNS Alerts
# ============================================================

# ─── SNS Topic for Alerts ─────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ─── Critical Alarms ──────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "api_5xx_rate" {
  alarm_name          = "${var.name_prefix}-api-5xx-rate"
  alarm_description   = "API 5xx error rate > 1% — possible service degradation"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 1.0
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "errors / requests * 100"
    label       = "5xx Error Rate %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "HTTPCode_Target_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
      }
    }
  }

  metric_query {
    id = "requests"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 60
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
      }
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_p99_latency" {
  alarm_name          = "${var.name_prefix}-api-p99-latency"
  alarm_description   = "API P99 latency > 3s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 3.0

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.name_prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU > 80%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 80

  dimensions = { DBInstanceIdentifier = var.rds_identifier }
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${var.name_prefix}-rds-low-storage"
  alarm_description   = "RDS free storage < 10GB"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Minimum"
  threshold           = 10737418240 # 10 GB in bytes

  dimensions = { DBInstanceIdentifier = var.rds_identifier }
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${var.name_prefix}-redis-memory-high"
  alarm_description   = "Redis memory > 80%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Average"
  threshold           = 80

  dimensions = { ReplicationGroupId = var.elasticache_id }
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "redis_queue_depth" {
  alarm_name          = "${var.name_prefix}-redis-queue-depth"
  alarm_description   = "BullMQ queue depth > 50 — scale workers"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "CurrItems"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Maximum"
  threshold           = 50

  dimensions = { ReplicationGroupId = var.elasticache_id }
}

# ─── CloudWatch Dashboard ─────────────────────────────────

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.name_prefix}-production"

  dashboard_body = jsonencode({
    widgets = [
      # Row 1: API Health
      {
        type   = "metric"
        x      = 0; y = 0; width = 8; height = 6
        properties = {
          title  = "API Request Rate"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", period = 60 }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 8; y = 0; width = 8; height = 6
        properties = {
          title  = "API P50/P99 Latency"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p50", period = 60, label = "P50" }],
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, { stat = "p99", period = 60, label = "P99" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 16; y = 0; width = 8; height = 6
        properties = {
          title  = "API 4xx/5xx Errors"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", label = "4xx" }],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix, { stat = "Sum", label = "5xx" }]
          ]
        }
      },
      # Row 2: ECS Task Counts
      {
        type   = "metric"
        x      = 0; y = 6; width = 8; height = 6
        properties = {
          title  = "ECS Task Counts"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.cluster_name, "ServiceName", var.api_service_name, { label = "API Tasks" }],
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.cluster_name, "ServiceName", var.ai_service_name, { label = "AI Tasks" }]
          ]
        }
      },
      # Row 3: RDS
      {
        type   = "metric"
        x      = 0; y = 12; width = 8; height = 6
        properties = {
          title  = "RDS CPU + Connections"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.rds_identifier, { label = "CPU %" }],
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", var.rds_identifier, { yAxis = "right", label = "Connections" }]
          ]
        }
      },
      # Row 4: Redis
      {
        type   = "metric"
        x      = 8; y = 12; width = 8; height = 6
        properties = {
          title  = "Redis Queue Depth + Memory"
          view   = "timeSeries"
          region = var.aws_region
          metrics = [
            ["AWS/ElastiCache", "CurrItems", "ReplicationGroupId", var.elasticache_id, { label = "Queue Items" }],
            ["AWS/ElastiCache", "DatabaseMemoryUsagePercentage", "ReplicationGroupId", var.elasticache_id, { yAxis = "right", label = "Memory %" }]
          ]
        }
      }
    ]
  })
}

# ─── Log Metric Filters ────────────────────────────────────

resource "aws_cloudwatch_log_metric_filter" "api_errors" {
  name           = "${var.name_prefix}-api-errors"
  log_group_name = "/ecs/${var.name_prefix}/api"
  pattern        = "[timestamp, requestId, level=\"ERROR\", ...]"

  metric_transformation {
    name          = "ApiErrorCount"
    namespace     = "${var.name_prefix}/Application"
    value         = "1"
    default_value = "0"
  }
}

variable "name_prefix"       { type = string }
variable "environment"       { type = string }
variable "aws_region"        { type = string }
variable "cluster_name"      { type = string }
variable "api_service_name"  { type = string }
variable "ai_service_name"   { type = string }
variable "alb_arn_suffix"    { type = string }
variable "rds_identifier"    { type = string }
variable "elasticache_id"    { type = string }
variable "alert_email"       { type = string }

output "dashboard_name"             { value = aws_cloudwatch_dashboard.main.dashboard_name }
output "sns_topic_arn"              { value = aws_sns_topic.alerts.arn }
output "redis_queue_depth_alarm_arn"{ value = aws_cloudwatch_metric_alarm.redis_queue_depth.arn }
