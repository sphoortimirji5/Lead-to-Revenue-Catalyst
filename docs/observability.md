# Observability Guide - Lead-to-Revenue Catalyst

I implemented a **Unified Telemetry** approach. We use structured JSON logging with automatic PII redaction to stay compliant, but the core of our reliability is **SLO-based alerting**. We monitor the Error Budget Burn Rate of our AI enrichment worker. If our P95 latency for "Executive Stealth" identification crosses 2 seconds, the system triggers a proactive alert before it impacts the sales team's speed-to-lead.

## Service Level Objectives (SLOs)

We track "Golden Signals" to ensure the system meets its production requirements.

| Metric | SLO | Measurement |
| :--- | :--- | :--- |
| **Availability** | 99.9% Success | `sum(leads_processed_total{status="success"}) / sum(leads_processed_total)` |
| **Latency** | P95 < 2s | `ai_analysis_duration_seconds` (histogram) |
| **Throughput** | > 10 leads/sec | `rate(leads_processed_total[1m])` |
| **Error Rate** | < 0.1% | `sum(leads_processed_total{status="not_found"}) / sum(leads_processed_total)` |

### Error Budget Burn Rate Alerting

The system uses **multi-window burn rate alerts** to catch SLO violations before they exhaust the monthly error budget.

| Alert Severity | Burn Rate | Window | Trigger Condition |
| :--- | :--- | :--- | :--- |
| **Page (Critical)** | 14.4x | 1h + 5m | Exhausts 30-day budget in 2 days |
| **Ticket (Warning)** | 6x | 6h + 30m | Exhausts 30-day budget in 5 days |
| **Low (Info)** | 1x | 3d + 6h | Trending toward budget exhaustion |

**Example Prometheus Alert Rule:**
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
    description: "The 'Executive Stealth' identification is degrading speed-to-lead."
```

## Implementation Details

### 1. Structured Logging
The application uses `nestjs-pino` for high-performance, structured JSON logging.
- **Production**: Logs are emitted as JSON for ingestion by **Loki** via Promtail.
- **Local**: Logs are prettified using `pino-pretty` for readability.
- **PII Redaction**: Email, Phone, and Password fields are automatically redacted from logs.

### 2. Metrics Collection
Metrics are exposed via Prometheus format at the `/metrics` endpoint.
- **Lead Processing**: A counter `leads_processed_total` tracks ingestion and status.
- **AI Latency**: A histogram `ai_analysis_duration_seconds` tracks how long AI enrichment takes.

### 3. Monitoring Access
- **Logs**: Loki (via Grafana) or stdout locally
- **Metrics**: `GET /metrics` (Prometheus scrape)

## Dashboards (Recommended)
We recommend creating a Grafana dashboard with the following panels:
1. **Lead Throughput (Total)**: Gauge of processed leads.
2. **Success/Failure Rate**: Pie chart of lead status.
3. **AI Latency Distribution**: Heatmap or P95 line chart.
4. **Active Jobs**: Counter from BullMQ (via Prometheus).

---

## Local vs Production

| Aspect | Local | Production |
| :--- | :--- | :--- |
| **Log Format** | Pretty-printed (colorized) | Structured JSON |
| **Log Destination** | Terminal (stdout) | **Loki** (via Promtail) |
| **Metrics Access** | `curl localhost:3000/metrics` | Prometheus scrape target |
| **PII Redaction** | Enabled | Enabled |

### Local Testing

Follow these steps to verify observability locally:

**1. Start Infrastructure**
```bash
docker-compose up -d
```

**2. Start the Application**
```bash
npm run start:dev
```

**3. Verify Logs**
Look for structured, prettified output in your terminal:
```text
[09:24:56.412] INFO (58814): Processing lead: test@example.com
    context: "LeadProcessor"
```

**4. Verify Metrics Endpoint**
```bash
curl http://localhost:3000/metrics
```

**5. Verify Custom Metrics**
Check that business metrics are being collected:
```bash
# Lead processing counter
curl -s http://localhost:3000/metrics | grep leads_processed_total

# AI latency histogram
curl -s http://localhost:3000/metrics | grep ai_analysis_duration_seconds
```

**Expected Output:**
```text
# HELP leads_processed_total Total number of leads processed
# TYPE leads_processed_total counter
leads_processed_total{status="success"} 5

# HELP ai_analysis_duration_seconds Duration of AI analysis in seconds
# TYPE ai_analysis_duration_seconds histogram
ai_analysis_duration_seconds_bucket{le="1"} 3
ai_analysis_duration_seconds_count 5
```

**6. Clean Up**
```bash
docker-compose down
```

