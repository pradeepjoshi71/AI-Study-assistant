# ============================================================
# IAM MODULE — Roles and Policies for ECS services
# ============================================================

# ─── ECS Task Execution Role (shared) ─────────────────────
# Allows ECS to pull images from ECR and write logs to CloudWatch

resource "aws_iam_role" "ecs_execution" {
  name = "${var.name_prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_policy" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to read secrets from Secrets Manager
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.name_prefix}-execution-secrets-policy"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "ssm:GetParameters",
          "kms:Decrypt"
        ]
        Resource = [
          var.gemini_api_key_secret_arn,
          var.jwt_secret_arn,
          "arn:aws:secretsmanager:${var.aws_region}:${var.account_id}:secret:${var.name_prefix}/*"
        ]
      }
    ]
  })
}

# ─── API Task Role ─────────────────────────────────────────
# What the NestJS container CAN DO while running

resource "aws_iam_role" "api_task" {
  name = "${var.name_prefix}-api-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "api_task_policy" {
  name = "${var.name_prefix}-api-task-policy"
  role = aws_iam_role.api_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 access for document uploads/reads
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [var.s3_bucket_arn, "${var.s3_bucket_arn}/*"]
      },
      # CloudWatch custom metrics
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = "${var.name_prefix}/Application" }
        }
      },
      # X-Ray tracing
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      # ECS Exec (SSM — for debugging into containers)
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      }
    ]
  })
}

# ─── AI Task Role ──────────────────────────────────────────

resource "aws_iam_role" "ai_task" {
  name = "${var.name_prefix}-ai-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ai_task_policy" {
  name = "${var.name_prefix}-ai-task-policy"
  role = aws_iam_role.ai_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # S3 — read processed chunks, write embeddings results
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
        Resource = [var.s3_bucket_arn, "${var.s3_bucket_arn}/*"]
      },
      # CloudWatch + X-Ray
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData", "xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      # ECS Exec
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel"
        ]
        Resource = "*"
      }
    ]
  })
}

# ─── GitHub Actions OIDC Role ──────────────────────────────
# Allows GitHub Actions to deploy without long-lived access keys

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "github_actions_deploy" {
  name = "${var.name_prefix}-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = data.aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # Restrict to your repo only!
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${var.name_prefix}-github-actions-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # ECR — push images
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = "arn:aws:ecr:${var.aws_region}:${var.account_id}:repository/${var.name_prefix}/*"
      },
      # ECS — update services
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:RegisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTaskDefinitions"
        ]
        Resource = "*"
      },
      # IAM PassRole for task definitions
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_execution.arn,
          aws_iam_role.api_task.arn,
          aws_iam_role.ai_task.arn
        ]
      }
    ]
  })
}

variable "name_prefix"              { type = string }
variable "account_id"               { type = string }
variable "aws_region"               { type = string }
variable "gemini_api_key_secret_arn"{ type = string }
variable "jwt_secret_arn"           { type = string }
variable "s3_bucket_arn"            { type = string }
variable "github_org"               { type = string; default = "YOUR_GITHUB_ORG" }
variable "github_repo"              { type = string; default = "AI-Study-assistant" }

output "ecs_execution_role_arn"      { value = aws_iam_role.ecs_execution.arn }
output "api_task_role_arn"           { value = aws_iam_role.api_task.arn }
output "ai_task_role_arn"            { value = aws_iam_role.ai_task.arn }
output "github_actions_deploy_role_arn" { value = aws_iam_role.github_actions_deploy.arn }
