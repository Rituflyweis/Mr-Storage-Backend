# Frontend handoff — Customer deliveries, construction dashboard KPIs, construction deliveries

**Audience:** Frontend (customer app + construction panel)  
**Source:** Extract from [`frontend-integration-handoff-2026-10.md`](./frontend-integration-handoff-2026-10.md) §3–§5  
**Prod base:** `https://mr-storage-backend-025k.onrender.com/api`  
**Envelope:** `{ "success": true, "message": "Success", "data": { … } }`

---

## At a glance

| Section | Panel / app | Topic |
|--------|-------------|--------|
| **§3** | Customer app | Customer delivery **schedule** (their projects only) |
| **§4** | Construction (+ admin) | Dashboard **project KPIs** vs **projects list** totals — do not mix numbers |
| **§5** | Construction (+ admin) | Staff **logistics deliveries** list (Figma) — filters, stats, export |

Same business object (**`Delivery`**) can appear in §3 and §5, but **different routes, auth, and response shapes**. Sales read-only deliveries are **not** §5 — see [§6 sales gap](#sales-panel-not-covered-here) below.

---

## §3 — Customer panel — deliveries (schedule)

### Purpose

Let the **logged-in customer** see delivery schedule and details for **their** projects. View-oriented; scheduling changes are staff-side.

### Auth

```http
Authorization: Bearer {customerToken}
```

From `POST /api/customer/auth/login`.

### Endpoints

| Action | Method | Path |
|--------|--------|------|
| Summary across all customer projects | GET | `/api/customer/deliveries/summary` |
| Schedule (all projects or one project) | GET | `/api/customer/deliveries?tab={tab}&leadId={optional}` |
| Schedule for one project | GET | `/api/customer/deliveries/{leadId}?tab={tab}` |
| Single delivery detail | GET | `/api/customer/deliveries/{deliveryId}` |

### Query: `tab`

| Value | Use for UI |
|--------|------------|
| `upcoming` | Default / active schedule |
| `past` | Completed or historical |
| `rescheduled` | Rescheduled items |

Optional `leadId` on the list route scopes to one project when the customer is on a project detail screen.

### Do / don’t

| Do | Don’t |
|----|--------|
| Use customer routes above for the customer app deliveries screens | Call `/api/construction/deliveries` from the customer app |
| Expect **`Delivery`**-backed data for this customer | Assume the JSON matches the construction list in §5 |

### Related APIs (not duplicated here)

PDFs, contact driver, contact carrier, site ready, etc.: see [`frontend-customer-app-api-full.md`](./frontend-customer-app-api-full.md) **§2.8**.

---

## §4 — Construction panel — dashboard KPIs vs projects list

### Purpose

Avoid showing **mismatched project counts** on construction home (dashboard) vs construction projects table.

### Two different APIs

```http
GET /api/construction/dashboard
GET /api/construction/projects?page=1&limit=…&search=…&…
Authorization: Bearer {constructionOrAdminToken}
```

### What each `total` means

| Source | Field | Typical meaning |
|--------|--------|------------------|
| Dashboard | `data.projectStats.total` | **Active projects only** — excludes `lifecycleStatus === delivered` |
| Dashboard | `data.projectStats.totalIncludingCompleted` | Active **+** delivered |
| Projects list | `data.total` | **Row count after list filters** (`search`, `hasDelivery`, `priority`, etc.) |

**Example from handoff:** dashboard active `30`, including completed `32`, projects list `18` — all can be correct at once if the list has extra filters.

### Integration rules

1. **Do not** compare dashboard `projectStats.total` to projects list `data.total` on the same UI row without explaining filters.
2. **Do** compare dashboard `projectStats` to projects response **`data.projectStats`** when both views use the **same** scope (e.g. only `businessUnit` / `status`).
3. If numbers still diverge, read on the projects response:
   - `data.listFiltersApplied`
   - `data.listOnlyFilters`  
   List-only filters affect **`data.total`** but not necessarily dashboard cards.

### Dashboard Excel export

```http
GET /api/construction/dashboard/export
Authorization: Bearer {constructionOrAdminToken}
```

Same query parameters as `GET /api/construction/dashboard`. Downloads `construction-dashboard-export.xlsx`.

**Deep dive:** [`frontend-construction-dashboard-api.md`](./frontend-construction-dashboard-api.md)

---

## §5 — Construction panel — deliveries list (Figma logistics)

### Purpose

Construction (and admin) **operations** screen: paginated deliveries, search/filters, KPI chips, detail, export. Matches Figma logistics / delivery list — **not** the customer app (§3).

### Auth

| Role | `/api/construction/deliveries*` |
|------|----------------------------------|
| `construction` | ✅ |
| `admin` | ✅ |
| `sales` | ❌ — use [sales gap](#sales-panel-not-covered-here) |

### Endpoints

| Action | Method | Path |
|--------|--------|------|
| List | GET | `/api/construction/deliveries` |
| Filter dropdown options | GET | `/api/construction/deliveries/filters` |
| Detail | GET | `/api/construction/deliveries/{deliveryId}` |
| Export | GET | `/api/construction/deliveries/export` |

### List query parameters (common)

| Param | Notes |
|--------|--------|
| `page`, `limit` | Pagination |
| `sortBy` | e.g. `Latest`, `Oldest`, `DeliveryDate` |
| `search` | Delivery #, material, description, location, POC, **or** matching project/customer names |
| `status` / `deliveryStatus` | e.g. `scheduled`, `confirmed`, `in_transit`, `delivered` |
| `leadId` / `projectId` | Single project scope |
| `startDate`, `endDate` | Filter on `deliveryDate` |
| `materialType`, `siteDestination`, `transporter`, `driver` | Optional |

### List row → Figma mapping

| UI label | API field |
|----------|-----------|
| Delivery ID | `deliveryNumber` |
| Status badge | `status` |
| Project (and customer on admin routes) | `project.projectName`, `project.jobId`, `project.leadId` |
| Scheduled date/time | `schedule.deliveryDate`, `schedule.deliveryTime` or `schedule.timings` |
| Material / weight | `materialType` or `description`; `loadWeight` |
| Address | `deliveryLocation` |
| Carrier / driver / phone | `carrier.name`, `carrier.contactName`, `carrier.phone` |
| View details | `GET …/deliveries/{deliveryId}` |

### Top KPI chips (`data.stats`)

On current backend, stats use the **same filter as the list** when deployed with latest code:

| API field | Meaning |
|-----------|---------|
| `inTransit` | Count in fulfillment rollup (not `delivered`) |
| `staged` | `status === confirmed` |
| `ready` | `status === scheduled` |
| `totalToday` | `deliveryDate` is **today** |

These are **not** the same labels as Sales Figma (“Scheduled This Week”, “Completed”). For week/completed totals use **`total`** + `status=delivered` or date-range queries (see main handoff §6).

### Empty list vs non-zero stats

**Expected (latest backend):** if `deliveries: []` and `total: 0`, then **`stats` should be all 0** and `statsScope: "filtered"`.

If you see `total: 0` with large `stats` and **no `statsScope`**, production may be on an **older build** — coordinate backend redeploy.

**Search example:** `search=adam` returns zero rows if no deliveries are linked to leads/customers matching that text — not a FE bug.

### Example list response (abbreviated)

```json
{
  "success": true,
  "data": {
    "deliveries": [
      {
        "deliveryId": "67a1b2c3d4e5f6789012345a",
        "deliveryNumber": "DEL-2024-1247",
        "status": "confirmed",
        "description": "Steel & Metal",
        "materialType": "Steel & Metal",
        "loadWeight": 24000,
        "schedule": {
          "deliveryDate": "2024-03-25T00:00:00.000Z",
          "deliveryTime": "09:00",
          "timings": "09:00 AM"
        },
        "deliveryLocation": "450 Market St, San Francisco, CA 94102",
        "receivingPoc": "John Site Manager",
        "carrier": {
          "name": "FastFreight Logistics",
          "contactName": "Mike Johnson",
          "phone": "(555) 234-5678",
          "email": "mike@fastfreight.com"
        },
        "project": {
          "leadId": "6ac4e5e6570533c2c601ed40",
          "projectName": "Downtown Office Tower - Phase 2",
          "jobId": "PRO-1021",
          "location": "San Francisco, CA"
        }
      }
    ],
    "total": 6,
    "stats": {
      "inTransit": 1,
      "staged": 7,
      "ready": 7,
      "totalToday": 1
    },
    "statsScope": "all",
    "page": 1,
    "limit": 20
  }
}
```

**Add delivery (construction):** [`frontend-construction-add-delivery-api.md`](./frontend-construction-add-delivery-api.md)  
**Plant MR + 3-step logistics + notifications:** [`frontend-plant-construction-logistics-notifications-api.md`](./frontend-plant-construction-logistics-notifications-api.md)

---

## Sales panel (not covered here)

Sales Figma **Customer Delivery Schedule** (read-only) has **no** `GET /api/sales/.../deliveries` today.

| Option | Notes |
|--------|--------|
| **Blocked** | Reuse `/api/construction/deliveries` with sales JWT |
| **Interim (admin only)** | `GET /api/admin/construction/deliveries` |
| **Interim (sales)** | Calendar only: `GET /api/sales/construction/projects/calendar?month=&year=` |
| **Target** | Backend to add `GET /api/sales/deliveries` scoped to assigned leads |

Full detail: [`frontend-integration-handoff-2026-10.md`](./frontend-integration-handoff-2026-10.md) §6.

---

## Quick cURL (prod)

```bash
# §3 — Customer deliveries summary
curl -s "https://mr-storage-backend-025k.onrender.com/api/customer/deliveries/summary" \
  -H "Authorization: Bearer CUSTOMER_JWT"

# §3 — Customer upcoming (one project)
curl -s "https://mr-storage-backend-025k.onrender.com/api/customer/deliveries/LEAD_ID?tab=upcoming" \
  -H "Authorization: Bearer CUSTOMER_JWT"

# §4 — Construction dashboard (check projectStats)
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/dashboard" \
  -H "Authorization: Bearer STAFF_JWT"

# §5 — Construction deliveries list
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/deliveries?page=1&limit=20" \
  -H "Authorization: Bearer STAFF_JWT"
```

---

## Related docs index

| Topic | Doc |
|--------|-----|
| Full Oct 2026 handoff | [`frontend-integration-handoff-2026-10.md`](./frontend-integration-handoff-2026-10.md) |
| Customer app (deliveries §2.8) | [`frontend-customer-app-api-full.md`](./frontend-customer-app-api-full.md) |
| Construction dashboard | [`frontend-construction-dashboard-api.md`](./frontend-construction-dashboard-api.md) |
