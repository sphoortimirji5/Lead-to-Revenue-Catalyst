# Migration: Mock to Production

This document outlines the strategy for moving **RevenueFlow AI** from local validation to production-hardened mode.

## Transition Strategy
The system uses the **Provider Pattern** to swap infrastructure without changing business logic.

### 1. Provider Switch
Toggle the environment variable to flip the switch:
- `CRM_PROVIDER=MOCK` → `CRM_PROVIDER=REAL`
- `AI_PROVIDER=GEMINI` → `AI_PROVIDER=BEDROCK` (Future enhancement)

### 2. Shadow Writes (Optional)
For high-risk migrations, the system can be configured to perform "Shadow Writes":
- Process the lead through the AI engine.
- Write to the Mock CRM (Postgres) for auditing.
- Log the payload that *would* have been sent to Salesforce without actually calling the API.

### 3. Feature Flags
Use feature flags to enable/disable AI scoring or specific enrichment logic for a subset of campaigns before a full rollout.

## Rollback Plan
If production issues occur:
1. **Disable AI Scoring**: Revert to a deterministic fallback score to keep the pipeline moving.
2. **Pause Workers**: Use the BullMQ "Pause" command to stop processing while investigating, ensuring no leads are lost in the queue.
3. **Revert Provider**: Switch `CRM_PROVIDER` back to `MOCK` to drain the queue into the audit table while fixing the live integration.

## Why Rollback Is Safe
- **No destructive writes**: Ingestion only appends to the queue and audit log.
- **Persistence**: Jobs remain persisted in Redis even if workers are paused.
- **Independent Toggles**: AI scoring can be disabled independently of the ingestion path.
- **Idempotency**: CRM writes are idempotent, allowing for safe retries after a rollback.

## Data Replay
Since all raw events are stored in the Postgres audit table, any failed or skipped leads can be "replayed" through the system by re-adding them to the BullMQ queue once the issue is resolved.
