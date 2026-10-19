# Sales panel — project final delivery detail (fix handoff)

**Date:** 2026-10-19  
**Audience:** Frontend — **Sales** (also reference for construction / account parity)  
**Auth:** `Authorization: Bearer <token>`  
**Prod base:** `https://mr-storage-backend-025k.onrender.com` (when deploy branch includes commit `11f5222`+)

---

## 1. What was wrong

The **Delivery Details** screen (Figma) needs the **final confirmed delivery** for a project when you only have the **lead / project id** — same enriched payload as account (`overview`, `vendor`, `deliveryCompany`, `documents`, etc.).

| Panel | Before fix | After fix |
|-------|------------|-----------|
| Account | `GET /api/account/projects/:projectId/delivery` | Unchanged |
| Construction | `GET /api/construction/projects/:leadId/delivery` | Unchanged |
| **Sales** | **Missing** — docs pointed at construction URL | **`GET /api/sales/construction/projects/:leadId/delivery`** |

Sales users **cannot** call `/api/construction/...` (construction `roleGuard` rejects the sales JWT). Wiring the sales UI to the construction path always fails with **403 Forbidden**.

---

## 2. What to use on Sales

### 2.1 Final delivery (primary — project detail / Material Delivery tab)

```http
GET /api/sales/construction/projects/:leadId/delivery
Authorization: Bearer <sales token>
```

| Param | Type | Notes |
|-------|------|--------|
| `leadId` | MongoDB `_id` | Same id as project / lead elsewhere in sales |

**Access (server):**

- Lead exists, not terminated/archived  
- `assignedSales` = current user  
- `lifecycleStatus` in plant/construction scope (`PLANT_LIFECYCLE_STAGES`)

**Logic:** Same service as account/construction — latest delivery for this lead where a carrier is selected and status is in the **confirmed** set (see §4).

### 2.2 Delivery detail when you already have `deliveryId`

```http
GET /api/sales/construction/projects/:leadId/deliveries/:deliveryId
Authorization: Bearer <sales token>
```

Same **`delivery`** object as §3 (no top-level `isFinal`).

### 2.3 Related (calendar / project list — unchanged)

```http
GET /api/sales/construction/projects/calendar?month=9&year=2026&leadId=<optional>
GET /api/sales/construction/projects?businessUnit=
```

Deep-link from calendar → open detail with **§2.1** or **§2.2**, not construction URLs.

---

## 3. Response shape (Sales = Account = Construction final route)

### Success `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "isFinal": true,
    "delivery": {
      "deliveryId": "6ac40e5994a6cf8feeec66f0",
      "deliveryNumber": "DEL-2026-0001",
      "title": "Primary frame steel",
      "status": "scheduled",
      "statusHistory": [],
      "project": {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Industrial Complex A",
        "jobId": "PRO-001"
      },
      "customer": {
        "customerId": "...",
        "customerName": "Acme Corporation",
        "email": "billing@acme.com",
        "phone": { "number": "...", "countryCode": "+1" }
      },
      "overview": {
        "status": "scheduled",
        "projectName": "Industrial Complex A",
        "customerName": "Acme Corporation",
        "deliveryDate": "2024-03-25T00:00:00.000Z",
        "timeWindow": "8:00 AM - 12:00 PM",
        "siteAddress": "1234 Industrial Blvd, Austin, TX"
      },
      "deliveryInformation": {
        "description": "Primary frame steel",
        "materialCategory": "Steel",
        "pickupDate": "2024-03-24T00:00:00.000Z"
      },
      "receivingPoc": {
        "name": "Austin McClume",
        "phone": "+1 555-0303",
        "email": "austin@acmecorp.com"
      },
      "vendor": {
        "company": "Steel Supply Co.",
        "contactName": "John Miller",
        "phone": "+1 555-0101",
        "email": "john@steelsupply.com"
      },
      "deliveryCompany": {
        "company": "Fast Freight LLC",
        "contactName": "Sarah Transport",
        "phone": "+1 555-0202",
        "email": "carrier@example.com"
      },
      "siteCoordination": {
        "siteInstructions": "...",
        "requiredEquipment": "Forklift",
        "equipmentConfirmationStatus": "Pending",
        "specialNotes": "..."
      },
      "documents": {
        "documentUrl": "https://.../delivery-doc.pdf",
        "attachments": [],
        "items": [
          { "name": "Delivery document", "type": "file", "url": "https://.../delivery-doc.pdf" }
        ]
      },
      "quickActions": {
        "viewDocuments": []
      },
      "freightLoadId": null
    }
  }
}
```

`vendor` / `deliveryCompany` may be `null` if no approved shipper or carrier bid on the delivery.

### By delivery id — `200` `data`

```json
{
  "delivery": { "...": "same object as above" }
}
```

---

## 4. Enums

### 4.1 Statuses that qualify for “final delivery” GET

Delivery must have **`selectedCarrierBidId`** set and **`status`** in:

| `status` value |
|----------------|
| `carrier_selected` |
| `scheduled` |
| `confirmed` |
| `material_prepared` |
| `loaded` |
| `picked_up` |
| `in_transit` |
| `staged` |
| `dispatched_to_site` |
| `delayed` |
| `delivered` |

Server picks the **most recently updated** matching row (`updatedAt` desc).

### 4.2 All delivery `status` values (model)

`draft`, `bidding_sent`, `carrier_selected`, `scheduled`, `confirmed`,  
`material_prepared`, `loaded`, `picked_up`, `in_transit`, `staged`, `dispatched_to_site`, `delivered`,  
`partial_received`, `received`, `delayed`, `cancelled`, `rescheduled`

Draft / bidding-only deliveries are **not** returned by the final-delivery GET.

---

## 5. Errors

| HTTP | `message` (typical) | Sales UI hint |
|------|---------------------|---------------|
| `401` | Unauthorized | Refresh token |
| `403` | Access denied | Not assigned sales rep |
| `404` | Project not found | Bad id or out of scope / archived |
| `404` | No confirmed delivery found for this project | Empty state — carrier not selected yet |

Envelope:

```json
{ "success": false, "message": "No confirmed delivery found for this project" }
```

---

## 6. Figma → API mapping

| Screen block | Fields |
|--------------|--------|
| Header | `delivery.deliveryNumber`, `delivery.title`, `delivery.status` |
| Delivery overview | `delivery.overview.*`, `delivery.customer.customerName` |
| Delivery information | `delivery.deliveryInformation.*` |
| Receiving POC | `delivery.receivingPoc` |
| Vendor | `delivery.vendor` |
| Delivery company (carrier) | `delivery.deliveryCompany` |
| Site coordination | `delivery.siteCoordination.*` |
| Status history | `delivery.statusHistory` |
| View / download documents | `delivery.documents.documentUrl`, `delivery.documents.items[]` |

Read-only on sales — status changes stay on plant/construction/admin delivery workflows.

---

## 7. Other panels (reference — do not use from Sales app)

| Panel | Final delivery | Detail by id |
|-------|----------------|--------------|
| **Sales** | `GET /api/sales/construction/projects/:leadId/delivery` | `GET /api/sales/construction/projects/:leadId/deliveries/:deliveryId` |
| Account | `GET /api/account/projects/:projectId/delivery` | `GET /api/account/projects/:projectId/deliveries/:deliveryId` |
| Construction | `GET /api/construction/projects/:leadId/delivery` | `GET /api/construction/deliveries/:deliveryId` (+ optional `card` in response) |

Account extended notes: [`frontend-account-project-payments-delivery-api-2026-10-17.md`](./frontend-account-project-payments-delivery-api-2026-10-17.md)

Broader cross-panel index: [`frontend-cross-panel-drawings-customer-docs-full-handoff-2026-10-19.md`](./frontend-cross-panel-drawings-customer-docs-full-handoff-2026-10-19.md)

---

## 8. Backend (this fix)

| File | Change |
|------|--------|
| `src/routes/sales/construction.routes.js` | Register GET delivery routes under `/api/sales/construction` |
| `src/controllers/sales/construction.controller.js` | `getProjectFinalDelivery`, `getProjectDeliveryDetail` + sales assignment guard |
| `src/services/accountProjectSubpages.service.js` | Shared `getProjectFinalDelivery` / `formatAccountDeliveryDetail` (unchanged) |

---

## 9. Sales checklist

- [ ] Project delivery / Material Delivery screen → **`GET /api/sales/construction/projects/:leadId/delivery`**
- [ ] Remove any call to **`GET /api/construction/projects/:leadId/delivery`** from sales builds
- [ ] Handle **404** when no carrier-selected delivery exists
- [ ] Calendar / project list deep links use sales paths (§2)
