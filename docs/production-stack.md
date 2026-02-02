# Production Architecture (AWS)

This document details the enterprise-grade production stack for **RevenueFlow AI** on AWS.

## Infrastructure Layers

### 1. Ingress
- **AWS API Gateway / ALB**: Handles incoming HTTPS traffic, provides DDoS protection, and manages throttling.

### 2. Compute
- **AWS ECS / Fargate**: Runs the NestJS application and background workers in a serverless, auto-scaling environment.

### 3. Queue
- **Amazon ElastiCache (Redis)**: Managed Redis cluster for BullMQ job persistence and state management.

### 4. Database
- **Amazon RDS (PostgreSQL)**: Managed relational database for lead storage, auditing, and idempotency.

### 5. Secrets & Config
- **AWS Secrets Manager**: Secure storage and rotation of API keys (Salesforce, Bedrock) and database credentials.

### 6. Observability (LGTM Stack)
- **Loki**: Log aggregation (via Promtail sidecar on ECS)
- **Grafana**: Dashboards, alerting, and log exploration
- **Prometheus**: Metrics collection and alerting
- **Jaeger**: Distributed tracing

## Security
- **IAM Boundaries**: Least-privilege access for ECS tasks to RDS, ElastiCache, and Secrets Manager.
- **VPC / Private Subnets**: All compute and data services reside in private subnets, accessible only via the Ingress layer.

## Scaling Strategies
- **Primary Scaling Signal**: Queue depth + oldest job age (indicates backlog pressure).
- **Secondary Signals**: Worker CPU and memory utilization.
- **Worker Concurrency**: Adjustable via environment variables to match downstream API capacity.
- **Queue Depth Alarms**: CloudWatch alarms trigger Fargate task scaling when the BullMQ backlog grows.
- **Autoscaling Triggers**: CPU/Memory based scaling for the API layer; Queue-depth based scaling for the Worker layer.

## MCP Environment Configuration

The MCP layer connects to real CRM APIs in production with credentials managed by AWS Secrets Manager.

**Environment variables (via ECS Task Definition):**
```
NODE_ENV=production
CRM_PROVIDER=SALESFORCE
DATABASE_URL=postgres://...@mcp-database-prod.xxx.rds.amazonaws.com:5432/revenueflow
REDIS_URL=redis://mcp-redis-prod.xxx.cache.amazonaws.com:6379
AWS_REGION=us-west-2
# CRM and database credentials retrieved from AWS Secrets Manager at runtime
```

| Component | Production Behavior |
|-----------|---------------------|
| CRM Executor | `SalesforceExecutor` or `HubSpotExecutor` |
| Rate Limiting | Redis-backed (ElastiCache) |
| Idempotency | Redis with TTL |
| Circuit Breaker | Opossum (in-process) |
| Credentials | AWS Secrets Manager (auto-rotated) |
