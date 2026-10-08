# Plant panel changes — customerId, Production Overview filter, customer chat

**Date:** 2026-10-08  
**Audience:** Frontend (Plant panel), QA, product  
**Auth:** Plant role JWT — `Authorization: Bearer <accessToken>`  
**Base path:** `/api/plant`

This document summarizes backend work for:

1. Missing **`customerId`** on `GET /api/plant/projects` (needed for Chat from the projects list).
2. **Production Overview** dropdown (Today / This Week / This Month) on `GET /api/plant/dashboard` — dynamic metrics via `?filter=`.
3. **How Plant should chat with the customer** — REST history, send, and sockets (vs sales lead chat / team chat).

---

## Team questions (original ask)

| Question | Answer |
|----------|--------|
| `customerId` missing on projects list? | **Fixed** — each row has `customerId` and `customer._id`. |
| Project chat via socket `lead:<leadId>` / `sales_message`? | **No** — sales/pre-sales funnel only; not Plant ↔ customer. |
| Direct chat via `team-chat/direct/:customerId`? | **No** — internal **staff** chat only, not customers. |
| REST API for previous chat history? | **`GET /api/plant/customer-direct-chat/:customerId/messages`** (see below). |

---

## Backend files changed / added

| File | Change |
|------|--------|
| `src/controllers/plant/project.controller.js` | `mapProjectRow` adds `customerId` and `customer._id`. |
| `src/controllers/plant/dashboard.controller.js` | `?filter=` drives `productionOverview`; aggregates `DailyProductionLog` + scoped delivery/bundle KPIs. |
| `src/utils/plantProductionOverviewFilter.js` | **New** — normalizes `filter`, resolves date ranges (`today` / `week` / `month`). |
| `src/routes/plant/index.js` | Mounts **`/customer-direct-chat`** (same routes as admin/sales). |
| `docs/plant-panel-api.md` | Project row example + field table for `customerId`. |
| `docs/plant-dashboard-api.md` | Notes that `GET /api/plant/dashboard` is implemented (was outdated). |
| `docs/frontend-customer-direct-chat-api.md` | Adds Plant base path `/api/plant/customer-direct-chat`. |
| `docs/frontend-plant-dashboard-chat-api.md` | Short FE handoff (companion to this doc). |

**Unchanged but related:** `POST /api/plant/dashboard/production-log` — plant staff still upsert daily tonnage/utilization (one doc per calendar day).

---

## 1. `GET /api/plant/projects` — customer id on each row

### Before

```json
"customer": {
  "firstName": "John",
  "lastName": "Smith"
}
```

No top-level `customerId` or `customer._id`.

### After

```json
"customerId": "665a00000000000000000001",
"customer": {
  "_id": "665a00000000000000000001",
  "firstName": "John",
  "lastName": "Smith"
}
```

| Field | Type | Usage |
|--------|------|--------|
| `customerId` | string \| null | Prefer this for chat URLs and socket `customerId`. |
| `customer._id` | string \| null | Same value as `customerId`. |
| `clientName` | string | Unchanged — display `"First Last"`. |

### Example

```http
GET /api/plant/projects?page=1&limit=20
Authorization: Bearer <plant_token>
```

---

## 2. `GET /api/plant/dashboard` — Production Overview filter

### Problem (before)

Response always reflected **today** only (`productionOverviewToday` from a single `DailyProductionLog` + today-scoped delivery/bundle stats). The `?filter=` query param was **ignored** — dropdown showed the same numbers for Today / Week / Month.

### Solution (after)

Pass **`filter`** on the dashboard request. Response includes **`data.productionOverview`** for the selected range.

### Query parameter

| Param | Allowed values | Default |
|--------|----------------|---------|
| `filter` | `today`, `week`, `month` | `today` |

**Aliases (case-insensitive):** `this_week`, `this_month`, `this week`, etc. (normalized in backend).

Invalid `filter` → **400** with message listing allowed values.

### Examples

```http
GET /api/plant/dashboard
GET /api/plant/dashboard?filter=today
GET /api/plant/dashboard?filter=week
GET /api/plant/dashboard?filter=month
Authorization: Bearer <plant_token>
```

### Response shape — `data.productionOverview`

```json
{
  "filter": "week",
  "rangeStart": "2026-10-06T00:00:00.000Z",
  "rangeEndExclusive": "2026-10-09T00:00:00.000Z",
  "plannedTonnage": 120.5,
  "producedTonnage": 98.2,
  "utilizationPct": 76.5,
  "daysLogged": 3,
  "onTimeDeliveryPct": 85.0,
  "reworkRejectionPct": 4.2
}
```

| Field | Meaning |
|--------|---------|
| `plannedTonnage` / `producedTonnage` | **Sum** of daily logs in range; `null` if no logs in range. |
| `utilizationPct` | **Average** of daily `utilizationPct` where logged; `null` if none. |
| `daysLogged` | Count of `DailyProductionLog` documents in range. |
| `onTimeDeliveryPct` | Deliveries on scoped projects marked **delivered** in range (vs planned `deliveryDate`). |
| `reworkRejectionPct` | Bundles **verified** in range with non-empty `mismatchItems`. |
| `rangeStart` / `rangeEndExclusive` | Server-local calendar boundaries (week starts **Monday**). |

### Backward compatibility

When `filter=today`, response also includes **`data.productionOverviewToday`** with the same metrics (for clients that only read the old key).

### What is **not** filtered by `filter`

Top KPI cards under **`data.stats`** (`totalProjects`, `inProduction`, `readyToDispatch`, `dispatchedToday`, `pendingApproval`) are unchanged — not tied to the Production Overview dropdown.

### Logging daily production (unchanged)

```http
POST /api/plant/dashboard/production-log
Content-Type: application/json

{
  "plannedTonnage": 40,
  "producedTonnage": 35,
  "utilizationPct": 82,
  "date": "2026-10-08"
}
```

Omit `date` to upsert **today**. Week/month overview **sums/averages** these daily records.

---

## 3. Plant chat with the customer

### Architecture decision

| Mechanism | Plant use? | Notes |
|-----------|------------|--------|
| Socket `join_lead_chat` / `sales_message`, room `lead:<leadId>` | **No** | Sales/pre-sales `Message` on lead; history e.g. `GET /api/public/leads/:leadId/messages`. |
| Staff `team-chat/direct/:userId` | **No** | Employee-to-employee only. |
| **Customer direct chat** | **Yes** | One thread per **customer**; shared with customer app. |

### REST — history and send (Plant role)

Base: **`/api/plant/customer-direct-chat`**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/conversations?search=&page=&limit=` | Optional inbox list |
| GET | `/:customerId/messages?page=1&limit=50` | **Chat history** (marks customer messages read for staff) |
| POST | `/:customerId/messages` | Send — body `{ "content": "Hello" }` |

Same handlers as admin/sales; only the URL prefix differs.

**History example:**

```http
GET /api/plant/customer-direct-chat/665a00000000000000000001/messages?page=1&limit=50
Authorization: Bearer <plant_token>
```

**Send example:**

```http
POST /api/plant/customer-direct-chat/665a00000000000000000001/messages
Authorization: Bearer <plant_token>
Content-Type: application/json

{ "content": "Your drawings are approved." }
```

Full message shape and pagination: **`docs/frontend-customer-direct-chat-api.md`**.

### Sockets (real-time)

- Connect with **plant JWT** on namespace **`/admin`**.
- **`join_customer_direct`** — payload `{ "customerId": "<mongoId>" }`.
- Send: **`customer_direct_message`** — `{ "customerId": "<mongoId>", "content": "…" }`.
- Listen: **`customer_direct_message`**, optional **`customer_direct_typing`**.

Room (internal): `customer_direct:<customerId>`.

### Wiring from projects list

```text
User clicks Chat on a project row
  → customerId = row.customerId   (from GET /api/plant/projects)
  → GET /api/plant/customer-direct-chat/:customerId/messages
  → join_customer_direct + customer_direct_message for live updates
```

**Note:** Direct chat is per **customer**, not per **lead/project**. Multiple projects for the same client share one thread.

### Customer app project channels (out of scope for Plant REST today)

Customer can use:

```http
GET/POST /api/customer/chat/:channel/messages?leadId=<leadId>
```

`channel`: `project` | `finance` | `construction`.

There is **no** `/api/plant/chat/...` equivalent to read/reply on those channels. If the product requires **per-project** threads in the customer app, a new staff API on that `Message` model is needed later.

---

## 4. Frontend checklist

- [ ] Read **`customerId`** from project list; stop inferring customer from name only.
- [ ] Production Overview dropdown → refetch **`GET /api/plant/dashboard?filter=today|week|month`** and bind **`data.productionOverview`**.
- [ ] Chat screen → **`GET/POST /api/plant/customer-direct-chat/:customerId/messages`** + `/admin` direct-chat socket events.
- [ ] Do **not** use `sales_message` / `join_lead_chat` for Plant customer chat.
- [ ] Do **not** use `team-chat/direct` for customers.

---

## 5. Related documentation

| Doc | Content |
|-----|---------|
| `docs/frontend-plant-dashboard-chat-api.md` | Condensed FE handoff |
| `docs/frontend-customer-direct-chat-api.md` | Message schema, sockets, admin/sales/plant paths |
| `docs/plant-panel-api.md` | Full plant API reference (projects section updated) |
| `docs/plant-dashboard-api.md` | Dashboard module stats + note on main dashboard GET |

---

## 6. Example dashboard response (abbreviated)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalProjects": 12,
      "inProduction": 5,
      "readyToDispatch": 2,
      "dispatchedToday": 1,
      "pendingApproval": 3
    },
    "productionOverview": {
      "filter": "month",
      "rangeStart": "2026-10-01T00:00:00.000Z",
      "rangeEndExclusive": "2026-10-09T00:00:00.000Z",
      "plannedTonnage": 400,
      "producedTonnage": 380,
      "utilizationPct": 79.2,
      "daysLogged": 8,
      "onTimeDeliveryPct": 90.0,
      "reworkRejectionPct": 2.5
    },
    "recentShipperFiles": [],
    "plantAlerts": [],
    "freightCarriers": [],
    "drawingApprovalStatus": []
  }
}
```

When `filter=today`, `productionOverviewToday` may also appear with the same tonnage/KPI fields as `productionOverview`.
