# Account panel — Project detail view (Figma)

Base: **`/api/account/projects`**  
Auth: **`account`** or **`admin`**.

---

## Request

```http
GET /api/account/projects/Q-2025-1047 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

Use Mongo **`leadId`** or display **`jobId`** (e.g. `Q-2025-1047`, `2025001`).

---

## Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "overview": {
      "leadId": "67a1b2c3d4e5f6789012345a",
      "projectName": "Project 1- ABC Warehouse",
      "jobId": "Q-2025-1047",
      "projectId": "Q-2025-1047",
      "status": "proposal_sent",
      "statusLabel": "Proposal Sent",
      "buildingType": "Workshop",
      "quoteValue": 12500,
      "createdOn": "2024-10-10T00:00:00.000Z",
      "location": "1816 Bayonne Ave, Manchester, NJ"
    },
    "contact": {
      "name": "John Doe",
      "phone": "+1 632459315",
      "email": "darlee@example.com",
      "address": "1861 Bayonne Ave",
      "company": "ABC Industries"
    },
    "assignment": {
      "_id": "67a1b2c3d4e5f6789012345b",
      "name": "Sarah Lee",
      "role": "Sales Person"
    },
    "agreement": {
      "signed": true,
      "documentName": "Signed contract.pdf",
      "signedOn": "2025-04-12T00:00:00.000Z",
      "url": "https://..."
    },
    "financialSummary": {
      "projectValue": 8400000,
      "totalInvoiced": 8400000,
      "totalReceived": 7200000,
      "outstanding": 1200000,
      "totalProjectCost": 5800000,
      "expectedProfit": 3900000,
      "actualProfit": 2600000,
      "actualMargin": 31
    },
    "progressStep": {
      "steps": [
        { "stepNumber": 1, "key": "initial_contact", "label": "Initial Contact", "status": "completed", "date": "2024-10-10T00:00:00.000Z" },
        { "stepNumber": 6, "key": "payment_done", "label": "Payment Done", "status": "current", "date": "2024-10-10T00:00:00.000Z" }
      ],
      "totalSteps": 8,
      "completedSteps": 5,
      "progressLabel": "5 of 8",
      "currentStepKey": "payment_done",
      "currentStepLabel": "Payment Done",
      "lifecycleStatus": "payment_done",
      "lifecycleStatusLabel": "Payment Done",
      "leadGeneratedDate": "2024-10-10T00:00:00.000Z",
      "currentStepDate": "2024-10-10T00:00:00.000Z",
      "assignedSales": { "_id": "...", "name": "Sarah Lee", "role": "Sales Person" },
      "priority": "medium",
      "nextStepLabel": "Converted to PO",
      "nextStepNote": "Convert this lead to PO after this. Automatically sent to admin and accounts."
    },
    "profitabilityOverview": [
      { "key": "revenue", "label": "Revenue", "expected": 48200000, "actual": 46800000, "variance": -1400000 },
      { "key": "marginPct", "label": "Margin", "expected": 38.4, "actual": 26.7, "variance": -11.7, "unit": "percent" }
    ],
    "actionLinks": {
      "invoices": "/api/account/invoices?leadId=67a1...",
      "projectInvoicesBreakdown": "/api/account/invoices/project/67a1.../breakdown",
      "payments": "/api/account/payments/orders/67a1...",
      "agreement": "/api/admin/customers/{customerId}/projects/{leadId}/agreement",
      "quotation": "/api/sales/leads/{leadId}",
      "bom": "/api/plant/bom/projects/{leadId}"
    }
  }
}
```

---

## UI mapping

| Figma block | `data` path |
|-------------|-------------|
| Header (name, id, status badge, building, quote, created, location) | `overview` |
| Contact information | `contact` |
| Assignment | `assignment` |
| Signed contract | `agreement` |
| Blue KPI row (value, invoiced, received, outstanding) | `financialSummary` (first four fields) |
| White KPI row (cost, expected/actual profit, margin) | `financialSummary` (remaining fields) |
| Progress stepper | `progressStep.steps` |
| Status card (progress, dates, sales, priority, note) | `progressStep` |
| Financial performance table | `profitabilityOverview` |
| Action buttons | `actionLinks` (+ existing account/plant/sales routes) |

---

## List (unchanged)

```http
GET /api/account/projects?search=&status=payment_done&startDate=&endDate=
```

Returns `{ projects: [...] }` for account project lists.
