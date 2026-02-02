# Migration: Local to Production

This document provides a step-by-step plan for deploying RevenueFlow AI to production.

## Migration Phases

| Phase | Focus | Components |
|-------|-------|------------|
| **Phase 1** | Database | Local Postgres to RDS PostgreSQL |
| **Phase 2** | Queue | Local Redis to ElastiCache |
| **Phase 3** | CRM | Mock Executor to Salesforce Executor |
| **Phase 4** | Observability | Local logs to Loki/Grafana |

---

## Phase 1: Database Migration (Local Postgres to RDS)

### Prerequisites
- AWS account with RDS access
- VPC with private subnets configured
- Terraform installed

### Step 1.1: Provision RDS PostgreSQL

```bash
cd infra/terraform
terraform init
terraform plan -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars
```

This provisions:
- RDS PostgreSQL instance
- ElastiCache Redis cluster
- AWS Secrets Manager entries
- IAM roles for ECS

### Step 1.2: Update Environment Variable

```bash
# Local
DATABASE_URL=postgres://postgres:postgres@localhost:5432/revenueflow

# Production (from Terraform output)
DATABASE_URL=$(terraform output -raw database_url)
```

### Step 1.3: Run Database Migrations

```bash
# TypeORM will auto-sync schema on first start (synchronize: true)
# For production, disable synchronize and use migrations:
npm run typeorm migration:run
```

### Step 1.4: Verify Database Connectivity

```bash
# Verify tables exist
psql $DATABASE_URL -c "\dt"
```

| Table | Purpose |
|-------|---------|
| `lead` | Lead storage and idempotency |
| `crm_sync_log` | Audit trail for all CRM operations |

---

## Phase 2: Queue Migration (Local Redis to ElastiCache)

Already provisioned by Terraform in Phase 1.

### Step 2.1: Update Environment Variable

```bash
# Local
REDIS_URL=redis://localhost:6379

# Production (from Terraform output)
REDIS_URL=$(terraform output -raw redis_url)
```

### Step 2.2: Verify Queue Connectivity

```bash
# Check Redis for queues
redis-cli -u $REDIS_URL KEYS "bull:*"
```

---

## Phase 3: CRM Migration (Mock to Salesforce)

### Step 3.1: Populate Salesforce Credentials

Terraform creates the secret placeholder. Populate the values via AWS Console:

1. Open AWS Console > Secrets Manager
2. Find `revenueflow/crm/salesforce`
3. Click "Retrieve secret value" > "Edit"
4. Enter JSON:

```json
{
  "clientId": "your-connected-app-id",
  "clientSecret": "your-secret",
  "username": "api-user@company.com",
  "password": "password+securityToken",
  "loginUrl": "https://login.salesforce.com"
}
```

### Step 3.2: Update Environment Variable

```bash
# Local
CRM_PROVIDER=MOCK

# Production
CRM_PROVIDER=SALESFORCE
```

### Step 3.3: Verify CRM Connectivity

```bash
# Send test lead and verify in Salesforce
curl -X POST https://your-endpoint/leads \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test", "campaign_id": "migration_test"}'

# Check audit log
psql $DATABASE_URL -c "SELECT * FROM crm_sync_log ORDER BY created_at DESC LIMIT 1"
```

---

## Phase 4: Observability Migration

### Step 4.1: Configure Production Logging

Logs automatically switch from pretty-print to JSON when `NODE_ENV=production`.

### Step 4.2: Set Up Prometheus Scraping

Add the application's `/metrics` endpoint to your Prometheus targets:

```yaml
scrape_configs:
  - job_name: 'revenueflow'
    static_configs:
      - targets: ['your-alb-endpoint:3000']
```

---

## Rollback Plan

If production issues occur:

| Issue | Action |
|-------|--------|
| Database failure | Reconnect to local Postgres, drain queue |
| CRM API errors | Set `CRM_PROVIDER=MOCK` to capture leads in audit table |
| Queue issues | Pause BullMQ workers, jobs persist in Redis |

### Why Rollback Is Safe

- **Idempotency**: All operations are idempotent via `(email, campaign_id)` hash
- **Persistence**: Jobs stay in Redis even if workers stop
- **Audit Trail**: All CRM operations logged to database
