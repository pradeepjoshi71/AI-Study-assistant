# ============================================================
# WAF MODULE — AWS WAF v2 on ALB
# ============================================================

resource "aws_wafv2_web_acl" "main" {
  name        = "${var.name_prefix}-waf"
  description = "WAF for AI Study Assistant ALB"
  scope       = "REGIONAL" # REGIONAL for ALB; CLOUDFRONT for edge

  default_action {
    allow {}
  }

  # Rule 1: AWS Managed Common Rule Set (covers OWASP Top 10)
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
      metric_name                = "${var.name_prefix}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  # Rule 2: Rate limiting — 1000 requests per 5 min per IP
  rule {
    name     = "RateLimitRule"
    priority = 2

    action { block {} }

    statement {
      rate_based_statement {
        limit              = 1000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Rule 3: Stricter rate limit on AI endpoints (expensive)
  rule {
    name     = "AIEndpointRateLimit"
    priority = 3

    action { block {} }

    statement {
      rate_based_statement {
        limit              = 100
        aggregate_key_type = "IP"

        scope_down_statement {
          byte_match_statement {
            search_string = "/api/v1/chat"
            field_to_match { uri_path {} }
            text_transformation { priority = 0; type = "NONE" }
            positional_constraint = "STARTS_WITH"
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-ai-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Rule 4: Block known bad IPs (AWS Managed IP reputation)
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 4

    override_action { none {} }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # Rule 5: SQL Injection protection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 5

    override_action { none {} }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-sqli-rules"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-waf"
    sampled_requests_enabled   = true
  }
}

# Associate WAF with ALB
resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# WAF logging to S3
resource "aws_wafv2_web_acl_logging_configuration" "main" {
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  resource_arn            = aws_wafv2_web_acl.main.arn
}

resource "aws_cloudwatch_log_group" "waf" {
  name              = "/aws/wafv2/${var.name_prefix}"
  retention_in_days = 30
}

variable "name_prefix" { type = string }
variable "alb_arn"     { type = string }

output "web_acl_id"  { value = aws_wafv2_web_acl.main.id }
output "web_acl_arn" { value = aws_wafv2_web_acl.main.arn }
