# System-wide audit log — implementation plan

**Date:** 2026-09-21  
**Goal:** Record **login**, **logout**, and **create / update / delete** (and other meaningful mutations) for **every user** on **every panel** (admin, sales, plant, construction, account, customer).

---

## 1. Current state (as of codebase review)

### What exists today

| Piece | Location | Notes |
|-------|----------|--------|
| **AuditLog model** | `src/models/AuditLog.js` | Insert-only; `type`, `action`, `leadId`, `customerId`, `performedBy` (User ref), `metadata`, `createdAt` |
| **Write API** | `src/services/audit.service.js` | `log({ type, action, leadId, customerId, performedBy, metadata })` — fails silently |
| **Action enum** | `src/config/constants.js` → `AUDIT_ACTIONS` | ~80 domain actions (lead, invoice, quotation, plant, user, …) |
| **Human labels** | `src/utils/auditActivityMessage.js` | Maps actions → display strings for activity feeds |
| **Employee “last activity”** | `src/services/auditActivity.service.js` | Used by `GET /api/admin/employees/audit-log` |
| **Lead timeline** | Admin/sales lead detail | Loads `AuditLog` rows for a lead |
| **Page visits (separate)** | `UserPageActivity` + `/api/activity/page-visit` | **Not** the same as audit log; FE-driven page tracking |

### Where `auditService.log` is used (~31 controller files)

Strong coverage: **quotation**, **invoice**, **payment**, **plant** (vendor, carrier, delivery, shipper, freight, project, BOM), **sales** (lead, followup, meeting, customer), **admin** (lead, customer, employee, admin users, PO, escalation, meeting, followup), **customer portal** (many project/payment/drawing actions), **public** freight/chat, **SMDT**, **upload** (some).

### Gaps (no or minimal audit today)

| Area | Gap |
|------|-----|
| **Auth** | No log on staff `login` / `logout`, customer `login`, password change, forgot-password |
| **Profile** | `PUT /api/profile`, `PUT /api/customer/profile` — not logged |
| **Construction panel** | **Zero** `auditService` usage (tasks, milestones, deliveries, material requests, drawings, bundles) |
| **Account panel** | Almost none (one invoice path); expenses, tax, financial, reports mutations unlogged |
| **Admin** | Many modules never call audit: products, roles, financial, chat admin, construction admin wrappers, dashboard-only reads |
| **Common** | Team chat, notifications, calendar, pricing rules, agreement, profile password |
| **Actor model** | Customer actions often set `customerId` but **`performedBy: null`** — hard to show “who” in a unified staff audit UI |
| **Consistency** | Ad-hoc `metadata` shapes; no standard `panel`, `route`, `entityType`, `entityId` |
| **Reads** | No single **global** audit API with filters (panel, user, date, action) for admin compliance UI |

---

## 2. Target behavior (product)

### Events to capture

| Category | Examples | Panels |
|----------|----------|--------|
| **Session** | login success, logout, login failed (optional), token refresh (optional) | All staff + customer |
| **Profile / security** | profile updated, password changed, admin reset employee password | Staff + customer |
| **CRUD** | create / update / delete on business entities | Per panel |
| **Workflow** | approve, reject, send email, submit for approval | Already partly covered |
| **Admin user mgmt** | employee/admin create, update, deactivate, delete | Admin |

### Each log row should answer

1. **Who** — staff user id + role, or customer id  
2. **Which panel** — `admin` \| `sales` \| `plant` \| `construction` \| `account` \| `customer`  
3. **What** — stable `action` string + optional human message  
4. **On what** — `entityType` + `entityId` (lead, invoice, task, …)  
5. **When** — `createdAt` (server)  
6. **Context** — IP, user-agent, request id (optional), route template, changed fields summary  

---

## 3. Recommended data model (evolution, not rewrite)

Keep **`AuditLog`** collection; extend schema in a backward-compatible way:

```js
// New optional fields (defaults keep old rows valid)
actorType:   { type: String, enum: ['staff', 'customer', 'system', 'anonymous'], default: 'staff' }
actorId:     { type: ObjectId, default: null }  // User or Customer _id
panel:       { type: String, enum: [...USER_ROLES, 'customer', 'public'], default: null }
entityType:  { type: String, default: null }   // e.g. 'lead', 'task', 'user'
entityId:    { type: ObjectId, default: null }
httpMethod:  { type: String, default: null }
path:        { type: String, default: null }    // e.g. '/api/plant/deliveries/:id'
// performedBy, customerId, leadId — keep populated for existing queries
```

**Migration rule:** New writes populate both old fields (`performedBy` / `customerId`) **and** new fields (`actorType`, `actorId`, `panel`) so existing lead timelines and employee last-activity keep working.

### New `AUDIT_ACTIONS` (auth + generic)

```text
auth.login.success          auth.login.failed
auth.logout                 auth.password.changed
auth.profile.updated
customer.login.success
customer.profile.updated
entity.created              entity.updated              entity.deleted   // fallback when no specific action
```

Keep existing specific actions (`quotation.created`, etc.) as primary; use generic only where not worth a dedicated constant yet.

---

## 4. Architecture — three layers

### Layer A — Auth & session (Phase 1, small, high value)

| Hook | File | Action |
|------|------|--------|
| Staff login OK | `auth.controller.js` `login` | `auth.login.success`, `panel` from `user.role`, `performedBy` + `actorId` |
| Staff logout | `auth.controller.js` `logout` | Optional Bearer parse → `auth.logout` (today logout is stateless; log if token sent) |
| Staff change password | `auth.controller.js` + `profile.controller.js` | `auth.password.changed` |
| Customer login OK | `customerAuth.controller.js` | `customer.login.success`, `actorType: customer` |
| Failed login | same | `auth.login.failed` — metadata: email only, no password; rate-limit log volume |

**Panel for staff:** use `user.role` as `panel` (admin user → `panel: admin`).

### Layer B — Domain-specific logs (existing pattern, complete coverage)

Continue **`auditService.log` in controllers** after successful DB write for:

- Rich metadata (invoice number, diff, project name)  
- Construction panel (all mutating handlers in `src/controllers/construction/*`)  
- Account panel mutators  
- Profile updates  
- Any admin CRUD still missing  

**Standard metadata envelope** (helper in `audit.service.js`):

```js
{
  panel: 'plant',
  route: req.originalUrl,
  method: req.method,
  entityType: 'delivery',
  entityId: '...',
  summary: 'Delivery rescheduled',
  changes: { ... }  // optional, no secrets
}
```

Add `logFromRequest(req, { type, action, ... })` to centralize panel/actor/IP.

### Layer C — Safety net middleware (Phase 2, optional)

`src/middleware/auditMutations.js`:

- Runs after `verifyToken` / `verifyCustomerToken`  
- On `res.on('finish')`, if `req.method` ∈ `POST|PUT|PATCH|DELETE` and `statusCode < 400`  
- If `req.auditLogged !== true` (set by controller when Layer B ran), write **`entity.updated`** / **`entity.created`** generic log with route + ids from params  

**Exclude:** health, webhooks, high-volume reads disguised as POST, public routes, file upload binary endpoints (or special-case).

This catches missed controllers but should **not** replace Layer B for important domains.

---

## 5. Panel → route map (for `panel` field)

| Panel | Route prefix | Auth |
|-------|----------------|------|
| Admin | `/api/admin/*` | Staff JWT, `role === admin` |
| Sales | `/api/sales/*`, shared `/api/*` when `role === sales` | Staff |
| Plant | `/api/plant/*` | Staff |
| Construction | `/api/construction/*` | Staff |
| Account | `/api/account/*` | Staff |
| Customer | `/api/customer/*` | Customer JWT |
| Public | `/api/public/*` | None / token |

Shared routes (`/api/profile`, `/api/quotations`, …): set `panel: req.user.role` or `customer`.

---

## 6. Read APIs (admin / compliance UI)

### Phase 1 — Global list (admin only)

`GET /api/admin/audit-logs`

Query: `panel`, `actorId`, `action`, `type`, `leadId`, `customerId`, `from`, `to`, `search` (metadata text), `page`, `limit`.

Response: rows + `message` from `formatAuditActivityMessage` + actor summary (name, email, role).

Indexes to add:

```text
{ panel: 1, createdAt: -1 }
{ action: 1, createdAt: -1 }
{ actorId: 1, createdAt: -1 }
{ entityType: 1, entityId: 1, createdAt: -1 }
```

### Phase 2 — Per-user export

`GET /api/admin/audit-logs/export?format=csv` (same filters).

### Phase 3 — Panel-scoped (optional)

Sub-admins see only their panel or their own actions — product decision.

Existing endpoints to keep:

- `GET /api/admin/employees/audit-log` (last activity per employee)  
- Lead detail `auditLog` array  

---

## 7. Implementation phases (suggested order)

| Phase | Scope | Effort | Outcome |
|-------|--------|--------|---------|
| **1** | Extend `AuditLog` + `audit.service` helper (`logFromRequest`) + new `AUDIT_ACTIONS` | S | Foundation |
| **2** | Auth login/logout/password + profile PUT (staff + customer) | S | Session trail |
| **3** | `GET /api/admin/audit-logs` + indexes + message formatting for new actions | M | Admin UI can list |
| **4** | Construction controllers — all mutations | M | Biggest panel gap |
| **5** | Account + remaining admin mutators | M | |
| **6** | Audit pass on shared `/api` (quotation/invoice already good; team chat, calendar, etc.) | L | |
| **7** | Optional mutation middleware safety net | M | |
| **8** | Frontend doc + admin Audit Log page contract | S | |

**Effort key:** S = days, M = ~1 week, L = multi-week spread.

---

## 8. Controller inventory — construction (Phase 4 checklist)

Files with mutating exports **without** audit today:

| File | Handlers to instrument |
|------|-------------------------|
| `construction/task.controller.js` | create/update/delete task, work log, milestone, project step |
| `construction/delivery.controller.js` | createDelivery, updateSiteContact |
| `construction/materialRequest.controller.js` | create, update status, order quotation |
| `construction/drawing.controller.js` | (review uploads/approvals) |
| `construction/project.controller.js` | (review assignments/status) |
| `construction/bundle.controller.js` | (review) |

Mirror **plant** patterns: `type: 'plant'` or new `type: 'construction'`, add to `AUDIT_TYPES`.

---

## 9. Rules & non-goals

- **Never log** passwords, tokens, OTP, full request bodies with secrets.  
- **Fail silently** on audit write (keep current behavior).  
- **Do not audit** pure GET/list/export unless product asks (volume).  
- **PageActivity** stays separate; optional link in metadata (`pageVisitId`) later.  
- **AI / system** actions: `performedBy: null`, `actorType: 'system'`, metadata.source.

---

## 10. Frontend (later)

- Admin → **Audit Log** page: table from `GET /api/admin/audit-logs`, filters by panel, user, date, action.  
- Lead detail: keep existing timeline; ensure new actions appear in `auditActivityMessage.js`.  
- Optional: show “Last login” on employee profile from latest `auth.login.success`.

---

## 11. Acceptance criteria

1. Every successful **staff login** and **customer portal login** creates one audit row with correct `panel` / `actorType`.  
2. **Logout** logged when client calls logout with valid token (document if client must call).  
3. **Profile update** (staff + customer) logged with field names changed, not values for sensitive fields.  
4. **Construction** create/update/delete paths log at least one row each.  
5. Admin can **query and paginate** all logs for a date range and panel.  
6. Existing lead/employee audit consumers **unchanged** or strictly additive.

---

## 12. Open product questions

1. Log **failed logins** for all panels? (security vs noise)  
2. Should **customer** actions appear in the same admin audit log list? (recommended: yes, `panel: customer`)  
3. Retention policy — TTL index on `AuditLog` after N months?  
4. Should **sales** see only their own audit rows or none?  

---

## Related files

- `src/models/AuditLog.js`  
- `src/services/audit.service.js`  
- `src/config/constants.js` (`AUDIT_TYPES`, `AUDIT_ACTIONS`)  
- `src/utils/auditActivityMessage.js`  
- `src/controllers/auth.controller.js`, `customerAuth.controller.js`  
- `docs/admin-api-leads-scoring-lifecycle-agreement.md` (lead audit timeline reference)
