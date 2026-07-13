# Payment schedule — update API (frontend)

**Last updated:** 2026-06-17

One payment schedule per project (`leadId`). Use **create** once, then **update** to edit stages.

| Action | Method | Path |
|--------|--------|------|
| Create | `POST` | `/api/payment-schedules` |
| **Update** | **`PUT`** | **`/api/payment-schedules/lead/:leadId`** |
| Get | `GET` | `/api/payment-schedules/lead/:leadId` |

**Auth:** JWT required  
**Roles:** `admin`, `sales` (sales only for leads assigned to them)

---

## `PUT /api/payment-schedules/lead/:leadId`

Update the payment schedule for a project.

### Path params

| Param | Type | Description |
|-------|------|-------------|
| `leadId` | string | Project / lead Mongo `_id` |

### Request body

| Field | Required | Type | Notes |
|-------|----------|------|--------|
| `stages` | **Yes** | array | Min 1 stage |
| `totalAmount` | No | number | Required logic for `fixed` stages (see validation). If omitted, keeps existing schedule `totalAmount` |

### Stage object (`stages[]`)

| Field | Required | Type | Notes |
|-------|----------|------|--------|
| `_id` | No | string | Include for **existing** stages (from GET). Omit for **new** stages |
| `stageName` | **Yes** | string | e.g. `Deposit`, `On delivery` |
| `amount` | **Yes** | number | Percentage (0–100) or fixed currency amount |
| `amountType` | **Yes** | string | `percentage` or `fixed` — **all stages must use the same type** |
| `dueDate` | No | string | ISO 8601 date, e.g. `2026-06-01T00:00:00.000Z` |

**Do not send** on update: `status`, `invoiceId`, `paidAt`, `paidBy` — server preserves these for existing stages matched by `_id`.

---

### Example — percentage stages (sum = 100)

```json
{
  "totalAmount": 1917952,
  "stages": [
    {
      "_id": "665b1b2c3d4e5f6789012341",
      "stageName": "Deposit",
      "amount": 30,
      "amountType": "percentage",
      "dueDate": "2026-06-01T00:00:00.000Z"
    },
    {
      "_id": "665b1b2c3d4e5f6789012342",
      "stageName": "On delivery",
      "amount": 70,
      "amountType": "percentage",
      "dueDate": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

### Example — fixed amount stages (sum = `totalAmount`)

```json
{
  "totalAmount": 500000,
  "stages": [
    {
      "_id": "665b1b2c3d4e5f6789012341",
      "stageName": "Deposit",
      "amount": 150000,
      "amountType": "fixed",
      "dueDate": "2026-06-01T00:00:00.000Z"
    },
    {
      "stageName": "Final payment",
      "amount": 350000,
      "amountType": "fixed",
      "dueDate": "2026-08-01T00:00:00.000Z"
    }
  ]
}
```

Second stage has no `_id` → treated as a **new** pending stage.

---

### Validation rules

| Rule | HTTP | Message (example) |
|------|------|-------------------|
| Schedule must exist for `leadId` | 404 | Payment schedule not found for this lead |
| `stages` min length 1 | 400 | Validation error from route |
| All `amountType` must match | 400 | All stages must use the same amountType |
| Percentages sum to **100** | 400 | Percentage stages must sum to 100. Got … |
| Fixed amounts sum to **`totalAmount`** | 400 | Fixed stages must sum to totalAmount (…). Got … |
| Cannot remove invoiced / paid stage | 400 | Cannot remove stage "…" while it is linked to an invoice or no longer pending |

**Removal rule:** A stage is removed if it is **not** in the `stages` array. Stages with `invoiceId` or status `invoiced`, `paid`, or `overdue` **cannot** be removed.

**Merge rule:** Stages with matching `_id` keep server fields: `status`, `invoiceId`, `paidAt`, `paidBy`. You can change `stageName`, `amount`, `amountType`, `dueDate`.

---

### Success response `200`

```json
{
  "success": true,
  "message": "Payment schedule updated",
  "data": {
    "schedule": {
      "_id": "665b1b2c3d4e5f6789012340",
      "leadId": "665a1b2c3d4e5f6789012345",
      "customerId": "664c1b2c3d4e5f6789012340",
      "totalAmount": 1917952,
      "createdBy": "664c1b2c3d4e5f6789012341",
      "stages": [
        {
          "_id": "665b1b2c3d4e5f6789012341",
          "stageName": "Deposit",
          "amount": 30,
          "amountType": "percentage",
          "dueDate": "2026-06-01T00:00:00.000Z",
          "status": "pending",
          "invoiceId": null,
          "paidAt": null,
          "paidBy": null
        },
        {
          "_id": "665b1b2c3d4e5f6789012342",
          "stageName": "On delivery",
          "amount": 70,
          "amountType": "percentage",
          "dueDate": "2026-07-01T00:00:00.000Z",
          "status": "invoiced",
          "invoiceId": "665c1b2c3d4e5f6789012345",
          "paidAt": null,
          "paidBy": null
        }
      ],
      "createdAt": "2026-05-15T10:00:00.000Z",
      "updatedAt": "2026-06-17T14:30:00.000Z"
    }
  }
}
```

### Stage `status` values

| Status | Meaning |
|--------|---------|
| `pending` | No invoice linked yet |
| `invoiced` | Linked invoice created |
| `paid` | Linked invoice marked paid |
| `overdue` | Past due (system-managed) |

---

## Recommended FE flow

```text
1. GET /api/payment-schedules/lead/:leadId
   → load schedule + stage _ids

2. User edits form (add / rename / reorder / change amounts / due dates)

3. PUT /api/payment-schedules/lead/:leadId
   → send full stages[] array:
     - existing rows: include _id from GET
     - new rows: omit _id
     - removed rows: omit from array (only if still pending & not invoiced)

4. Use response.data.schedule as source of truth (refresh UI)
```

---

## Create (first time only)

If no schedule exists, use **POST** instead:

```http
POST /api/payment-schedules
```

```json
{
  "leadId": "665a1b2c3d4e5f6789012345",
  "totalAmount": 1917952,
  "stages": [
    {
      "stageName": "Deposit",
      "amount": 30,
      "amountType": "percentage",
      "dueDate": "2026-06-01T00:00:00.000Z"
    },
    {
      "stageName": "On delivery",
      "amount": 70,
      "amountType": "percentage",
      "dueDate": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

Returns `201` if created. Returns `400` if schedule already exists for that lead.

---

## Linking invoices to stages

When creating an invoice:

```http
POST /api/leads/:leadId/invoices
```

Optional body field:

```json
{
  "paymentScheduleStageId": "665b1b2c3d4e5f6789012341"
}
```

Use the stage `_id` from the schedule. That stage’s status becomes `invoiced` when the invoice is created.

---

## Related docs

- [sales-admin-po-invoice-sync-changes.md](./sales-admin-po-invoice-sync-changes.md) — invoice edit + payment schedule section
- [api-changelog-edited-endpoints.md](./api-changelog-edited-endpoints.md) — §30 payment schedules
