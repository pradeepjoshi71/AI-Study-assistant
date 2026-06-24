# ============================================================
# ECR MODULE — Container registries for all services
# ============================================================

resource "aws_ecr_repository" "services" {
  for_each             = toset(var.services)
  name                 = "${var.name_prefix}/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true # ← automatic vulnerability scanning on every push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${var.name_prefix}-${each.key}" }
}

# Lifecycle policy: keep last 10 tagged + auto-delete untagged after 1 day
resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Remove untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep last 10 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "sha-", "latest"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

# Allow ECS task execution role to pull images
data "aws_iam_policy_document" "ecr_cross_account_policy" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = [
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:BatchCheckLayerAvailability"
    ]
  }
}

variable "name_prefix" { type = string }
variable "services"    { type = list(string) }

output "repository_urls" {
  value = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}

output "repository_arns" {
  value = { for k, v in aws_ecr_repository.services : k => v.arn }
}
