output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "alb_dns_name" {
  description = "ALB public DNS — point your domain CNAME here"
  value       = module.alb.alb_dns_name
}

output "api_ecr_repository_url" {
  description = "ECR URL for api image pushes"
  value       = module.ecr.repository_urls["api"]
}

output "ai_service_ecr_repository_url" {
  description = "ECR URL for ai-service image pushes"
  value       = module.ecr.repository_urls["ai-service"]
}

output "worker_ecr_repository_url" {
  description = "ECR URL for worker image pushes"
  value       = module.ecr.repository_urls["worker"]
}

output "rds_endpoint" {
  description = "RDS PostgreSQL primary endpoint"
  value       = module.rds.primary_endpoint
  sensitive   = true
}

output "rds_read_replica_endpoint" {
  description = "RDS read replica endpoint"
  value       = module.rds.read_replica_endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = module.elasticache.primary_endpoint
  sensitive   = true
}

output "ecs_cluster_name" {
  description = "ECS cluster name (needed for CI/CD deploy commands)"
  value       = module.ecs.cluster_name
}

output "api_service_name" {
  description = "ECS api service name"
  value       = module.ecs.api_service_name
}

output "ai_service_name" {
  description = "ECS ai service name"
  value       = module.ecs.ai_service_name
}

output "worker_service_name" {
  description = "ECS worker service name"
  value       = module.ecs.worker_service_name
}

output "s3_bucket_name" {
  description = "S3 document storage bucket"
  value       = module.s3.bucket_name
}

output "cloudwatch_dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${module.cloudwatch.dashboard_name}"
}
