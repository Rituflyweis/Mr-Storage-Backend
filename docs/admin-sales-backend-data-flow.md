# Admin + Sales Backend Data Flow Guide

This document explains how the backend currently works for admin and sales panels, with focus on:

- real lifecycle and transition rules enforced in code
- how data moves between modules (lead, quote, invoice, PO, follow-up, escalation)
- where to add or fix APIs safely

This is based on current route/controller/service/model behavior in `src/`.

---

## 1) High-level architecture

Main app mounts are in `app.js`:

- `/api/admin` -> `src/routes/admin/index.js` (JWT + admin role required globally)
- `/api/sales` -> `src/routes/sales/index.js` (JWT + sales role required globally)
- `/api` -> `src/routes/common/index.js` (shared resources; route-level role guards)
- `/api/public` -> public chat/init flow (no JWT)

Role/auth middleware:

- `src/middleware/auth.js` (`verifyToken`) attaches `req.user`
- `src/middleware/roleGuard.js` enforces role checks

---

## 2) Core domain model and how to think about "project"

### 2.1 Lead is the central record

`Lead` (`src/models/Lead.js`) is the main entity used across admin and sales workflows:

- customer linkage: `customerId`
- ownership: `assignedSales`
- stage machine: `lifecycleStatus` + `lifecycleHistory`
- sales flags: `isQuoteReady`, `isHandedToSales`, `isRaisedToPO`, `poStatus`
- identity shown in UI: `jobId` (auto-generated `PRO-###`) and `projectName`

### 2.2 "Lead vs Project" behavior

There is no separate `Project` model in admin/sales flow. A lead is treated as a project progressively:

- pre-PO: conceptually an active lead/opportunity
- post-PO raise: business logic increasingly treats it as execution project
- customer project-style scopes depend on `isRaisedToPO: true` (see `src/utils/customerPoFilter.js`)

So your example is correct in spirit: practical project behavior starts after PO raise, especially for downstream flows.

---

## 3) Lifecycle stages and transition rules

Canonical stage constants are in `src/config/constants.js`:

- sales stages: `initial_contact`, `requirements_gathered`, `proposal_sent`, `negotiation`, `deal_closed`, `payment_done`, `converted_to_po`, `sent_to_admin`
- plant stages: `released_to_plant` through `delivered`
- all stages: `LIFECYCLE_STAGES`
- PO raise eligible stages: `PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES = ['proposal_sent', 'negotiation', 'deal_closed', 'payment_done']`

### 3.1 What transitions are actually enforced

1. New chat lead starts as `initial_contact` (`src/controllers/public.controller.js`)
2. AI + requirements can move lead forward to `requirements_gathered` (`src/services/socket/processCustomerMessage.js`, `src/services/leadQuoteReady.service.js`)
3. Sending quotation can move stage forward to `proposal_sent` only if this is an advance (`src/controllers/common/quotation.controller.js`)
4. Sales PO raise sets `converted_to_po` (`src/controllers/sales/lead.controller.js`)
5. Admin PO approve sets `sent_to_admin` and `poStatus=approved` (`src/controllers/admin/po.controller.js`)
6. Admin PO assign to plant sets `released_to_plant` (`src/controllers/admin/po.controller.js`)

### 3.2 Important caveat: manual lifecycle endpoints can jump stages

Both admin and sales lifecycle update APIs can set any valid lifecycle value. They validate enum membership but do not enforce strict stage progression globally.

Implication: if you need strict lifecycle FSM behavior, implement explicit transition validation in these handlers.

---

## 4) PO flow (critical path)

### 4.1 Sales raises PO

`POST /api/sales/leads/:leadId/po-order` -> `raisePOOrder`:

- must be assigned sales for the lead (`guardLead`)
- `isRaisedToPO` must be false
- at least one invoice must exist
- lifecycle must be in `PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES`
- creates `POOrder`, sets:
  - `lead.isRaisedToPO = true`
  - `lead.lifecycleStatus = 'converted_to_po'`
  - lifecycle history append

This is where "proposal_sent gate for PO raise" is enforced (plus the other eligible statuses).

### 4.2 Admin PO actions

In `src/routes/admin/po.routes.js` + `src/controllers/admin/po.controller.js`:

- `PUT /status` with `approved|rejected`
  - always syncs `lead.poStatus`
  - if approved, also sets lead stage to `sent_to_admin`
- `PUT /assign`
  - only allowed when PO status is approved
  - sets assigned plant user
  - updates lead stage to `released_to_plant`
  - updates all project buildings to `drawing_pending`

---

## 5) End-to-end operational data flow

## 5.1 Lead intake and AI handoff

1. Public init creates/reuses customer and lead
2. Customer chat messages are processed by AI
3. AI scoring updates `leadScoring`
4. When ready, lead becomes quote-ready (`isQuoteReady=true`, quote value inferred from budget signals)
5. Admin is notified (`lead_quote_ready` socket event)
6. Admin assigns sales manually (no automatic round-robin assignment in current quote-ready path)

Key files:

- `src/services/socket/processCustomerMessage.js`
- `src/services/leadQuoteReady.service.js`
- `src/controllers/admin/lead.controller.js` (`assignLead`)

## 5.2 Quotation flow

Shared quotation API under `/api/quotations` (`src/routes/common/quotation.routes.js`):

- create quotation from lead (`POST /`)
- update draft quotation (`PUT /:quotationId`)
- send quotation (`POST /:quotationId/send`)

Behavior details:

- server enforces quote calculations via `computeQuotePricing`
- send action sets quotation status to `sent`
- send action can advance lead stage to `proposal_sent` (forward only)

Key file: `src/controllers/common/quotation.controller.js`

## 5.3 Payment schedule + invoice flow

Shared payment APIs:

- `/api/payment-schedules` (`src/routes/common/payment.routes.js`)
- `/api/invoices` and `/api/leads/:leadId/invoices` (`src/routes/common/index.js`, `invoice.routes.js`)

Behavior details:

- one payment schedule per lead (stages list)
- invoice can optionally tie to a payment schedule stage
- mark invoice paid updates invoice and payment stage status
- invoice paid does not automatically force lead stage to `payment_done`

Key files:

- `src/controllers/common/payment.controller.js`
- `src/controllers/common/invoice.controller.js`

## 5.4 Escalation and follow-up flow

Sales escalation:

- `POST /api/sales/leads/:leadId/escalate` creates escalation and notifies admin

Admin escalation:

- resolve escalation
- assign escalation to employee (also reassign lead)

Follow-ups:

- sales can create and complete own follow-ups
- admin has broader visibility and assignment capability

Key files:

- `src/controllers/sales/lead.controller.js`
- `src/controllers/admin/escalation.controller.js`
- `src/controllers/sales/followup.controller.js`
- `src/controllers/admin/followup.controller.js`

---

## 6) Route map for developers (where to edit)

### Admin lead APIs

`src/routes/admin/lead.routes.js`:

- listing/stats: `/stats`, `/ai-handled`, `/by-score`, `/signed-contracts`, `/terminated`
- core CRUD: `GET /`, `POST /`, `PUT /:leadId`
- assignment and lifecycle: `PUT /:leadId/assign`, `PUT /:leadId/lifecycle`, `PUT /:leadId/temperature`
- detail/timeline/docs/notes/budget/buildings/terminate/chat status endpoints

### Sales lead APIs

`src/routes/sales/lead.routes.js`:

- listing/stats/export/import
- core CRUD and detail
- lifecycle, temperature, notes, activities
- escalation and PO raise endpoints

### Shared finance/quote APIs

`src/routes/common/index.js` + child routers:

- quotations: `/api/quotations/*`
- invoices: `/api/invoices/*` and `/api/leads/:leadId/invoices`
- payment schedules: `/api/payment-schedules/*`

---

## 7) Key invariants and gotchas (must know before changes)

1. **PO raise gating is real and strict**: lifecycle must be one of `proposal_sent`, `negotiation`, `deal_closed`, `payment_done`, and invoice must exist.
2. **Lead/project terminology is contextual**: post-PO pathways rely heavily on `isRaisedToPO`.
3. **Lifecycle can be manually overridden** through update endpoints unless you add stricter transition validation.
4. **Quotation send has lifecycle side effects** (`proposal_sent` advance).
5. **PO approval and assignment have lifecycle side effects** (`sent_to_admin`, then `released_to_plant`).
6. **Payment completion and lifecycle are not tightly coupled** by default; do not assume auto `payment_done`.
7. **Sales ownership checks are enforced in many sales handlers** via `guardLead`; preserve this pattern on new sales-only routes.
8. **Audit logging is expected** for major state changes; use `auditService.log` and constants from `AUDIT_ACTIONS`.

---

## 8) Suggested change strategy for new features / API fixes

When modifying backend behavior, use this order:

1. Update constants and validation first (`src/config/constants.js`, route validators)
2. Update controller business logic
3. Update side effects:
   - lifecycle history
   - audit logs
   - socket events
4. Ensure role guard + ownership enforcement is still correct
5. Update docs in `docs/` if lifecycle or API contract changed

---

## 9) Quick checklist before merging backend changes

- [ ] Route validation matches business rule (not just schema)
- [ ] Role access and ownership checks are correct
- [ ] Lifecycle mutation is intentional and history is appended
- [ ] Audit action exists and is logged
- [ ] Socket notifications (if needed) are emitted
- [ ] Behavior matches this guide and API docs

---

## 10) Primary source files index

- App mounts: `app.js`
- Constants and lifecycle enums: `src/config/constants.js`
- Lead model: `src/models/Lead.js`
- Admin routes root: `src/routes/admin/index.js`
- Sales routes root: `src/routes/sales/index.js`
- Shared routes root: `src/routes/common/index.js`
- Sales lead logic + PO raise: `src/controllers/sales/lead.controller.js`
- Admin lead management: `src/controllers/admin/lead.controller.js`
- Admin PO management: `src/controllers/admin/po.controller.js`
- Quotation: `src/controllers/common/quotation.controller.js`
- Invoice: `src/controllers/common/invoice.controller.js`
- Payment schedules: `src/controllers/common/payment.controller.js`
- Chat processing + quote-ready handoff:
  - `src/services/socket/processCustomerMessage.js`
  - `src/services/leadQuoteReady.service.js`

