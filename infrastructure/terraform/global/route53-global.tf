# ============================================================
# ROUTE53 GLOBAL LATENCY-BASED ROUTING
# Traffic steered to closest region by latency measurement
# Automatic failover with health checks
# ============================================================

# ── Primary Hosted Zone ───────────────────────────────────────────────────────
data "aws_route53_zone" "primary" {
  name         = var.domain_name
  private_zone = false
}

# ── Health Checks per Region ──────────────────────────────────────────────────
resource "aws_route53_health_check" "us_east_1" {
  fqdn              = "api-us.${var.domain_name}"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 10  # 10-second intervals for fast failover
  measure_latency   = true
  regions           = ["us-east-1", "eu-west-1", "ap-southeast-1"]

  tags = {
    Name   = "${var.project}-health-us-east-1"
    Region = "us-east-1"
  }
}

resource "aws_route53_health_check" "eu_west_1" {
  fqdn              = "api-eu.${var.domain_name}"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 10
  measure_latency   = true
  regions           = ["us-east-1", "eu-west-1", "ap-southeast-1"]

  tags = {
    Name   = "${var.project}-health-eu-west-1"
    Region = "eu-west-1"
  }
}

resource "aws_route53_health_check" "ap_south_1" {
  fqdn              = "api-ap.${var.domain_name}"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 10
  measure_latency   = true
  regions           = ["us-east-1", "eu-west-1", "ap-southeast-1"]

  tags = {
    Name   = "${var.project}-health-ap-south-1"
    Region = "ap-south-1"
  }
}

# ── Latency-Based Records for api.domain.com ─────────────────────────────────
# US-East-1 API
resource "aws_route53_record" "api_us_east_1" {
  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = "api.${var.domain_name}"
  type            = "A"
  set_identifier  = "us-east-1"

  latency_routing_policy {
    region = "us-east-1"
  }

  health_check_id = aws_route53_health_check.us_east_1.id

  alias {
    name                   = var.alb_dns_us_east_1
    zone_id                = var.alb_zone_id_us_east_1
    evaluate_target_health = true
  }
}

# EU-West-1 API
resource "aws_route53_record" "api_eu_west_1" {
  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = "api.${var.domain_name}"
  type            = "A"
  set_identifier  = "eu-west-1"

  latency_routing_policy {
    region = "eu-west-1"
  }

  health_check_id = aws_route53_health_check.eu_west_1.id

  alias {
    name                   = var.alb_dns_eu_west_1
    zone_id                = var.alb_zone_id_eu_west_1
    evaluate_target_health = true
  }
}

# AP-South-1 API
resource "aws_route53_record" "api_ap_south_1" {
  zone_id         = data.aws_route53_zone.primary.zone_id
  name            = "api.${var.domain_name}"
  type            = "A"
  set_identifier  = "ap-south-1"

  latency_routing_policy {
    region = "ap-south-1"
  }

  health_check_id = aws_route53_health_check.ap_south_1.id

  alias {
    name                   = var.alb_dns_ap_south_1
    zone_id                = var.alb_zone_id_ap_south_1
    evaluate_target_health = true
  }
}

# ── CloudFront CNAME for app.domain.com ───────────────────────────────────────
resource "aws_route53_record" "app_cloudfront" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "app.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = [var.cloudfront_distribution_domain]
}

# ── Region-Specific Subdomains (for debugging and observability) ──────────────
resource "aws_route53_record" "api_us_direct" {
  provider = aws.us_east_1
  zone_id  = data.aws_route53_zone.primary.zone_id
  name     = "api-us.${var.domain_name}"
  type     = "A"
  alias {
    name                   = var.alb_dns_us_east_1
    zone_id                = var.alb_zone_id_us_east_1
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api_eu_direct" {
  provider = aws.eu_west_1
  zone_id  = data.aws_route53_zone.primary.zone_id
  name     = "api-eu.${var.domain_name}"
  type     = "A"
  alias {
    name                   = var.alb_dns_eu_west_1
    zone_id                = var.alb_zone_id_eu_west_1
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api_ap_direct" {
  provider = aws.ap_south_1
  zone_id  = data.aws_route53_zone.primary.zone_id
  name     = "api-ap.${var.domain_name}"
  type     = "A"
  alias {
    name                   = var.alb_dns_ap_south_1
    zone_id                = var.alb_zone_id_ap_south_1
    evaluate_target_health = true
  }
}

# ── Route53 Alarm: Endpoint Health Degradation ───────────────────────────────
resource "aws_cloudwatch_metric_alarm" "health_check_us" {
  alarm_name          = "${var.project}-health-check-us-east-1"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1

  dimensions = {
    HealthCheckId = aws_route53_health_check.us_east_1.id
  }

  alarm_description = "US-East-1 API endpoint health check FAILED — triggering region failover"
  alarm_actions     = [var.pagerduty_sns_arn]
}

# ── Variable declarations for ALB outputs ────────────────────────────────────
variable "alb_dns_us_east_1" { type = string }
variable "alb_zone_id_us_east_1" { type = string }
variable "alb_dns_eu_west_1" { type = string }
variable "alb_zone_id_eu_west_1" { type = string }
variable "alb_dns_ap_south_1" { type = string }
variable "alb_zone_id_ap_south_1" { type = string }
variable "cloudfront_distribution_domain" { type = string }
variable "pagerduty_sns_arn" { type = string }
