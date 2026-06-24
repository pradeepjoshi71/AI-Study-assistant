# ============================================================
# AURORA GLOBAL DATABASE CLUSTER
# Active-Active writer in us-east-1
# Read replicas in eu-west-1 and ap-south-1
# RPO < 1 minute via binlog replication
# ============================================================

# ── Primary cluster (us-east-1) ───────────────────────────────────────────────
resource "aws_rds_global_cluster" "main" {
  global_cluster_identifier = "${var.project}-global-aurora"
  engine                    = "aurora-postgresql"
  engine_version            = "16.2"
  database_name             = "ai_platform"
  storage_encrypted         = true   # AES-256 at rest
  deletion_protection       = true   # Prevent accidental drops
}

resource "aws_rds_cluster" "primary" {
  provider = aws.us_east_1

  cluster_identifier        = "${var.project}-aurora-primary"
  engine                    = "aurora-postgresql"
  engine_mode               = "provisioned"
  engine_version            = "16.2"
  global_cluster_identifier = aws_rds_global_cluster.main.id

  database_name   = "ai_platform"
  master_username = var.db_master_username
  master_password = var.db_master_password

  # Multi-AZ automatic failover within us-east-1
  availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
  db_subnet_group_name = aws_db_subnet_group.us_east_1.name

  # Performance Insights for query analytics
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.rds.arn

  # Automated backups — 35-day retention, continuous to S3
  backup_retention_period   = var.backup_retention_days
  preferred_backup_window   = "02:00-03:00"      # UTC
  preferred_maintenance_window = "sun:03:00-sun:04:00"

  # Enable auto minor version upgrades
  auto_minor_version_upgrade = true

  # Enhanced monitoring (60-second granularity)
  monitoring_interval = 60

  # Serverless v2 scaling for cost efficiency at off-peak
  serverlessv2_scaling_configuration {
    min_capacity = 0.5   # ~0.5 ACU at idle
    max_capacity = 128   # Scales to 128 ACU under 1M user load
  }

  # IAM database authentication (no passwords in app layer)
  iam_database_authentication_enabled = true

  tags = {
    Name        = "${var.project}-aurora-primary"
    Region      = "us-east-1"
    Role        = "writer"
    Environment = "production"
    ManagedBy   = "terraform"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ── Aurora instances in primary region ────────────────────────────────────────
resource "aws_rds_cluster_instance" "primary_writer" {
  provider = aws.us_east_1

  identifier         = "${var.project}-aurora-writer-1"
  cluster_identifier = aws_rds_cluster.primary.id
  instance_class     = "db.serverless"  # Uses Serverless v2 scaling
  engine             = "aurora-postgresql"
  engine_version     = "16.2"

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = { Role = "writer" }
}

resource "aws_rds_cluster_instance" "primary_readers" {
  provider = aws.us_east_1

  count              = var.aurora_reader_count_per_region
  identifier         = "${var.project}-aurora-reader-us-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.primary.id
  instance_class     = "db.serverless"
  engine             = "aurora-postgresql"
  engine_version     = "16.2"

  # Route read-only analytics queries to replicas
  promotion_tier = 2

  performance_insights_enabled = true

  tags = { Role = "reader", Region = "us-east-1" }
}

# ── EU-West-1 secondary cluster ───────────────────────────────────────────────
resource "aws_rds_cluster" "eu_west_1" {
  provider = aws.eu_west_1

  cluster_identifier        = "${var.project}-aurora-eu-west-1"
  engine                    = "aurora-postgresql"
  engine_mode               = "provisioned"
  engine_version            = "16.2"
  global_cluster_identifier = aws_rds_global_cluster.main.id

  db_subnet_group_name = aws_db_subnet_group.eu_west_1.name

  backup_retention_period      = 7
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${var.project}-eu-west-1-final-snapshot"

  # Read-only — writes promoted automatically on failover
  iam_database_authentication_enabled = true

  tags = {
    Name        = "${var.project}-aurora-eu-west-1"
    Region      = "eu-west-1"
    Role        = "replica"
    Environment = "production"
  }

  depends_on = [aws_rds_cluster.primary]
}

resource "aws_rds_cluster_instance" "eu_west_1_readers" {
  provider = aws.eu_west_1

  count              = var.aurora_reader_count_per_region
  identifier         = "${var.project}-aurora-reader-eu-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.eu_west_1.id
  instance_class     = "db.serverless"
  engine             = "aurora-postgresql"
  engine_version     = "16.2"

  tags = { Role = "reader", Region = "eu-west-1" }
}

# ── AP-South-1 secondary cluster ──────────────────────────────────────────────
resource "aws_rds_cluster" "ap_south_1" {
  provider = aws.ap_south_1

  cluster_identifier        = "${var.project}-aurora-ap-south-1"
  engine                    = "aurora-postgresql"
  engine_mode               = "provisioned"
  engine_version            = "16.2"
  global_cluster_identifier = aws_rds_global_cluster.main.id

  db_subnet_group_name = aws_db_subnet_group.ap_south_1.name

  backup_retention_period   = 7
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-ap-south-1-final-snapshot"

  iam_database_authentication_enabled = true

  tags = {
    Name        = "${var.project}-aurora-ap-south-1"
    Region      = "ap-south-1"
    Role        = "replica"
    Environment = "production"
  }

  depends_on = [aws_rds_cluster.primary]
}

resource "aws_rds_cluster_instance" "ap_south_1_readers" {
  provider = aws.ap_south_1

  count              = var.aurora_reader_count_per_region
  identifier         = "${var.project}-aurora-reader-ap-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.ap_south_1.id
  instance_class     = "db.serverless"
  engine             = "aurora-postgresql"
  engine_version     = "16.2"

  tags = { Role = "reader", Region = "ap-south-1" }
}

# ── KMS key for RDS encryption ─────────────────────────────────────────────
resource "aws_kms_key" "rds" {
  provider = aws.us_east_1

  description             = "${var.project} RDS Aurora encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true  # Annual rotation

  tags = { Name = "${var.project}-rds-kms" }
}

# ── DB Subnet Groups per region ───────────────────────────────────────────────
resource "aws_db_subnet_group" "us_east_1" {
  provider   = aws.us_east_1
  name       = "${var.project}-db-subnet-us-east-1"
  subnet_ids = data.aws_subnets.us_east_1_private.ids

  tags = { Name = "${var.project}-db-subnet-us-east-1" }
}

resource "aws_db_subnet_group" "eu_west_1" {
  provider   = aws.eu_west_1
  name       = "${var.project}-db-subnet-eu-west-1"
  subnet_ids = data.aws_subnets.eu_west_1_private.ids

  tags = { Name = "${var.project}-db-subnet-eu-west-1" }
}

resource "aws_db_subnet_group" "ap_south_1" {
  provider   = aws.ap_south_1
  name       = "${var.project}-db-subnet-ap-south-1"
  subnet_ids = data.aws_subnets.ap_south_1_private.ids

  tags = { Name = "${var.project}-db-subnet-ap-south-1" }
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "aurora_global_cluster_arn" {
  value       = aws_rds_global_cluster.main.arn
  description = "Aurora Global Cluster ARN for cross-region monitoring"
}

output "aurora_primary_endpoint" {
  value       = aws_rds_cluster.primary.endpoint
  description = "Writer endpoint (us-east-1) — use for transactional writes only"
}

output "aurora_primary_reader_endpoint" {
  value       = aws_rds_cluster.primary.reader_endpoint
  description = "Reader endpoint — auto load-balances across replicas"
}

output "aurora_eu_reader_endpoint" {
  value       = aws_rds_cluster.eu_west_1.reader_endpoint
  description = "EU-West-1 reader endpoint — low-latency reads for EU users"
}

output "aurora_ap_reader_endpoint" {
  value       = aws_rds_cluster.ap_south_1.reader_endpoint
  description = "AP-South-1 reader endpoint — low-latency reads for Asia users"
}
