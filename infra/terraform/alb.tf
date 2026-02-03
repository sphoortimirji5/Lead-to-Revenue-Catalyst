# AWS Application Load Balancer

# Variables
variable "create_alb" {
  description = "Whether to create ALB"
  type        = bool
  default     = true
}

# TODO: Restrict to known webhook source IPs for enhanced security
# Example: Marketo webhook IPs can be found at:
# https://experienceleague.adobe.com/docs/marketo/using/product-docs/webhooks/ip-addresses-for-webhooks.html
variable "allowed_ingress_cidrs" {
  description = "CIDR blocks allowed to access ALB (default: all). Restrict to Marketo IPs in production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ============================================================================
# Security Group for ALB
# ============================================================================

resource "aws_security_group" "alb" {
  count       = var.create_alb && var.create_networking ? 1 : 0
  name        = "mcp-alb-sg-${var.environment}"
  description = "Security group for ALB"
  vpc_id      = aws_vpc.main[0].id
  
  # NOTE: In production, restrict cidr_blocks to known webhook sources (e.g., Marketo IPs)
  # to limit attack surface. Default 0.0.0.0/0 is for development/testing only.
  ingress {
    description = "HTTPS from allowed sources"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_ingress_cidrs
  }
  
  ingress {
    description = "HTTP for redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_ingress_cidrs
  }
  
  # Egress to anywhere required for ALB to reach private ECS tasks
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = merge(var.tags, {
    Component = "mcp-alb"
  })
}

# ============================================================================
# Application Load Balancer
# ============================================================================

resource "aws_lb" "main" {
  count              = var.create_alb && var.create_networking ? 1 : 0
  name               = "mcp-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = aws_subnet.public[*].id
  
  enable_deletion_protection = var.environment == "prod"
  
  tags = merge(var.tags, {
    Component = "mcp-alb"
  })
}

# Target Group
resource "aws_lb_target_group" "ecs" {
  count       = var.create_alb && var.create_networking ? 1 : 0
  name        = "mcp-ecs-tg-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main[0].id
  target_type = "ip"
  
  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }
  
  tags = var.tags
}

# HTTP Listener (redirect to HTTPS)
resource "aws_lb_listener" "http" {
  count             = var.create_alb && var.create_networking ? 1 : 0
  load_balancer_arn = aws_lb.main[0].arn
  port              = "80"
  protocol          = "HTTP"
  
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# Note: HTTPS listener requires ACM certificate
# Uncomment when certificate is available
# resource "aws_lb_listener" "https" {
#   count             = var.create_alb && var.create_networking ? 1 : 0
#   load_balancer_arn = aws_lb.main[0].arn
#   port              = "443"
#   protocol          = "HTTPS"
#   ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
#   certificate_arn   = var.acm_certificate_arn
#   
#   default_action {
#     type             = "forward"
#     target_group_arn = aws_lb_target_group.ecs[0].arn
#   }
# }

# ============================================================================
# Outputs
# ============================================================================

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = var.create_alb && var.create_networking ? aws_lb.main[0].dns_name : null
}

output "alb_arn" {
  description = "ALB ARN"
  value       = var.create_alb && var.create_networking ? aws_lb.main[0].arn : null
}

output "alb_target_group_arn" {
  description = "ALB target group ARN"
  value       = var.create_alb && var.create_networking ? aws_lb_target_group.ecs[0].arn : null
}
