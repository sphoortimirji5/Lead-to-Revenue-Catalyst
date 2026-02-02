# MCP (Model Context Protocol) Implementation

## Problem Statement

When an AI system analyzes leads and makes decisions (e.g., "this is a high-value prospect"), those decisions need to be **safely executed** in a CRM like Salesforce or HubSpot. The core challenges are:

1. **AI Safety**: AI responses can hallucinate or make claims without evidence
2. **CRM Mutations**: Direct AI-to-CRM writes are dangerous without validation
3. **Auditability**: Every CRM action must be traceable back to the AI decision
4. **Rate Limiting**: CRM APIs have quotas that must be respected
5. **Resilience**: CRM downtime shouldn't crash the lead pipeline

---

## Solution Architecture

The MCP layer sits **between** AI grounding validation and CRM execution:

```
Lead Data → AI Analysis → Grounding Validation → MCP Layer → CRM
```

### Key Components

| Component | Purpose |
|-----------|---------|
| **Safety Guard** | Validates AI decisions before CRM execution |
| **Tool Registry** | Catalog of safe, pre-approved CRM operations |
| **Rate Limiter** | Prevents CRM API quota violations |
| **Circuit Breaker** | Isolates CRM failures from the lead pipeline |
| **Executor** | Abstraction layer for CRM-specific API calls |
| **Audit Logger** | Records all MCP actions for compliance |

---

## Local vs Production Stack

| Aspect | Local Development | Production |
|--------|-------------------|------------|
| **CRM Executor** | `MockMCPExecutor` (in-memory) | `SalesforceExecutor` / `HubSpotExecutor` |
| **Credentials** | None required | AWS Secrets Manager |
| **Rate Limiting** | Disabled (or in-memory) | Redis-backed (ElastiCache) |
| **Idempotency** | In-memory | Redis with TTL |
| **Audit Trail** | Postgres (`crm_sync_logs`) | Postgres + CRM Activity History |
| **Circuit Breaker** | Opossum (in-process) | Opossum (in-process) |
| **Metrics** | Prometheus `/metrics` | Prometheus → Grafana |
| **Logs** | Pretty-printed (stdout) | JSON → Loki |
| **Tracing** | Jaeger (local Docker) | Jaeger |


---


## Safety Layers

### 1. Grounding Validation (Pre-MCP)
- AI claims are validated against enrichment data
- Firmographic claims require `ENRICHMENT` source
- Behavior claims require `MARKETO` or `PRODUCT` source
- **REJECTED** leads never reach MCP

### 2. Safety Guard (MCP Entry)
- Validates context has all required fields
- Checks for PII leakage risks
- Blocks dangerous operations

### 3. Rate Limiting (Per-Action)
- Per-lead: 10 actions/minute
- Per-account: 100 actions/minute
- Global: 1000 actions/minute (CRM API quota)

### 4. Circuit Breaker (Per-CRM)
- Opens after 5 consecutive failures
- Half-open after 30 seconds
- Closes after successful probe

---

## Supported CRM Tools

| Category | Tools |
|----------|-------|
| **Lead Lifecycle** | `create_lead`, `upsert_lead`, `convert_lead`, `update_lead_status` |
| **Account/Contact** | `match_account`, `create_contact` |
| **Sales Workflow** | `create_opportunity`, `update_opportunity_stage` |
| **Activity** | `create_task`, `log_activity` |
| **Enrichment** | `sync_firmographics` |

All tools are:
- Idempotent (safe to retry)
- Audited (logged to `crm_sync_logs`)
- Rate-limited
- Type-safe (Zod-validated params)

---

## Observability

### Metrics (Prometheus)
- `mcp_actions_total` - Actions by tool, status, CRM
- `mcp_action_duration_seconds` - Latency histogram
- `mcp_circuit_breaker_state` - Current state (0=closed, 1=open, 2=half-open)
- `mcp_rate_limit_violations_total` - Blocked requests

### Logs (Loki)
- Structured JSON with execution context
- PII automatically redacted
- Correlation IDs for tracing

### Alerts
- Circuit breaker open > 1 minute
- Error rate > 5% in 5 minutes
- Rate limit violations > 10/minute

---

## Security

- **Credentials**: AWS Secrets Manager (rotated automatically)
- **IAM**: Least-privilege ECS task roles
- **Input Sanitization**: SOQL/SOSL injection prevention
- **PII Redaction**: Automatic in logs and audit trail
- **TLS**: All CRM API calls over HTTPS

---

## Files Reference

| Path | Description |
|------|-------------|
| `src/mcp/mcp.service.ts` | Main orchestrator |
| `src/mcp/mcp.module.ts` | NestJS module wiring |
| `src/mcp/registry/mcp-registry.service.ts` | Tool catalog |
| `src/mcp/executors/` | CRM-specific implementations |
| `src/mcp/guards/` | Safety guard, rate limiter |
| `src/mcp/utils/` | Circuit breaker, idempotency, PII redactor |
| `infra/terraform/` | AWS infrastructure (Secrets, Redis) |
