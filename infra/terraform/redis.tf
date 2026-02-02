# MCP Infrastructure - Redis (ElastiCache)

# Variables
variable "create_redis" {
  description = "Whether to create Redis (ElastiCache) cluster"
  type        = bool
  default     = true
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "vpc_id" {
  description = "VPC ID for ElastiCache"
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnet IDs for ElastiCache"
  type        = list(string)
  default     = []
}

# ============================================================================
# ElastiCache Redis for Rate Limiting & Idempotency
# ============================================================================

# Security Group for Redis
resource "aws_security_group" "redis" {
  count       = var.create_redis && var.vpc_id != "" ? 1 : 0
  name        = "mcp-redis-sg-${var.environment}"
  description = "Security group for MCP Redis cluster"
  vpc_id      = var.vpc_id
  
  ingress {
    description = "Redis from ECS tasks"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    # ECS task security group should be added here
    cidr_blocks = ["10.0.0.0/8"]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = merge(var.tags, {
    Component = "mcp-redis"
  })
}

# ElastiCache Subnet Group
resource "aws_elasticache_subnet_group" "redis" {
  count       = var.create_redis && length(var.subnet_ids) > 0 ? 1 : 0
  name        = "mcp-redis-subnet-${var.environment}"
  subnet_ids  = var.subnet_ids
  description = "Subnet group for MCP Redis"
  
  tags = var.tags
}

# ElastiCache Redis Cluster
resource "aws_elasticache_cluster" "redis" {
  count                = var.create_redis && length(var.subnet_ids) > 0 ? 1 : 0
  cluster_id           = "mcp-redis-${var.environment}"
  engine               = "redis"
  engine_version       = "7.0"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = "default.redis7"
  
  subnet_group_name    = aws_elasticache_subnet_group.redis[0].name
  security_group_ids   = [aws_security_group.redis[0].id]
  
  # Enable encryption
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  
  # Maintenance window (Sunday 3-4am UTC)
  maintenance_window = "sun:03:00-sun:04:00"
  
  # Snapshot settings for prod
  snapshot_retention_limit = var.environment == "prod" ? 7 : 1
  snapshot_window          = "02:00-03:00"
  
  tags = merge(var.tags, {
    Component = "mcp-redis"
  })
}

# ============================================================================
# Outputs
# ============================================================================

output "redis_endpoint" {
  description = "Redis cluster endpoint"
  value       = var.create_redis && length(var.subnet_ids) > 0 ? aws_elasticache_cluster.redis[0].cache_nodes[0].address : null
}

output "redis_port" {
  description = "Redis cluster port"
  value       = var.create_redis && length(var.subnet_ids) > 0 ? 6379 : null
}

output "redis_url" {
  description = "Full Redis URL for REDIS_URL env var"
  value       = var.create_redis && length(var.subnet_ids) > 0 ? "redis://${aws_elasticache_cluster.redis[0].cache_nodes[0].address}:6379" : null
}
