# Sales panel — manually add lead (FE)

**Date:** 3 Nov 2026  
**Auth:** `Authorization: Bearer <sales accessToken>`  
**Role:** `sales` only

Manually create a lead/project for an **existing customer**, same project fields as admin **Add lead**, with one important difference: the lead is **always assigned to the logged-in sales user**. Do not send `assignedSales` (the server ignores it).

To register a **customer only** (no project yet), use `POST /api/sales/customers/basic` — same body and `201` shape as admin [`POST /api/admin/customers/basic`](../admin-create-basic-customer-api.md) (`firstName`, `email`, `phone`, optional `countryCode` → `{ customer }`). Then call `POST /api/sales/leads` with the returned `customer._id`.

---

## Create customer only (optional first step)

| Method | Path |
|--------|------|
| `POST` | `/api/sales/customers/basic` |

Auth: **sales** role. Request/response/errors match admin basic customer API (see `docs/admin-create-basic-customer-api.md`).

---

## Endpoint

| Method | Path |
|--------|------|
| `POST` | `/api/sales/leads` |

Alias (same handler): `POST /sales/leads`

---

## vs admin add lead

| | Admin `POST /api/admin/leads` | Sales `POST /api/sales/leads` |
|---|---|---|
| Assignment | Optional `assignedSales` | **Always** current user |
| `isHandedToSales` | `true` only if assigned | Always `true` |
| Extra body | — | Optional `notes`, `leadStatus` |
| Customer | Must exist | Must exist and be **active** |
| Response | `{ lead }` | `{ lead }` (no `customer` / `isNewCustomer`) |

---

## Request body

### Required

| Field | Type | Notes |
|-------|------|--------|
| `customerId` | MongoId | Existing customer |
| `projectName` | string | Duplicate names blocked per customer (case-insensitive) |
| `buildingType` | string | |

### Optional — project fields

| Field | Type | Notes |
|-------|------|--------|
| `businessUnit` | string \| null | `storage_material` \| `platform` \| `steel` |
| `location` | string | If empty, built from `city`, `state`, `pincode` when provided |
| `city`, `state`, `pincode` | string | |
| `installAddress` | object | Structured install address |
| `line1` | string | Used with city/state/pincode when building `installAddress` |
| `source` | string | `chat` \| `manual` \| `import` \| `customer_portal` — default **`manual`** |
| `quoteValue` | number | Default `0` |
| `roofStyle`, `roofPitch` | string | |
| `width`, `length`, `height` | number | |
| `doors`, `windows`, `insulation` | number | Persisted as `numDoors`, `numWindows`, `numInsulation` |
| `door`, `window` | number | Aliases for doors/windows |
| `numberOfBuildings` | number | Min 1; default 1 |

### Sales-only optional

| Field | Type | Notes |
|-------|------|--------|
| `notes` | string | Stored on lead |
| `leadStatus` | string | If a valid lifecycle stage, sets `lifecycleStatus` and appends history |

Default lifecycle is `initial_contact`. Common sales stages for `leadStatus`:  
`initial_contact`, `requirements_gathered`, `proposal_sent`, `negotiation`, `deal_closed`, `payment_done`, `converted_to_po`, `sent_to_admin`.

### Do not send

- Customer create fields (`firstName`, `email`, `phone`, etc.) — use customer APIs first, then pass `customerId`.
- **`assignedSales`** — assignee is always the JWT user.

---

## Example

```http
POST /api/sales/leads
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "customerId": "665a00000000000000000001",
  "projectName": "Warehouse B",
  "buildingType": "Storage",
  "businessUnit": "steel",
  "location": "Austin, TX",
  "source": "manual",
  "quoteValue": 120000,
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 12,
  "doors": 2,
  "windows": 4,
  "insulation": 1,
  "notes": "Wants quote by Friday",
  "leadStatus": "initial_contact"
}
```

---

## Success — `201 Created`

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "lead": {
      "_id": "...",
      "customerId": "...",
      "jobId": "2026001",
      "projectId": "2026001",
      "projectName": "Warehouse B",
      "buildingType": "Storage",
      "businessUnit": "steel",
      "businessUnitLabel": "Steel Building Depot",
      "location": "Austin, TX",
      "source": "manual",
      "quoteValue": 120000,
      "assignedSales": "<logged-in sales user _id>",
      "isHandedToSales": true,
      "lifecycleStatus": "initial_contact",
      "numDoors": 2,
      "numWindows": 4,
      "numInsulation": 1,
      "notes": "Wants quote by Friday",
      "createdAt": "..."
    }
  }
}
```

Display `jobId` or `projectId` from the response (year + sequence, e.g. `2026001`). Do not rely on client-generated IDs.

---

## Errors

| HTTP | Message / case |
|------|----------------|
| **400** | Validation (invalid ids, invalid `source`, invalid `businessUnit`, etc.) |
| **400** | `Customer is inactive` |
| **400** | Duplicate project name — *A project with this name already exists for this customer…*; may include `errors.existingLead` |
| **404** | `Customer not found` |
| **401** | Missing or invalid token |
| **403** | User is not `sales` |

---

## Realtime & side effects

- **Socket:** `lead_list_created` on namespace `/admin` for list refresh. When **you** create the lead (`POST /api/sales/leads`), the server **does not** push `lead_list_created` / assignment toasts to your own `user:{salesId}` room (avoids “New Lead Assigned” on self-add). Admin assigning someone else is unchanged. See [lead-list-socket-frontend-guide.md](../lead-list-socket-frontend-guide.md).
- **Audit:** `lead.created`
- **Buildings:** default building row(s) synced from `numberOfBuildings` (default 1)

---

## Related endpoints

| Use case | Endpoint |
|----------|----------|
| Create customer (no project) | `POST /api/sales/customers/basic` |
| List / pick customer | `GET /api/sales/customers` — includes your assigned leads (pre-PO too) and customers you created via `/customers/basic` |
| Add project from customer detail (portfolio required) | `POST /api/sales/customers/:customerId/projects` — same auto-assign-to-self; **403** if customer not in portfolio |
| Admin add lead + optional assign | `POST /api/admin/leads` |
| Edit lead after create | `PUT /api/sales/leads/:leadId` |

**Note:** `POST /api/sales/leads` does not enforce sales portfolio on `customerId`; the customer-scoped project route does.

---

## FE checklist

- [ ] Select existing customer → send `customerId`
- [ ] No assignee picker; show “Assigned to you” after create
- [ ] Reuse admin project form fields (+ optional `notes` / `leadStatus`)
- [ ] On success, refresh list or open detail; subscribe to `lead_list_created`
- [ ] On duplicate name, use `errors.existingLead` if offering “open existing lead”
