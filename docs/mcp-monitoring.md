# MCP Monitoring & Alerts Guide

## Prometheus Metrics

The MCP layer exposes the following metrics via the `/metrics` endpoint:

### Counters
| Metric | Labels | Description |
|--------|--------|-------------|
| `mcp_actions_total` | `tool`, `status`, `crm_provider` | Total MCP actions executed |
| `mcp_grounding_decisions_total` | `status` | Grounding decisions (VALID/DOWNGRADED/REJECTED) |
| `mcp_rate_limit_violations_total` | `limit_type` | Rate limit violations |
| `mcp_safety_blocks_total` | `tool`, `reason` | Actions blocked by safety guard |

### Gauges
| Metric | Labels | Description |
|--------|--------|-------------|
| `mcp_circuit_breaker_state` | `crm_provider`, `operation` | CB state (0=closed, 1=half-open, 2=open) |
| `mcp_circuit_breaker_failures` | `crm_provider` | Current failures in window |

### Histograms
| Metric | Labels | Buckets |
|--------|--------|---------|
| `mcp_action_duration_seconds` | `tool`, `crm_provider` | 10ms - 10s |
| `mcp_crm_api_duration_seconds` | `crm_provider`, `operation`, `status` | 100ms - 30s |

---

## Alert Rules

### Circuit Breaker Alerts

```yaml
# prometheus/alerts/mcp.yml
groups:
  - name: mcp-circuit-breaker
    rules:
      - alert: MCPCircuitBreakerOpen
        expr: mcp_circuit_breaker_state{} == 2
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "MCP Circuit Breaker OPEN ({{ $labels.crm_provider }})"
          description: "Circuit breaker for {{ $labels.crm_provider }}/{{ $labels.operation }} is OPEN"

      - alert: MCPCircuitBreakerHalfOpen
        expr: mcp_circuit_breaker_state{} == 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "MCP Circuit Breaker HALF-OPEN ({{ $labels.crm_provider }})"
```

### Grounding Alerts

```yaml
  - name: mcp-grounding
    rules:
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
  - name: mcp-rate-limits
    rules:
      - alert: MCPRateLimitViolations
        expr: rate(mcp_rate_limit_violations_total[5m]) > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "MCP rate limit violations exceeding threshold"
```

---

## Grafana Dashboard

Import the following dashboard JSON into Grafana:

```json
{
  "title": "MCP Operations",
  "panels": [
    {
      "title": "Actions per Minute",
      "type": "graph",
      "targets": [{ "expr": "rate(mcp_actions_total[1m]) * 60" }]
    },
    {
      "title": "Success Rate",
      "type": "gauge",
      "targets": [{ "expr": "sum(rate(mcp_actions_total{status='success'}[5m])) / sum(rate(mcp_actions_total[5m]))" }]
    },
    {
      "title": "Circuit Breaker Status",
      "type": "stat",
      "targets": [{ "expr": "mcp_circuit_breaker_state" }]
    },
    {
      "title": "Grounding Decisions",
      "type": "piechart",
      "targets": [{ "expr": "sum by (status) (mcp_grounding_decisions_total)" }]
    }
  ]
}
```

---

## Local Development

```bash
# Start Redis + Postgres
docker-compose up -d

# Set environment
export REDIS_URL=redis://localhost:6379
export NODE_ENV=development

# Run with metrics
npm run start:dev
```

Access metrics at http://localhost:3000/metrics
