# ============================================================
# CLOUDFRONT GLOBAL CDN
# Edge caching for Next.js frontend + static assets
# WAF integration + CloudFront security headers
# Supports 400+ PoPs globally for < 50ms TTFB
# ============================================================

# ── CloudFront Origin Access Control (OAC) ───────────────────────────────────
resource "aws_cloudfront_origin_access_control" "s3_oac" {
  name                              = "${var.project}-s3-oac"
  description                       = "OAC for S3 static assets — blocks direct S3 access"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront Security Headers Policy ───────────────────────────────────────
resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "${var.project}-security-headers"

  security_headers_config {
    # Strict HTTPS enforcement (2 years + preload)
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    # Prevent MIME-type sniffing
    content_type_options {
      override = true
    }

    # Clickjacking prevention
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # XSS protection
    xss_protection {
      mode_block  = true
      protection  = true
      override    = true
    }

    # Referrer policy
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
  }
}

# ── Cache Policy: API (short TTL) ─────────────────────────────────────────────
resource "aws_cloudfront_cache_policy" "api_cache" {
  name    = "${var.project}-api-cache"
  comment = "Short TTL cache policy for API responses"

  default_ttl = 0      # Don't cache by default
  max_ttl     = 30     # Max 30s for cacheable API endpoints
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization", "Accept-Language", "X-Tenant-ID"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

# ── Cache Policy: Static Assets (long TTL) ───────────────────────────────────
resource "aws_cloudfront_cache_policy" "static_cache" {
  name    = "${var.project}-static-cache"
  comment = "Long TTL cache policy for immutable static assets"

  default_ttl = 86400    # 1 day
  max_ttl     = 31536000 # 1 year (immutable files hashed by webpack)
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# ── CloudFront Distribution ───────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "main" {
  # Wait for WAF to be in us-east-1 (required for CloudFront WAF)
  web_acl_id = aws_wafv2_web_acl.cloudfront.arn

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  comment             = "${var.project} global CDN distribution"

  # Custom domain aliases
  aliases = [
    "app.${var.domain_name}",
    var.domain_name,
    "www.${var.domain_name}",
  ]

  # ── Origin 1: Next.js App (ALB — us-east-1 primary) ────────────────────────
  origin {
    origin_id   = "nextjs-origin"
    domain_name = var.alb_dns_us_east_1

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]

      # Origin keepalive / read timeout
      origin_keepalive_timeout = 60
      origin_read_timeout      = 60
    }

    custom_header {
      name  = "X-CloudFront-Secret"
      value = var.cloudfront_origin_secret  # ALB verifies this header
    }
  }

  # ── Origin 2: S3 Static Assets ───────────────────────────────────────────
  origin {
    origin_id                = "s3-static-origin"
    domain_name              = var.s3_static_bucket_regional_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.s3_oac.id
  }

  # ── Default Behavior: Next.js App ─────────────────────────────────────────
  default_cache_behavior {
    target_origin_id       = "nextjs-origin"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    viewer_protocol_policy = "redirect-to-https"

    cache_policy_id            = aws_cloudfront_cache_policy.api_cache.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    # Enable Brotli + Gzip compression
    compress = true

    # Real-time logs for analytics
    realtime_log_config_arn = aws_cloudfront_realtime_log_config.main.arn
  }

  # ── /_next/static/* — Immutable assets, long cache ────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "s3-static-origin"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    cache_policy_id = aws_cloudfront_cache_policy.static_cache.id
  }

  # ── /assets/* — User-uploaded content (documents, images) ─────────────────
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "s3-static-origin"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    cache_policy_id = aws_cloudfront_cache_policy.static_cache.id
  }

  # ── TLS Configuration ────────────────────────────────────────────────────
  viewer_certificate {
    acm_certificate_arn            = var.acm_certificate_arn_us_east_1  # Must be in us-east-1
    ssl_support_method             = "sni-only"
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  # ── Geo Restriction: None (global access) ──────────────────────────────────
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # ── Access Logs to S3 ────────────────────────────────────────────────────
  logging_config {
    bucket          = var.cloudfront_logs_bucket
    include_cookies = false
    prefix          = "cloudfront-access-logs/"
  }

  tags = {
    Name        = "${var.project}-cdn"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

# ── Real-Time Log Configuration (for latency + cache-hit metrics) ─────────────
resource "aws_cloudfront_realtime_log_config" "main" {
  name          = "${var.project}-realtime-logs"
  sampling_rate = 1   # 1% sampling (adjust per cost target)

  endpoint {
    stream_type = "Kinesis"
    kinesis_stream_config {
      role_arn   = aws_iam_role.cloudfront_logs.arn
      stream_arn = aws_kinesis_stream.cloudfront_logs.arn
    }
  }

  fields = [
    "timestamp", "c-ip", "sc-status", "cs-method", "cs-uri-stem",
    "cs-bytes", "time-taken", "x-edge-location", "x-edge-result-type",
    "cs-protocol", "sc-bytes", "x-cache", "x-forwarded-for",
  ]
}

resource "aws_kinesis_stream" "cloudfront_logs" {
  name             = "${var.project}-cloudfront-access-logs"
  shard_count      = 2
  retention_period = 24   # 24-hour retention before processing

  stream_mode_details {
    stream_mode = "PROVISIONED"
  }

  tags = { Name = "${var.project}-cf-logs" }
}

# ── WAF WebACL for CloudFront (must be in us-east-1) ─────────────────────────
resource "aws_wafv2_web_acl" "cloudfront" {
  provider = aws.us_east_1

  name  = "${var.project}-cloudfront-waf"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # AWS Managed Rules — Core Rule Set (OWASP Top 10)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # Bot Control
  rule {
    name     = "AWSManagedRulesBotControlRuleSet"
    priority = 2
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesBotControlRuleSet"
        vendor_name = "AWS"
        managed_rule_group_configs {
          aws_managed_rules_bot_control_rule_set {
            inspection_level = "COMMON"
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "BotControl"
      sampled_requests_enabled   = true
    }
  }

  # Rate limiting — 2000 req/5min per IP
  rule {
    name     = "RateLimitByIP"
    priority = 3
    action { block {} }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-cloudfront-waf"
    sampled_requests_enabled   = true
  }

  tags = { Name = "${var.project}-cloudfront-waf" }
}

# ── Variable declarations ─────────────────────────────────────────────────────
variable "acm_certificate_arn_us_east_1" { type = string }
variable "s3_static_bucket_regional_domain" { type = string }
variable "cloudfront_origin_secret" { type = string; sensitive = true }
variable "cloudfront_logs_bucket" { type = string }

# ── Outputs ───────────────────────────────────────────────────────────────────
output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.main.id
  description = "CloudFront distribution ID — needed for cache invalidation in CI/CD"
}

output "cloudfront_distribution_domain_name" {
  value       = aws_cloudfront_distribution.main.domain_name
  description = "CloudFront CNAME — set Route53 alias to this"
}
