# AWS Networking Infrastructure - VPC, Subnets, Security Groups

# Variables
variable "create_networking" {
  description = "Whether to create networking infrastructure"
  type        = bool
  default     = true
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ============================================================================
# VPC
# ============================================================================

resource "aws_vpc" "main" {
  count      = var.create_networking ? 1 : 0
  cidr_block = var.vpc_cidr
  
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = merge(var.tags, {
    Name = "mcp-vpc-${var.environment}"
  })
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  count  = var.create_networking ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  
  tags = merge(var.tags, {
    Name = "mcp-igw-${var.environment}"
  })
}

# Public Subnets (for ALB)
resource "aws_subnet" "public" {
  count             = var.create_networking ? length(var.availability_zones) : 0
  vpc_id            = aws_vpc.main[0].id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = var.availability_zones[count.index]
  
  map_public_ip_on_launch = true
  
  tags = merge(var.tags, {
    Name = "mcp-public-${var.availability_zones[count.index]}"
    Type = "public"
  })
}

# Private Subnets (for ECS, RDS, Redis)
resource "aws_subnet" "private" {
  count             = var.create_networking ? length(var.availability_zones) : 0
  vpc_id            = aws_vpc.main[0].id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = var.availability_zones[count.index]
  
  tags = merge(var.tags, {
    Name = "mcp-private-${var.availability_zones[count.index]}"
    Type = "private"
  })
}

# NAT Gateway (for private subnet internet access)
resource "aws_eip" "nat" {
  count  = var.create_networking ? 1 : 0
  domain = "vpc"
  
  tags = merge(var.tags, {
    Name = "mcp-nat-eip-${var.environment}"
  })
}

resource "aws_nat_gateway" "main" {
  count         = var.create_networking ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  
  tags = merge(var.tags, {
    Name = "mcp-nat-${var.environment}"
  })
}

# Route Tables
resource "aws_route_table" "public" {
  count  = var.create_networking ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }
  
  tags = merge(var.tags, {
    Name = "mcp-public-rt-${var.environment}"
  })
}

resource "aws_route_table" "private" {
  count  = var.create_networking ? 1 : 0
  vpc_id = aws_vpc.main[0].id
  
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[0].id
  }
  
  tags = merge(var.tags, {
    Name = "mcp-private-rt-${var.environment}"
  })
}

resource "aws_route_table_association" "public" {
  count          = var.create_networking ? length(var.availability_zones) : 0
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table_association" "private" {
  count          = var.create_networking ? length(var.availability_zones) : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# ============================================================================
# Outputs
# ============================================================================

output "vpc_id" {
  description = "VPC ID"
  value       = var.create_networking ? aws_vpc.main[0].id : null
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = var.create_networking ? aws_subnet.public[*].id : []
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = var.create_networking ? aws_subnet.private[*].id : []
}
