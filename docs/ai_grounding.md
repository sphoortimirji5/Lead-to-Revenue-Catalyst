# AI Grounding Contract

To prevent hallucinations, **AI outputs are accepted only if every non-trivial claim is backed by explicit evidence referencing an authorized grounding source.**

## Terminology: Fit vs Intent

These terms are often confused. In this system, they measure different dimensions:

| Dimension | Definition | Data Sources | Example |
| :--- | :--- | :--- | :--- |
| **Fit** | Firmographic suitability — does this company *match* our ICP? | Enrichment (industry, size, geo, tech stack) | "5000+ employee Fintech in US" |
| **Intent** | Behavioral readiness — is this lead *ready* to buy? | Marketo, Product, Salesforce | "Attended demo, high usage, open deal" |

A lead can be:
- **High Fit, Low Intent**: Great company, but not engaged yet → Nurture
- **Low Fit, High Intent**: Eager buyer, but wrong segment → Disqualify
- **High Fit, High Intent**: Ideal → Route to SDR immediately

## Grounding Sources

| Source | Supported Claims (`claim_type`) | Example `field_path` |
| :--- | :--- | :--- |
| **Salesforce CRM** | `PIPELINE` | `salesforce.deal_stage`, `salesforce.owner` |
| **Marketo (Marketing)** | `BEHAVIOR` | `marketo.campaign_id`, `marketo.engagement_score` |
| **Product Behavior** | `BEHAVIOR` | `product.usage_signals`, `product.activation_state` |
| **Enrichment** | `FIRMOGRAPHIC` | `enrichment.industry`, `enrichment.employee_range`, `enrichment.geo` |
| **Computed Signals** | `SCORE` | `computed.intent_score`, `computed.fit_score` |

**Source Constraints:**
- **Enrichment** cannot support `PIPELINE`, `REVENUE`, or `INTENT` claims.
- **Salesforce** cannot support `INTENT` behavioral claims (unless explicitly computed).
- **Web Search** is **NOT** an authorized source.

## Evidence Field Path Standard

All evidence must reference fields using a namespaced `field_path`, not arbitrary labels:

```json
{
  "source": "ENRICHMENT",
  "field_path": "enrichment.industry",
  "value": "Fintech",
  "claim_type": "FIRMOGRAPHIC"
}
```

This prevents invented fields and enables mechanical validation against the source schema.

## Validation Rules

1.  **High Intent Strictness**:
    - IF `intent_level` is `HIGH`, requires **≥1** evidence item of type `BEHAVIOR` or `SCORE`.
2.  **Firmographic Claims**:
    - IF AI cites industry, size, or tech stack → MUST cite `Enrichment` source.
    - IF Enrichment is missing (null) → Firmographic claims are **FORBIDDEN**.
3.  **Pipeline/Revenue Claims**:
    - MUST cite `Salesforce` or `Computed` source.
4.  **Conflicts**:
    - IF Evidence value conflicts with Source of Truth → **HARD FAIL** (`REJECTED`).
5.  **Missing Evidence**:
    - IF required evidence is missing → **DOWNGRADE** (see Downgrade Semantics below).

## Downgrade Semantics

When grounding validation fails *softly* (missing evidence, not conflict), the system applies deterministic downgrades:

| Original Value | Downgraded To | Trigger |
| :--- | :--- | :--- |
| `HIGH_FIT` | `MEDIUM_FIT` | Missing behavioral/computed evidence for high intent |
| `MEDIUM_FIT` | `LOW_FIT` | Insufficient firmographic backing |
| `ROUTE_TO_SDR` | `NURTURE` | Decision downgraded due to fit/intent reduction |

**Hard Failures (No Downgrade — Immediate Rejection):**
- Firmographic claims without enrichment data
- Evidence value conflicts with source of truth
- AI cites unauthorized source (e.g., `WEB_SEARCH`)
