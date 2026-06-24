terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state in S3 — bootstrap this manually once
  backend "s3" {
    bucket         = "ai-study-assistant-tfstate"
    key            = "global/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "ai-study-assistant-tflock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ai-study-assistant"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

# Secondary provider for us-east-1 (ACM certs for CloudFront MUST be in us-east-1)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "ai-study-assistant"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}
