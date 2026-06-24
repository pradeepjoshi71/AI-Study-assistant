# ============================================================
# PHASE 4.0 — GLOBAL MULTI-REGION TERRAFORM ORCHESTRATOR
# Providers: us-east-1 (primary), eu-west-1, ap-south-1
# Manages: Aurora Global, Redis Global, CloudFront, Route53,
#          EKS clusters, VPC peering, Global Accelerator
# ============================================================

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.14"
    }
  }

  # Remote state — S3 backend with DynamoDB locking (us-east-1)
  backend "s3" {
    bucket         = "ai-platform-terraform-state-global"
    key            = "global/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "ai-platform-terraform-lock"
    encrypt        = true
    kms_key_id     = "alias/terraform-state-key"
  }
}

# ── Provider Aliases per Region ───────────────────────────────────────────────
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project
      ManagedBy   = "terraform"
      Environment = "production"
      Phase       = "4.0-global"
    }
  }
}

provider "aws" {
  alias  = "eu_west_1"
  region = "eu-west-1"

  default_tags {
    tags = {
      Project     = var.project
      ManagedBy   = "terraform"
      Environment = "production"
      Phase       = "4.0-global"
    }
  }
}

provider "aws" {
  alias  = "ap_south_1"
  region = "ap-south-1"

  default_tags {
    tags = {
      Project     = var.project
      ManagedBy   = "terraform"
      Environment = "production"
      Phase       = "4.0-global"
    }
  }
}

# ── Data Sources: Subnet discovery per region ──────────────────────────────────
data "aws_subnets" "us_east_1_private" {
  provider = aws.us_east_1
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
  filter {
    name   = "tag:Project"
    values = [var.project]
  }
}

data "aws_subnets" "eu_west_1_private" {
  provider = aws.eu_west_1
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
  filter {
    name   = "tag:Project"
    values = [var.project]
  }
}

data "aws_subnets" "ap_south_1_private" {
  provider = aws.ap_south_1
  filter {
    name   = "tag:Tier"
    values = ["private"]
  }
  filter {
    name   = "tag:Project"
    values = [var.project]
  }
}

data "aws_caller_identity" "current" {
  provider = aws.us_east_1
}

# ── VPC Peering: us-east-1 <-> eu-west-1 ─────────────────────────────────────
# Required for global service mesh + cross-region internal traffic
resource "aws_vpc_peering_connection" "us_to_eu" {
  provider    = aws.us_east_1
  vpc_id      = var.vpc_id_us_east_1
  peer_vpc_id = var.vpc_id_eu_west_1
  peer_region = "eu-west-1"
  auto_accept = false

  tags = { Name = "${var.project}-peering-us-eu" }
}

resource "aws_vpc_peering_connection_accepter" "us_to_eu_accepter" {
  provider                  = aws.eu_west_1
  vpc_peering_connection_id = aws_vpc_peering_connection.us_to_eu.id
  auto_accept               = true

  tags = { Name = "${var.project}-peering-us-eu-accepter" }
}

# ── VPC Peering: us-east-1 <-> ap-south-1 ────────────────────────────────────
resource "aws_vpc_peering_connection" "us_to_ap" {
  provider    = aws.us_east_1
  vpc_id      = var.vpc_id_us_east_1
  peer_vpc_id = var.vpc_id_ap_south_1
  peer_region = "ap-south-1"
  auto_accept = false

  tags = { Name = "${var.project}-peering-us-ap" }
}

resource "aws_vpc_peering_connection_accepter" "us_to_ap_accepter" {
  provider                  = aws.ap_south_1
  vpc_peering_connection_id = aws_vpc_peering_connection.us_to_ap.id
  auto_accept               = true

  tags = { Name = "${var.project}-peering-us-ap-accepter" }
}

# ── AWS Global Accelerator — Static IPs + Anycast Routing ─────────────────────
resource "aws_globalaccelerator_accelerator" "main" {
  name            = "${var.project}-global-accelerator"
  ip_address_type = "IPV4"
  enabled         = true

  # Bring 2 static Anycast IPs to all users regardless of region
  attributes {
    flow_logs_enabled   = true
    flow_logs_s3_bucket = var.cloudfront_logs_bucket
    flow_logs_s3_prefix = "global-accelerator-flow-logs/"
  }

  tags = { Name = "${var.project}-global-accelerator" }
}

resource "aws_globalaccelerator_listener" "api_https" {
  accelerator_arn = aws_globalaccelerator_accelerator.main.id
  protocol        = "TCP"
  client_affinity = "NONE"   # Stateless — session stickiness via JWT

  port_range {
    from_port = 443
    to_port   = 443
  }
}

# ── Endpoint Groups: 1 per region ─────────────────────────────────────────────
resource "aws_globalaccelerator_endpoint_group" "us_east_1" {
  listener_arn          = aws_globalaccelerator_listener.api_https.id
  endpoint_group_region = "us-east-1"
  traffic_dial_percentage = 100  # Primary: 100% weight by default

  # Health check against /api/health
  health_check_path             = "/api/health"
  health_check_port             = 443
  health_check_protocol         = "HTTPS"
  health_check_interval_seconds = 10
  threshold_count               = 3

  endpoint_configuration {
    endpoint_id = var.alb_arn_us_east_1
    weight      = 100
  }
}

resource "aws_globalaccelerator_endpoint_group" "eu_west_1" {
  listener_arn          = aws_globalaccelerator_listener.api_https.id
  endpoint_group_region = "eu-west-1"
  traffic_dial_percentage = 100

  health_check_path             = "/api/health"
  health_check_port             = 443
  health_check_protocol         = "HTTPS"
  health_check_interval_seconds = 10
  threshold_count               = 3

  endpoint_configuration {
    endpoint_id = var.alb_arn_eu_west_1
    weight      = 100
  }
}

resource "aws_globalaccelerator_endpoint_group" "ap_south_1" {
  listener_arn          = aws_globalaccelerator_listener.api_https.id
  endpoint_group_region = "ap-south-1"
  traffic_dial_percentage = 100

  health_check_path             = "/api/health"
  health_check_port             = 443
  health_check_protocol         = "HTTPS"
  health_check_interval_seconds = 10
  threshold_count               = 3

  endpoint_configuration {
    endpoint_id = var.alb_arn_ap_south_1
    weight      = 100
  }
}

# ── Multi-Region Terraform State Replication ──────────────────────────────────
# S3 Cross-Region Replication for Terraform state backup
resource "aws_s3_bucket_replication_configuration" "state_backup" {
  provider = aws.us_east_1
  bucket   = var.terraform_state_bucket
  role     = aws_iam_role.s3_replication.arn

  rule {
    id     = "replicate-to-eu"
    status = "Enabled"

    destination {
      bucket        = var.terraform_state_bucket_eu_arn
      storage_class = "STANDARD_IA"

      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }
    }
  }
}

# ── Variable declarations ─────────────────────────────────────────────────────
variable "vpc_id_us_east_1" { type = string }
variable "vpc_id_eu_west_1" { type = string }
variable "vpc_id_ap_south_1" { type = string }
variable "alb_arn_us_east_1" { type = string }
variable "alb_arn_eu_west_1" { type = string }
variable "alb_arn_ap_south_1" { type = string }
variable "terraform_state_bucket" { type = string; default = "ai-platform-terraform-state-global" }
variable "terraform_state_bucket_eu_arn" { type = string }

# ── Global Outputs ────────────────────────────────────────────────────────────
output "global_accelerator_static_ips" {
  value       = aws_globalaccelerator_accelerator.main.ip_sets[0].ip_addresses
  description = "Static Anycast IPs — use these in your DNS A records for ultra-low latency"
}

output "global_accelerator_dns" {
  value       = aws_globalaccelerator_accelerator.main.dns_name
  description = "Global Accelerator DNS name"
}

output "vpc_peering_us_eu_id" {
  value = aws_vpc_peering_connection.us_to_eu.id
}

output "vpc_peering_us_ap_id" {
  value = aws_vpc_peering_connection.us_to_ap.id
}
