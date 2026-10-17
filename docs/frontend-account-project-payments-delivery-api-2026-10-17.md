# Account panel — Project payments (invoice PDFs) & final delivery

**Date:** 2026-10-17  
**Auth:** `admin` | `account` · `Authorization: Bearer <token>`

Related: [`frontend-account-project-detail-api.md`](./frontend-account-project-detail-api.md), [`frontend-account-project-invoices-actions-api-2026-10-17.md`](./frontend-account-project-invoices-actions-api-2026-10-17.md)

---

## 1. Payments table — customer invoice PDF / document URLs

### List payments

```http
GET /api/account/projects/:projectId/payments/records?page=1&limit=10
```

For rows with **`source: "customer_invoice"`**, the API now includes:

| Field | Description |
|-------|-------------|
| `documentUrl` | Payment proof file URL if customer uploaded one; otherwise same as `pdfUrl` for sent/paid/overdue invoices |
| `pdfUrl` | **`GET /api/account/invoices/:invoiceId/pdf`** (relative path — prefix your API base) |
| `documentType` | `payment_proof` \| `generated_pdf` \| `null` |

**Example row:**

```json
{
  "paymentId": "6a7edb2aae96b70ddea69fd4",
  "date": "2026-08-01T00:00:00.000Z",
  "amount": 1690600,
  "relatedTo": "Customer",
  "status": "Received",
  "invoiceNumber": "INV-1002",
  "invoiceId": "6a7edb2aae96b70ddea69fd4",
  "source": "customer_invoice",
  "documentUrl": "/api/account/invoices/6a7edb2aae96b70ddea69fd4/pdf",
  "pdfUrl": "/api/account/invoices/6a7edb2aae96b70ddea69fd4/pdf",
  "documentType": "generated_pdf"
}
```

Payable rows (`source: payable_invoice`) still use vendor **`documentUrl`** from payable workflow when present.

### Download customer invoice PDF

```http
GET /api/account/invoices/:invoiceId/pdf
Authorization: Bearer <token>
```

- **Response:** `application/pdf` (inline), same layout as emailed invoice.
- **404** if invoice or customer missing.
- **400** for vendor/carrier payables.

Also on **project invoices** list:

```http
GET /api/account/projects/:projectId/invoices/records
```

Each record includes **`documentUrl`**, **`pdfUrl`**, **`documentType`** with the same rules.

---

## 2. Final delivery (project detail — Delivery Details screen)

Use this when the UI only has **`projectId`** (no delivery id), aligned with plant **`GET /api/plant/projects/:leadId/delivery`**.

### Primary

```http
GET /api/account/projects/:projectId/delivery
Authorization: Bearer <token>
```

Returns the **latest confirmed delivery** for the project (carrier selected, status in scheduled → delivered).

### Success `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "isFinal": true,
    "delivery": {
      "deliveryId": "6ac40e5994a6cf8feeec66f0",
      "deliveryNumber": "DEL-001",
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
        "phone": "+1..."
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
        "email": "..."
      },
      "siteCoordination": {
        "siteInstructions": "...",
        "requiredEquipment": "...",
        "equipmentConfirmationStatus": "Pending",
        "specialNotes": "..."
      },
      "documents": {
        "documentUrl": "https://.../delivery-doc.pdf",
        "attachments": [],
        "items": [{ "name": "Delivery document", "type": "file", "url": "https://..." }]
      },
      "quickActions": {
        "viewDocuments": []
      },
      "freightLoadId": null
    }
  }
}
```

### Figma mapping

| UI block | Field |
|----------|--------|
| Header subtitle | `deliveryNumber`, `title` |
| Delivery Overview | `overview.*`, `customer.customerName` |
| Delivery Information | `deliveryInformation.*` |
| Receiving POC | `receivingPoc` |
| Vendor / Delivery company | `vendor`, `deliveryCompany` |
| Status history | `statusHistory` |
| View Documents / Download | `documents.documentUrl`, `documents.items[]` |

### Errors

| HTTP | When |
|------|------|
| `404` | Unknown project, or no confirmed delivery on project |

### By delivery id (unchanged path, enriched payload)

```http
GET /api/account/projects/:projectId/deliveries/:deliveryId
```

Same **`delivery`** object shape as above (without top-level `isFinal`).

### List (unchanged)

```http
GET /api/account/projects/:projectId/deliveries?page=1&limit=20
```

---

## 3. Screen → API

| Screen | API |
|--------|-----|
| Project → View Payments table | `GET .../payments/records` — use `pdfUrl` / `documentUrl` on customer rows |
| Open invoice PDF | `GET /api/account/invoices/:invoiceId/pdf` |
| Project → Material Delivery detail (default) | `GET .../delivery` |
| Specific delivery from list | `GET .../deliveries/:deliveryId` |

`GET /api/account/projects/:projectId` → **`actionLinks.delivery`** → `.../delivery`

---

*Backend: `customerInvoiceDocument.util.js`, `accountDeliveryDetail.util.js`, `accountProjectSubpages.service.js`*
