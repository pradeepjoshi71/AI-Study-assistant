# ============================================================
# RDS MODULE — PostgreSQL Multi-AZ + Read Replica + PgBouncer
# ============================================================

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db-subnet-group"
  subnet_ids = var.db_subnet_ids
  tags       = { Name = "${var.name_prefix}-db-subnet-group" }
}

# DB Parameter Group — optimized for production
resource "aws_db_parameter_group" "main" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # log queries > 1 second
  }
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }
  parameter {
    name  = "pg_stat_statements.track"
    value = "all"
  }
  parameter {
    name         = "max_connections"
    value        = "200"
    apply_method = "pending-reboot"
  }
}

# Primary RDS Instance (Multi-AZ)
resource "aws_db_instance" "primary" {
  identifier = "${var.name_prefix}-postgres-primary"

  # Engine
  engine               = "postgres"
  engine_version       = "16.3"
  instance_class       = var.db_instance_class
  parameter_group_name = aws_db_parameter_group.main.name

  # Storage
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage # Storage autoscaling
  storage_type          = "gp3"
  storage_encrypted     = true

  # Auth
  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_sg_id]
  publicly_accessible    = false

  # HA
  multi_az = true # Synchronous standby in another AZ

  # Backup
  backup_retention_period   = 7
  backup_window             = "02:00-03:00" # 02:00-03:00 UTC (07:30-08:30 IST)
  maintenance_window        = "sun:03:00-sun:04:00"
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-postgres-final-snapshot"

  # Monitoring
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_enhanced_monitoring.arn
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = true
  performance_insights_retention_period = 7

  # Auto minor version upgrades during maintenance window
  auto_minor_version_upgrade = true

  tags = { Name = "${var.name_prefix}-postgres-primary" }
}

# Read Replica (for scaling read-heavy queries)
resource "aws_db_instance" "read_replica" {
  count = var.db_read_replica_count

  identifier          = "${var.name_prefix}-postgres-replica-${count.index}"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.db_instance_class
  storage_encrypted   = true

  vpc_security_group_ids = [var.rds_sg_id]
  publicly_accessible    = false

  # No backup needed on replica (covered by primary)
  backup_retention_period = 0
  skip_final_snapshot     = true

  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_enhanced_monitoring.arn
  performance_insights_enabled = true

  auto_minor_version_upgrade = true

  tags = { Name = "${var.name_prefix}-postgres-replica-${count.index}" }
}

# Enhanced monitoring IAM role
resource "aws_iam_role" "rds_enhanced_monitoring" {
  name = "${var.name_prefix}-rds-monitoring-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  role       = aws_iam_role.rds_enhanced_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Automated backups to S3 via AWS Backup
resource "aws_backup_plan" "rds" {
  name = "${var.name_prefix}-rds-backup-plan"

  rule {
    rule_name         = "daily-backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 2 * * ? *)" # Daily at 02:00 UTC

    lifecycle {
      delete_after = 30 # Retain 30 days
    }
  }

  rule {
    rule_name         = "weekly-backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 3 ? * SUN *)" # Weekly on Sunday

    lifecycle {
      cold_storage_after = 7  # Move to Glacier after 7 days
      delete_after       = 90 # Retain 90 days
    }
  }
}

resource "aws_backup_vault" "main" {
  name = "${var.name_prefix}-backup-vault"
}

resource "aws_backup_selection" "rds" {
  iam_role_arn = aws_iam_role.backup.arn
  name         = "${var.name_prefix}-rds-backup-selection"
  plan_id      = aws_backup_plan.rds.id

  resources = [aws_db_instance.primary.arn]
}

resource "aws_iam_role" "backup" {
  name = "${var.name_prefix}-backup-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

variable "name_prefix"              { type = string }
variable "db_subnet_ids"            { type = list(string) }
variable "rds_sg_id"                { type = string }
variable "db_instance_class"        { type = string }
variable "db_allocated_storage"     { type = number }
variable "db_max_allocated_storage" { type = number }
variable "db_name"                  { type = string }
variable "db_username"              { type = string; sensitive = true }
variable "db_password"              { type = string; sensitive = true }
variable "db_read_replica_count"    { type = number }

output "primary_endpoint"      { value = aws_db_instance.primary.endpoint; sensitive = true }
output "read_replica_endpoint" { value = length(aws_db_instance.read_replica) > 0 ? aws_db_instance.read_replica[0].endpoint : ""; sensitive = true }
output "db_identifier"         { value = aws_db_instance.primary.identifier }
