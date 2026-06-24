# ============================================================
# EFS MODULE — Elastic File System for Qdrant persistent storage
# ============================================================

resource "aws_efs_file_system" "qdrant" {
  creation_token   = "${var.name_prefix}-qdrant-efs"
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"
  encrypted        = true

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS" # Move cold files to IA after 30 days
  }

  tags = { Name = "${var.name_prefix}-qdrant-efs" }
}

# Mount targets — one per private subnet AZ
resource "aws_efs_mount_target" "qdrant" {
  count           = length(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.qdrant.id
  subnet_id       = var.private_subnet_ids[count.index]
  security_groups = [var.efs_sg_id]
}

# EFS Access Point for Qdrant storage path
resource "aws_efs_access_point" "qdrant" {
  file_system_id = aws_efs_file_system.qdrant.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/qdrant/storage"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${var.name_prefix}-qdrant-ap" }
}

variable "name_prefix"        { type = string }
variable "vpc_id"             { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "efs_sg_id"          { type = string }

output "volume_id"         { value = aws_efs_file_system.qdrant.id }
output "access_point_id"   { value = aws_efs_access_point.qdrant.id }
output "dns_name"          { value = aws_efs_file_system.qdrant.dns_name }
