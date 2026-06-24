# ============================================================
# ALB MODULE — Application Load Balancer + Target Groups
# ============================================================

resource "aws_lb" "main" {
  name               = "${var.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection       = true
  enable_cross_zone_load_balancing = true
  enable_http2                     = true

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.bucket
    prefix  = "alb-access-logs"
    enabled = true
  }

  tags = { Name = "${var.name_prefix}-alb" }
}

# S3 bucket for ALB access logs
resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${var.name_prefix}-alb-logs"
  force_destroy = false
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id
  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    filter { prefix = "" }
    expiration { days = 30 }
  }
}

# HTTP → HTTPS redirect
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS listener
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"Not found\"}"
      status_code  = "404"
    }
  }
}

# API listener rule → api target group
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = ["${var.api_subdomain}.${var.domain_name}"]
    }
  }
}

# API target group
resource "aws_lb_target_group" "api" {
  name                 = "${var.name_prefix}-api-tg"
  port                 = 3001
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30 # allow in-flight requests to complete

  health_check {
    enabled             = true
    path                = "/api/v1/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    matcher             = "200"
  }

  stickiness {
    type    = "lb_cookie"
    enabled = false # stateless API — no stickiness needed
  }

  tags = { Name = "${var.name_prefix}-api-tg" }
}

variable "name_prefix"         { type = string }
variable "vpc_id"              { type = string }
variable "public_subnet_ids"   { type = list(string) }
variable "alb_sg_id"           { type = string }
variable "acm_certificate_arn" { type = string }
variable "domain_name"         { type = string }
variable "api_subdomain"       { type = string }

output "alb_arn"              { value = aws_lb.main.arn }
output "alb_dns_name"         { value = aws_lb.main.dns_name }
output "alb_zone_id"          { value = aws_lb.main.zone_id }
output "alb_arn_suffix"       { value = aws_lb.main.arn_suffix }
output "api_target_group_arn" { value = aws_lb_target_group.api.arn }
output "https_listener_arn"   { value = aws_lb_listener.https.arn }
