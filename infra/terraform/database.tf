# MCP Infrastructure - RDS PostgreSQL

# Variables
variable "create_database" {
  description = "Whether to create RDS PostgreSQL instance"
  type        = bool
  default     = true
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "revenueflow"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "revenueflow_admin"
}

# ============================================================================
# RDS PostgreSQL for Lead Storage & Audit Trail
# ============================================================================

# Security Group for RDS
resource "aws_security_group" "database" {
  count       = var.create_database && var.vpc_id != "" ? 1 : 0
  name        = "mcp-database-sg-${var.environment}"
  description = "Security group for MCP RDS PostgreSQL"
  vpc_id      = var.vpc_id
  
  ingress {
    description = "PostgreSQL from ECS tasks"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = merge(var.tags, {
    Component = "mcp-database"
  })
}

# DB Subnet Group
resource "aws_db_subnet_group" "database" {
  count       = var.create_database && length(var.subnet_ids) > 0 ? 1 : 0
  name        = "mcp-database-subnet-${var.environment}"
  subnet_ids  = var.subnet_ids
  description = "Subnet group for MCP RDS"
  
  tags = var.tags
}

# Generate random password for database
resource "random_password" "db_password" {
  count   = var.create_database ? 1 : 0
  length  = 32
  special = false
}

# Store database password in Secrets Manager
resource "aws_secretsmanager_secret" "db_credentials" {
  count       = var.create_database ? 1 : 0
  name        = "${local.secret_name_prefix}/database"
  description = "RDS PostgreSQL credentials"
  
  recovery_window_in_days = var.environment == "prod" ? 30 : 0
  
  tags = merge(var.tags, {
    Component = "mcp-database"
  })
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  count     = var.create_database ? 1 : 0
  secret_id = aws_secretsmanager_secret.db_credentials[0].id
  
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password[0].result
    host     = var.create_database && length(var.subnet_ids) > 0 ? aws_db_instance.database[0].address : ""
    port     = 5432
    database = var.db_name
  })
}

# RDS PostgreSQL Instance
resource "aws_db_instance" "database" {
  count                   = var.create_database && length(var.subnet_ids) > 0 ? 1 : 0
  identifier              = "mcp-database-${var.environment}"
  engine                  = "postgres"
  engine_version          = "15"
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  max_allocated_storage   = var.environment == "prod" ? 100 : var.db_allocated_storage
  
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password[0].result
  
  db_subnet_group_name   = aws_db_subnet_group.database[0].name
  vpc_security_group_ids = [aws_security_group.database[0].id]
  
  # Encryption
  storage_encrypted = true
  
  # Backup settings
  backup_retention_period = var.environment == "prod" ? 7 : 1
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  
  # Multi-AZ for production
  multi_az = var.environment == "prod"
  
  # Performance Insights for production
  performance_insights_enabled = var.environment == "prod"
  
  # Deletion protection for production
  deletion_protection = var.environment == "prod"
  
  # Skip final snapshot in dev
  skip_final_snapshot = var.environment != "prod"
  
  tags = merge(var.tags, {
    Component = "mcp-database"
  })
}

# ============================================================================
# Outputs
# ============================================================================

output "database_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = var.create_database && length(var.subnet_ids) > 0 ? aws_db_instance.database[0].address : null
}

output "database_port" {
  description = "RDS PostgreSQL port"
  value       = var.create_database && length(var.subnet_ids) > 0 ? 5432 : null
}

output "database_url" {
  description = "Full DATABASE_URL for application"
  value       = var.create_database && length(var.subnet_ids) > 0 ? "postgres://${var.db_username}:${random_password.db_password[0].result}@${aws_db_instance.database[0].address}:5432/${var.db_name}" : null
  sensitive   = true
}

output "database_secret_arn" {
  description = "ARN of database credentials secret"
  value       = var.create_database ? aws_secretsmanager_secret.db_credentials[0].arn : null
}
