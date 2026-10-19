# Avalara alignment — Phase 1 (safety + mapping subsystem)

Date: 2026-10-19. Scope: spec §3–§10 safety + configurable mapping subsystem.
Phases 2–3 (quote SalesOrder preview, tax-adjust endpoint, exemptions, order-type
metadata, retries/raw-payload persistence) are **not** in this change.

## New capabilities

- **Configurable tax-code mappings** (`tax_category_mappings`) — 11 client categories,
  editable/auditable without code changes. Codes are **not** invented: all ship as
  `DRAFT` with `avalara_tax_code: null` until the client/accountant approves.
  - Seed: `npm run seed:tax-mappings`
  - Admin API (admin-auth, mounted under `/api/admin`):
    - `GET /api/admin/tax-codes?search=` — search Avalara tax-code definitions
    - `GET /api/admin/tax-mappings` — list mappings + approval summary
    - `PUT /api/admin/tax-mappings/:id` — edit / approve (DRAFT→PENDING→APPROVED; approval requires a code)
    - `GET /api/admin/tax-mappings/:id/audit` — change history
- **Line resolution precedence:** explicit `line.taxCode` → `line.taxable` flag →
  APPROVED mapping (category, then keyword) → sandbox test-only fallback.
- **Test-only safety:** any line resolved by a fallback (unapproved) marks the
  transaction `avalara.testOnly = true`. In **production**, a test-only invoice is
  **blocked at commit** (`reason: unapproved_tax_codes`) — estimated/placeholder tax
  is never charged as final (§5, §8). Local engine is always `testOnly`/estimate.
- **Finalization blocking (§9/§10):** sending / marking-sent an invoice now commits tax
  **first**. In Avalara mode, if tax can't be confirmed (ship-from incomplete, AvaTax
  error, unapproved codes) the invoice is **not** finalized — the API returns HTTP 409
  with `{ taxStatus: 'tax_pending', reason, correlationId }`. Disable only via
  `TAX_BLOCK_ON_TAX_FAILURE=false` (not recommended). local/legacy never block.
- **Per-line code freeze** persisted on `invoice.avalara.lineCodes` for reconciliation.
- **Correlation IDs** on every AvaTax request (`X-Correlation-Id`), surfaced in errors.

## Environment variables

Spec §10 names are primary; original `AVATAX_*` names still work as fallbacks.

| Primary (spec)          | Fallback alias        | Notes                                   |
|-------------------------|-----------------------|-----------------------------------------|
| `AVALARA_ENV`           | `AVATAX_ENV`          | `sandbox` (default) / `production`      |
| `AVALARA_BASE_URL`      | —                     | optional explicit override              |
| `AVALARA_ACCOUNT_ID`    | `AVATAX_ACCOUNT_ID`   |                                         |
| `AVALARA_LICENSE_KEY`   | `AVATAX_LICENSE_KEY`  |                                         |
| `AVALARA_COMPANY_CODE`  | `AVATAX_COMPANY_CODE` | e.g. `SteelInvestmentsLLC`              |
| `AVATAX_SHIP_FROM_*`    | —                     | LINE1/LINE2/CITY/STATE/POSTAL/COUNTRY   |
| `TAX_BLOCK_ON_TAX_FAILURE` | —                  | default `true` (avalara only)           |
| `AVALARA_COMPANY_ID`    | `AVATAX_COMPANY_ID`   | Returns (int) company id                |
| `AVALARA_RETURNS_CLIENT_ID` / `_SECRET` | —     | optional dedicated Returns OAuth        |

## Go-live order

1. Set credentials + `AVATAX_SHIP_FROM_*` (nexus origin) in sandbox.
2. `npm run seed:tax-mappings`, then approve official Avalara codes per category via the admin API.
3. Smoke-test in `AVALARA_ENV=sandbox` (a known address returns expected tax; test-only flag clears once codes approved).
4. Flip `TAX_ENGINE=avalara` last, in production, after the above pass.

## Still client/accountant-dependent (spec §12)

Official tax codes per category; retail-vs-construction-contract treatment per state;
nexus/registrations; exemption handling (Phase 2); bundled lump-sum / foundation review.
