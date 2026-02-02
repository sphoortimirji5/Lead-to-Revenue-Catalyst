# Production Environment Configuration
environment   = "prod"
crm_provider  = "salesforce"
create_redis  = true
aws_region    = "us-east-1"

# Redis Configuration
redis_node_type = "cache.t3.small"

# VPC Configuration (update with your VPC details)
# vpc_id     = "vpc-xxxxxxxx"
# subnet_ids = ["subnet-xxxxxx", "subnet-yyyyyy"]

tags = {
  Environment = "prod"
  Project     = "lead-to-revenue-catalyst"
  ManagedBy   = "terraform"
  CostCenter  = "mcp-infrastructure"
}
