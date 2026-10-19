# Avalara alignment — Phases 2 & 3

Date: 2026-10-19. Builds on Phase 1 (safety + mapping subsystem). Completes the
remaining spec items: quote estimates, adjustments, exemptions, order-type metadata,
transaction persistence, and transport hardening.

## Phase 2 — quote estimate, adjust, exemptions, metadata

### Order-type & install-provider metadata (§3)
New invoice fields, accepted on create/update and sent to AvaTax as transaction
`parameters` (reporting only — they do NOT decide taxability):
- `orderType`: `SUPPLY_ONLY` | `SUPPLY_AND_INSTALL` | `UNKNOWN`
- `installationProvider`: `OWN_CREW` | `SUBCONTRACTOR` | `BOTH` | `UNKNOWN`

### Customer exemption (§3)
- Invoice `exemption { isExempt, entityUseCode, exemptionNo, certificateRef, reason }`.
- Optional `Customer.taxExemption` default, seeded onto new invoices when the body
  doesn't set one.
- **Never assumed:** exemption is applied to AvaTax (`entityUseCode` / `exemptionNo`)
  only when `isExempt` AND a usage code or certificate/exemption number is present.
  A flagged-but-undocumented exemption is treated as TAXABLE and a warning is attached.

### New invoice tax endpoints
- `POST /api/invoices/:invoiceId/tax-preview` — non-committed **SalesOrder** estimate.
  Accepts draft overrides in the body, does **not** persist committed tax, returns
  totals + jurisdiction breakdown + testOnly/warnings.
- `POST /api/invoices/:invoiceId/tax-adjust` — body `{ action: 'adjust' | 'void', reason }`.
  `void` cancels a committed transaction; `adjust` uses AvaTax adjust for a committed
  Avalara doc (or recalculates an uncommitted/local one). Never deletes committed records.
- `GET /api/invoices/:invoiceId/tax` — persisted tax breakdown/status for the invoice.

## Phase 3 — persistence & transport hardening

### tax_transactions (§1, §6, §10)
New `TaxTransaction` collection retains, per AvaTax document code:
`internal_document_id`, `document_code`, `avalara_transaction_id`, `transaction_type`,
`status` (Saved/Committed/Adjusted/Voided/error), `amount`, `total_tax`,
`request_json`, `response_json`, `error_json`, `calculated_at`, `committed_at`.
Written on every create / commit / adjust / void (success and error). No secrets are
stored — AvaTax auth lives only in request headers, never in the persisted model.

### Retries / backoff (§9, §10)
AvaTax requests now retry transient failures (network error, HTTP 429, 5xx) with
exponential backoff, honoring `Retry-After`. 4xx are never retried. Every request
carries an `X-Correlation-Id` echoed into errors and persisted. Tune with
`AVALARA_MAX_RETRIES` (default 2, max 5).

## Verified here
All files `node --check` clean and `require` without error. Unit-tested: transient
503 → retried to success; 4xx → no retry; network error → retried then surfaced;
tax-code search builds valid OData. Not run here (needs DB + live sandbox):
preview/adjust round-trips and tax_transactions writes — cover these in the sandbox
smoke test.

## Still client/accountant-dependent (§12)
Official tax codes per category; retail-vs-construction treatment per state; nexus;
which `entityUseCode` values map to the client's exemption types; bundled lump-sum /
foundation review. Also confirm the Returns GraphQL schema/OAuth and the AvaTax
`$filter` grammar for tax-code search against the live account.
