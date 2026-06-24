# ============================================================
# ROUTE 53 MODULE — DNS + Health Checks + Failover
# ============================================================

# Hosted Zone (must exist — created manually or via separate Terraform)
data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# API subdomain → ALB (latency-based for future multi-region)
resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${var.api_subdomain}.${var.domain_name}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true # Route53 uses ALB health to route traffic
  }
}

# Health check for the API endpoint
resource "aws_route53_health_check" "api" {
  fqdn              = "${var.api_subdomain}.${var.domain_name}"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/v1/health"
  failure_threshold = 3
  request_interval  = 30

  tags = { Name = "${var.api_subdomain}.${var.domain_name}-health-check" }
}

# CloudWatch alarm for Route53 health check failures
resource "aws_cloudwatch_metric_alarm" "route53_api_health" {
  provider            = aws.us_east_1 # Route53 metrics are ONLY in us-east-1
  alarm_name          = "route53-api-health-check-failed"
  alarm_description   = "API endpoint is failing Route53 health checks"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1.0

  dimensions = {
    HealthCheckId = aws_route53_health_check.api.id
  }
}

variable "domain_name"   { type = string }
variable "api_subdomain" { type = string }
variable "alb_dns_name"  { type = string }
variable "alb_zone_id"   { type = string }

output "zone_id"          { value = data.aws_route53_zone.main.zone_id }
output "api_fqdn"         { value = aws_route53_record.api.fqdn }
output "health_check_id"  { value = aws_route53_health_check.api.id }
