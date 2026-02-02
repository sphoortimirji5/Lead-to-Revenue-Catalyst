# Observability Guide

This document covers logging, metrics, tracing, and alerting for RevenueFlow AI.

## Service Level Objectives (SLOs)

| Metric | SLO | Measurement |
| :--- | :--- | :--- |
| **Availability** | 99.9% Success | `sum(leads_processed_total{status="success"}) / sum(leads_processed_total)` |
| **Latency** | P95 < 2s | `ai_analysis_duration_seconds` (histogram) |
| **Throughput** | > 10 leads/sec | `rate(leads_processed_total[1m])` |
| **Error Rate** | < 0.1% | `sum(leads_processed_total{status="error"}) / sum(leads_processed_total)` |

### Error Budget Burn Rate Alerting

The system uses **multi-window burn rate alerts** to catch SLO violations before they exhaust the monthly error budget.

| Alert Severity | Burn Rate | Window | Trigger Condition |
| :--- | :--- | :--- | :--- |
| **Page (Critical)** | 14.4x | 1h + 5m | Exhausts 30-day budget in 2 days |
| **Ticket (Warning)** | 6x | 6h + 30m | Exhausts 30-day budget in 5 days |
| **Low (Info)** | 1x | 3d + 6h | Trending toward budget exhaustion |

---

## Structured Logging

The application uses `nestjs-pino` for high-performance, structured JSON logging.

| Aspect | Local | Production |
| :--- | :--- | :--- |
| **Format** | Pretty-printed (colorized) | Structured JSON |
| **Destination** | Terminal (stdout) | Loki (via Promtail) |
| **PII Redaction** | Enabled | Enabled |

---

## Prometheus Metrics

Metrics are exposed at the `/metrics` endpoint.

### Lead Processing Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `leads_processed_total` | Counter | Leads processed by status |
| `ai_analysis_duration_seconds` | Histogram | AI enrichment latency |

### MCP Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `mcp_actions_total` | Counter | `tool`, `status`, `crm_provider` | MCP actions executed |
| `mcp_grounding_decisions_total` | Counter | `status` | Grounding decisions (VALID/DOWNGRADED/REJECTED) |
| `mcp_rate_limit_violations_total` | Counter | `limit_type` | Rate limit violations |
| `mcp_safety_blocks_total` | Counter | `tool`, `reason` | Actions blocked by safety guard |
| `mcp_circuit_breaker_state` | Gauge | `crm_provider`, `operation` | CB state (0=closed, 1=half-open, 2=open) |
| `mcp_action_duration_seconds` | Histogram | `tool`, `crm_provider` | Action latency |
| `mcp_crm_api_duration_seconds` | Histogram | `crm_provider`, `operation`, `status` | CRM API latency |

---

## Alert Rules

### AI Latency Alerts

```yaml
- alert: AIEnrichmentLatencyBudgetBurn
  expr: |
    (
      histogram_quantile(0.95, rate(ai_analysis_duration_seconds_bucket[1h])) > 2
      AND
      histogram_quantile(0.95, rate(ai_analysis_duration_seconds_bucket[5m])) > 2
    )
  for: 2m
  labels:
    severity: page
  annotations:
    summary: "AI Enrichment P95 latency exceeds 2s SLO"
```

### Circuit Breaker Alerts

```yaml
- alert: MCPCircuitBreakerOpen
  expr: mcp_circuit_breaker_state{} == 2
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: "MCP Circuit Breaker OPEN ({{ $labels.crm_provider }})"
```

### Grounding Alerts

```yaml
- alert: MCPHighGroundingRejectionRate
  expr: |
    rate(mcp_grounding_decisions_total{status="REJECTED"}[5m]) /
    rate(mcp_grounding_decisions_total[5m]) > 0.1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "High grounding rejection rate ({{ $value | humanizePercentage }})"
```

### Rate Limiting Alerts

```yaml
- alert: MCPRateLimitViolations
  expr: rate(mcp_rate_limit_violations_total[5m]) > 10
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "MCP rate limit violations exceeding threshold"
```

---

## Grafana Dashboards

Recommended panels:

| Panel | Type | Query |
|-------|------|-------|
| Lead Throughput | Graph | `rate(leads_processed_total[1m]) * 60` |
| Success Rate | Gauge | `sum(rate(mcp_actions_total{status='success'}[5m])) / sum(rate(mcp_actions_total[5m]))` |
| AI Latency P95 | Graph | `histogram_quantile(0.95, rate(ai_analysis_duration_seconds_bucket[5m]))` |
| Circuit Breaker Status | Stat | `mcp_circuit_breaker_state` |
| Grounding Decisions | Pie Chart | `sum by (status) (mcp_grounding_decisions_total)` |

---

## Local Verification

```bash
# Start infrastructure
docker-compose up -d

# Start application
npm run start:dev

# Verify metrics endpoint
curl http://localhost:3000/metrics | grep -E "leads_processed|mcp_actions"
```
