# ============================================================
# S3 MODULE — Document storage, backups, lifecycle rules
# ============================================================

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "documents" {
  bucket = "${var.name_prefix}-documents-${random_id.bucket_suffix.hex}"

  tags = { Name = "${var.name_prefix}-documents" }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled" # protect against accidental deletion
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms" # KMS encryption
    }
    bucket_key_enabled = true # reduces KMS costs
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "processed-chunks-archive"
    status = "Enabled"

    filter { prefix = "processed/" }

    transition {
      days          = 90
      storage_class = "STANDARD_IA" # Infrequent Access after 90 days
    }
    transition {
      days          = 365
      storage_class = "GLACIER" # Archive after 1 year
    }
    expiration {
      days = 1825 # Delete after 5 years
    }
  }

  rule {
    id     = "temp-uploads-cleanup"
    status = "Enabled"

    filter { prefix = "uploads/temp/" }

    expiration {
      days = 1 # Delete temp files after 24h
    }
  }

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter { prefix = "" }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# CORS configuration for direct frontend uploads
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["https://${var.environment == "production" ? "app" : "staging"}.${var.domain_name}"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

variable "name_prefix"  { type = string }
variable "environment"  { type = string }
variable "domain_name"  { type = string; default = "example.com" }

output "bucket_name" { value = aws_s3_bucket.documents.bucket }
output "bucket_arn"  { value = aws_s3_bucket.documents.arn }
