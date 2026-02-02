# Terraform Configuration
# Usage: terraform init && terraform plan -var-file=dev.tfvars

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = var.tags
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}
