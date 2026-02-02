# MCP Infrastructure - AWS Secrets Manager & IAM

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Variables
variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "crm_provider" {
  description = "CRM provider to use (salesforce, hubspot, mock)"
  type        = string
  default     = "salesforce"
}

variable "redis_url" {
  description = "Redis URL for rate limiting and idempotency"
  type        = string
  default     = ""
  sensitive   = true
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project = "lead-to-revenue-catalyst"
    ManagedBy = "terraform"
  }
}

# Locals
locals {
  secret_name_prefix = "mcp/${var.environment}"
  ecs_task_role_name = "mcp-ecs-task-role-${var.environment}"
}

# ============================================================================
# AWS Secrets Manager - CRM Credentials
# ============================================================================

# Salesforce Credentials Secret
resource "aws_secretsmanager_secret" "salesforce_credentials" {
  count       = var.crm_provider == "salesforce" ? 1 : 0
  name        = "${local.secret_name_prefix}/crm/salesforce"
  description = "Salesforce CRM credentials for MCP layer"
  
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
  
  tags = merge(var.tags, {
    Component = "mcp-secrets"
    CRMProvider = "salesforce"
  })
}

resource "aws_secretsmanager_secret_version" "salesforce_credentials" {
  count     = var.crm_provider == "salesforce" ? 1 : 0
  secret_id = aws_secretsmanager_secret.salesforce_credentials[0].id
  
  # Initial placeholder - actual values set manually or via CI/CD
  secret_string = jsonencode({
    client_id     = "PLACEHOLDER_CLIENT_ID"
    client_secret = "PLACEHOLDER_CLIENT_SECRET"
    username      = "PLACEHOLDER_USERNAME"
    password      = "PLACEHOLDER_PASSWORD"
    security_token = "PLACEHOLDER_SECURITY_TOKEN"
    login_url     = "https://login.salesforce.com"
    instance_url  = ""
  })
  
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# HubSpot Credentials Secret (optional)
resource "aws_secretsmanager_secret" "hubspot_credentials" {
  count       = var.crm_provider == "hubspot" ? 1 : 0
  name        = "${local.secret_name_prefix}/crm/hubspot"
  description = "HubSpot CRM credentials for MCP layer"
  
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
  
  tags = merge(var.tags, {
    Component = "mcp-secrets"
    CRMProvider = "hubspot"
  })
}

resource "aws_secretsmanager_secret_version" "hubspot_credentials" {
  count     = var.crm_provider == "hubspot" ? 1 : 0
  secret_id = aws_secretsmanager_secret.hubspot_credentials[0].id
  
  secret_string = jsonencode({
    api_key    = "PLACEHOLDER_API_KEY"
    portal_id  = "PLACEHOLDER_PORTAL_ID"
  })
  
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ============================================================================
# IAM - ECS Task Role
# ============================================================================

# Trust policy for ECS tasks
data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    effect = "Allow"
    
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    
    actions = ["sts:AssumeRole"]
  }
}

# ECS Task Role
resource "aws_iam_role" "ecs_task_role" {
  name               = local.ecs_task_role_name
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
  
  tags = merge(var.tags, {
    Component = "mcp-iam"
  })
}

# Secrets Manager access policy
data "aws_iam_policy_document" "secrets_access" {
  statement {
    effect = "Allow"
    
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret"
    ]
    
    resources = [
      "arn:aws:secretsmanager:*:*:secret:${local.secret_name_prefix}/*"
    ]
  }
  
  # Allow KMS decryption if secrets are encrypted with custom keys
  statement {
    effect = "Allow"
    
    actions = [
      "kms:Decrypt"
    ]
    
    resources = ["*"]
    
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.*.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "secrets_access" {
  name        = "mcp-secrets-access-${var.environment}"
  description = "Allow MCP to read CRM credentials from Secrets Manager"
  policy      = data.aws_iam_policy_document.secrets_access.json
  
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_secrets_access" {
  role       = aws_iam_role.ecs_task_role.name
  policy_arn = aws_iam_policy.secrets_access.arn
}

# ============================================================================
# Outputs
# ============================================================================

output "ecs_task_role_arn" {
  description = "ARN of the ECS task role for MCP"
  value       = aws_iam_role.ecs_task_role.arn
}

output "salesforce_secret_arn" {
  description = "ARN of the Salesforce credentials secret"
  value       = var.crm_provider == "salesforce" ? aws_secretsmanager_secret.salesforce_credentials[0].arn : null
}

output "hubspot_secret_arn" {
  description = "ARN of the HubSpot credentials secret"
  value       = var.crm_provider == "hubspot" ? aws_secretsmanager_secret.hubspot_credentials[0].arn : null
}

output "secret_name_prefix" {
  description = "Prefix for secret names (use in AWS_SECRET_NAME_{PROVIDER} env var)"
  value       = local.secret_name_prefix
}
