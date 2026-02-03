# BullMQ Queue Architecture

This document describes the BullMQ queue configuration for lead processing.

## Queue Overview

| Queue | Purpose |
|-------|---------|
| `lead-processing` | Main queue for lead enrichment and CRM sync |
| `lead-processing-dlq` | Dead Letter Queue for permanently failed jobs |

## Redis Key Structure

### Local Development (`redis://localhost:6379`)

```
# Job data (STRING - JSON payload)
bull:lead-processing:1            # Job ID 1 data
bull:lead-processing:2            # Job ID 2 data

# Queue state (LIST/SET of job IDs)
bull:lead-processing:id           # STRING - Job ID counter
bull:lead-processing:wait         # LIST - Job IDs waiting to be processed
bull:lead-processing:active       # LIST - Job IDs currently being processed
bull:lead-processing:completed    # SET - Completed job IDs
bull:lead-processing:failed       # ZSET - Failed job IDs with timestamps

# DLQ (same structure)
bull:lead-processing-dlq:1        # Failed job data
bull:lead-processing-dlq:wait     # LIST - DLQ job IDs waiting
```

### Example Key-Value Pairs

```bash
# Job ID counter
GET bull:lead-processing:id
→ "42"

# Job data (only leadId is used in codebase)
GET bull:lead-processing:1
→ "{\"data\":{\"leadId\":123}}"

# Wait list
LRANGE bull:lead-processing:wait 0 -1
→ ["3", "4", "5"]

# DLQ job data (all fields used in dlq-event.listener.ts)
GET bull:lead-processing-dlq:1
→ "{\"data\":{\"originalJobId\":\"6\",\"leadId\":456,\"error\":\"Salesforce API timeout\",\"attemptsMade\":5,\"failedAt\":\"2026-02-02T22:00:00Z\"}}"
```

### Production (`redis://mcp-redis-prod.xxx.cache.amazonaws.com:6379`)

Same key structure, different Redis endpoint:

```
# Job data
bull:lead-processing:1
bull:lead-processing:2

# Queue state
bull:lead-processing:id           # STRING
bull:lead-processing:wait         # LIST
bull:lead-processing:active       # LIST
bull:lead-processing:completed    # SET
bull:lead-processing:failed       # ZSET

# DLQ - Job data (STRING - JSON payload)
bull:lead-processing-dlq:1        # DLQ job data: { originalJobId, leadId, error, attemptsMade, failedAt }
bull:lead-processing-dlq:2

# DLQ - Queue state
bull:lead-processing-dlq:id       # STRING - DLQ job ID counter
bull:lead-processing-dlq:wait     # LIST - DLQ job IDs waiting
bull:lead-processing-dlq:active   # LIST - DLQ job IDs being processed
bull:lead-processing-dlq:completed # SET - Processed DLQ job IDs
```

## Job Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           lead-processing                                │
├─────────────────────────────────────────────────────────────────────────┤
│  WAITING → ACTIVE → COMPLETED                                           │
│              ↓                                                          │
│           FAILED (retry 1-5)                                            │
│              ↓                                                          │
│     [All retries exhausted]                                             │
└──────────────┬──────────────────────────────────────────────────────────┘
               ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                        lead-processing-dlq                                │
├──────────────────────────────────────────────────────────────────────────┤
│  WAITING → ACTIVE → Mark lead as PERMANENTLY_FAILED                      │
└──────────────────────────────────────────────────────────────────────────┘
```

## Configuration

### Job Options (LeadsService)

```typescript
{
  attempts: 5,              // Max retry attempts
  backoff: {
    type: 'exponential',    // Exponential backoff
    delay: 1000,            // Initial delay: 1s, then 2s, 4s, 8s, 16s
  },
}
```

### Retry Timeline

| Attempt | Delay | Cumulative Wait |
|---------|-------|-----------------|
| 1 | Immediate | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s |
| 5 | 8s | 15s |
| DLQ | - | After ~15s total |

## Monitoring Commands

### View Queue Status (Redis CLI)

```bash
# Local
redis-cli

# Production
redis-cli -h mcp-redis-prod.xxx.cache.amazonaws.com
```

```bash
# Count waiting jobs
LLEN bull:lead-processing:wait

# Count active jobs
LLEN bull:lead-processing:active

# Count failed jobs (before DLQ)
ZCARD bull:lead-processing:failed

# Count DLQ jobs
LLEN bull:lead-processing-dlq:wait

# View specific job data
GET bull:lead-processing:1
```

## Environment Variables

| Variable | Local | Production |
|----------|-------|------------|
| `REDIS_URL` | `redis://localhost:6379` | `redis://mcp-redis-prod.xxx.cache.amazonaws.com:6379` |

## Code References

| File | Purpose |
|------|---------|
| `src/leads/leads.service.ts` | Adds jobs to queue |
| `src/ai/lead.processor.ts` | Processes lead jobs |
| `src/ai/dlq/dlq.processor.ts` | Handles failed jobs |
| `src/ai/dlq/dlq-event.listener.ts` | Moves jobs to DLQ after retries |
