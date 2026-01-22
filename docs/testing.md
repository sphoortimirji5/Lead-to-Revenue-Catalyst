# Testing Strategy

Reliability in the RevenueFlow AI architecture is ensured through a multi-layered testing strategy, with a specific focus on **AI Grounding** and **Guardrail Verification**.

## Test Pyramid

1.  **Unit Tests (Jest)**: 
    - Validate core logic in `LeadsService` and `AiService`.
    - **Mocked Dependencies**: CRM, Redis, and AI Providers are strictly mocked to ensure deterministic results.
    - **Focus**: State transitions, error handling (retries), and validation logic.

2.  **Integration Tests (Simulated)**:
    - Test the `LeadProcessor` flow using an in-memory Redis instance (or mock).
    - verify data mapping between enrichment, entity persistence, and CRM payload generation.

3.  **Manual Verification (cURL)**:
    - End-to-end flow validation using the `MockEnrichmentProvider`.

## AI Grounding Tests

We enforce a strict "Grounding Contract" to prevent hallucinations. The `AiService` tests (`src/ai/ai.service.spec.ts`) specifically target:

### 1. Hallucination Prevention
- **Scenario**: AI generates firmographic claims (e.g., "Industry is Fintech") without enrichment data.
- **Expected Result**: **Hard Fail** (`GroundingStatus.REJECTED`).
- **Mechanism**: `validateGrounding` method asserts that `claim_type='FIRMOGRAPHIC'` requires a non-null enrichment payload.

### 2. Source of Truth Conflict
- **Scenario**: AI claims "Healthcare" while Enrichment Provider says "Fintech".
- **Expected Result**: **Hard Fail**.
- **Mechanism**: Strict string inclusion check against the trusted provider.

### 3. Disallowed Sources
- **Scenario**: AI cites "WEB_SEARCH" or "CHATGPT_KNOWLEDGE".
- **Expected Result**: **Hard Fail**.
- **Mechanism**: Allowlist verification against `GroundingSource` Enum.

### 4. High Intent Justification
- **Scenario**: AI scores lead as `HIGH_FIT` but provides only firmographic evidence.
- **Expected Result**: **Downgrade** to `MEDIUM_FIT`.
- **Mechanism**: High intent requires ≥1 behavioral signal (`MARKETO` or `PRODUCT`).

### Evidence Format
All evidence items use namespaced `field_path` values (e.g., `enrichment.industry`, `marketo.campaign_id`) to enable mechanical validation against source schemas.

## Running Tests

```bash
# Run all unit tests
npm run test

# Run AI service tests only
npm run test -- ai.service

# Run E2E tests (requires Docker)
npm run test:e2e
```

## E2E Tests (Grounding Verification)

The `test/grounding.e2e-spec.ts` file validates the complete grounding flow against a real Postgres database:

### Test 1: Valid Grounding Flow
- **Setup**: Mock AI returns `HIGH_FIT` with matching Enrichment data (both say "Fintech").
- **Verification**: Lead is persisted with `grounding_status: VALID` and synced to CRM.

### Test 2: Hallucination Rejection
- **Setup**: Mock AI claims "Healthcare" but Enrichment Provider says "Fintech".
- **Verification**: Lead is persisted with `grounding_status: REJECTED` and `grounding_errors` populated.

### Running E2E Tests

```bash
# Start infrastructure
docker-compose up -d

# Run grounding E2E tests
npm run test:e2e -- test/grounding.e2e-spec.ts
```

## Manual Verification

Use `cURL` to trigger the flow and inspect the logs/DB to see the `grounding_status`.

```bash
curl -X POST http://localhost:3000/leads \
  -H "Content-Type: application/json" \
  -d '{"email": "alex@stripe.com", "name": "Alex Smith", "campaign_id": "launch_2024"}'
```

**Expected DB State**:
- `intent`: `HIGH_FIT`
- `grounding_status`: `VALID`
- `evidence`: JSON array containing matched Enrichment and Marketo signals.
