# AWS ECS Fargate for Lead Service

# Variables
variable "create_ecs" {
  description = "Whether to create ECS cluster and service"
  type        = bool
  default     = true
}

variable "ecs_cpu" {
  description = "ECS task CPU units"
  type        = number
  default     = 256
}

variable "ecs_memory" {
  description = "ECS task memory (MB)"
  type        = number
  default     = 512
}

variable "ecs_desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

variable "ecr_repository_url" {
  description = "ECR repository URL for container image"
  type        = string
  default     = ""
}

# ============================================================================
# ECS Cluster
# ============================================================================

resource "aws_ecs_cluster" "main" {
  count = var.create_ecs ? 1 : 0
  name  = "mcp-cluster-${var.environment}"
  
  setting {
    name  = "containerInsights"
    value = var.environment == "prod" ? "enabled" : "disabled"
  }
  
  tags = merge(var.tags, {
    Component = "mcp-ecs"
  })
}

# ============================================================================
# Security Group for ECS Tasks
# ============================================================================

resource "aws_security_group" "ecs_tasks" {
  count       = var.create_ecs && var.create_networking ? 1 : 0
  name        = "mcp-ecs-tasks-sg-${var.environment}"
  description = "Security group for ECS tasks"
  vpc_id      = aws_vpc.main[0].id
  
  ingress {
    description     = "HTTP from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = var.create_alb ? [aws_security_group.alb[0].id] : []
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = merge(var.tags, {
    Component = "mcp-ecs"
  })
}

# ============================================================================
# ECS Task Execution Role
# ============================================================================

data "aws_iam_policy_document" "ecs_execution_assume" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_execution" {
  count              = var.create_ecs ? 1 : 0
  name               = "mcp-ecs-execution-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_execution_assume.json
  
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  count      = var.create_ecs ? 1 : 0
  role       = aws_iam_role.ecs_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ============================================================================
# ECS Task Definition
# ============================================================================

resource "aws_ecs_task_definition" "lead_service" {
  count                    = var.create_ecs && var.ecr_repository_url != "" ? 1 : 0
  family                   = "mcp-lead-service-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ecs_cpu
  memory                   = var.ecs_memory
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn
  
  container_definitions = jsonencode([
    {
      name      = "lead-service"
      image     = "${var.ecr_repository_url}:latest"
      essential = true
      
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]
      
      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "PORT", value = "3000" },
        { name = "CRM_PROVIDER", value = "SALESFORCE" },
        { name = "ENRICHMENT_PROVIDER", value = "CLEARBIT" }
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/mcp-lead-service-${var.environment}"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
  
  tags = var.tags
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "ecs" {
  count             = var.create_ecs ? 1 : 0
  name              = "/ecs/mcp-lead-service-${var.environment}"
  retention_in_days = var.environment == "prod" ? 30 : 7
  
  tags = var.tags
}

# ============================================================================
# ECS Service
# ============================================================================

resource "aws_ecs_service" "lead_service" {
  count           = var.create_ecs && var.create_networking && var.ecr_repository_url != "" ? 1 : 0
  name            = "mcp-lead-service-${var.environment}"
  cluster         = aws_ecs_cluster.main[0].id
  task_definition = aws_ecs_task_definition.lead_service[0].arn
  desired_count   = var.ecs_desired_count
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks[0].id]
    assign_public_ip = false
  }
  
  load_balancer {
    target_group_arn = aws_lb_target_group.ecs[0].arn
    container_name   = "lead-service"
    container_port   = 3000
  }
  
  tags = var.tags
}

# ============================================================================
# Outputs
# ============================================================================

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = var.create_ecs ? aws_ecs_cluster.main[0].name : null
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = var.create_ecs && var.create_networking && var.ecr_repository_url != "" ? aws_ecs_service.lead_service[0].name : null
}
