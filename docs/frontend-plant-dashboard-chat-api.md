# Plant panel — dashboard production filter & customer chat

Handoff for **Production Overview** dropdown and **Chat** from the projects list.

**Base:** `/api/plant`  
**Auth:** `Authorization: Bearer <plant JWT>`

---

## 1. `GET /api/plant/projects` — `customerId`

Each project row includes the customer MongoDB id (for chat and deep links):

| Field | Type | Notes |
|--------|------|--------|
| `customerId` | string \| null | Same as `customer._id` |
| `customer._id` | string \| null | Customer document id |
| `customer.firstName` / `lastName` | string | Display name |

Use **`customerId`** from the row when opening chat for that client.

---

## 2. Production Overview — `GET /api/plant/dashboard`

### Query

| Param | Values | Default |
|--------|--------|---------|
| `filter` | `today`, `week`, `month` | `today` |

Aliases: `this_week`, `this_month` (case-insensitive).

Example:

```http
GET /api/plant/dashboard?filter=week
```

### Response — `data.productionOverview`

| Field | Type | Notes |
|--------|------|--------|
| `filter` | string | `today` \| `week` \| `month` |
| `rangeStart` | ISO date | Inclusive start (local calendar day) |
| `rangeEndExclusive` | ISO date | End boundary for metrics |
| `plannedTonnage` | number \| null | Sum of daily logs in range |
| `producedTonnage` | number \| null | Sum of daily logs in range |
| `utilizationPct` | number \| null | Average of logged daily utilization |
| `daysLogged` | number | Count of `DailyProductionLog` days in range |
| `onTimeDeliveryPct` | number \| null | Scoped deliveries marked delivered in range |
| `reworkRejectionPct` | number \| null | Bundles verified in range with mismatches |

Tonnage/utilization come from **`POST /api/plant/dashboard/production-log`** (one log per calendar day). Until days are logged, tonnage fields may be `null`.

When `filter=today`, **`data.productionOverviewToday`** is also set (same numbers) for older clients.

Top stat cards (`stats.totalProjects`, etc.) are **not** filtered by `filter` — only **Production Overview** is.

---

## 3. Plant chat with the customer

### Do **not** use sales lead socket chat

Pre-sales / sales AI chat is **not** the plant ↔ customer channel:

- Socket room `lead:<leadId>`, events `join_lead_chat` / `sales_message` on `/admin`
- History: public `GET /api/public/leads/:leadId/messages` (sales funnel messages on `Message` with `leadId`)

Plant panel is **not** in that matrix. Project list **Chat** should not rely on `sales_message`.

### Do **not** use internal team chat

`team-chat/direct/:userId` is **staff-only** (admin/sales/plant employees), not customers.

### Use **customer direct chat** (recommended for Plant “Chat”)

One thread per **customer** (not per lead). Customer app uses the same thread.

| Action | REST |
|--------|------|
| List thread | `GET /api/plant/customer-direct-chat/:customerId/messages?page=1&limit=50` |
| Send message | `POST /api/plant/customer-direct-chat/:customerId/messages` body `{ "content": "…" }` |
| Inbox (optional) | `GET /api/plant/customer-direct-chat/conversations` |

Same contract as admin/sales; see **`docs/frontend-customer-direct-chat-api.md`** for message shape and sockets.

**Realtime (plant JWT on `/admin` namespace):**

1. `join_customer_direct` with `{ customerId }`
2. Send: `customer_direct_message` with `{ customerId, content }`
3. Listen: `customer_direct_message`

### Customer app project channels (construction / finance / project)

Customer can post on **`GET/POST /api/customer/chat/:channel/messages?leadId=`** (`channel`: `project` \| `finance` \| `construction`). There is **no plant REST** to read/reply on those channels today. If product requires **per-project** chat in the customer app, backend needs a staff endpoint on that `Message` model — direct chat is the supported plant path for now.

---

## Quick FE wiring

```text
Projects list → Chat click
  → read customerId from project row
  → GET /api/plant/customer-direct-chat/:customerId/messages
  → socket join_customer_direct + customer_direct_message for live updates

Dashboard Production Overview dropdown
  → GET /api/plant/dashboard?filter=today|week|month
  → bind UI to data.productionOverview
```
