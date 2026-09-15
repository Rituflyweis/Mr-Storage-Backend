# Admin Employee Profile API — Frontend Contract

**Date:** 2026-09-14  
**Status:** Available on backend branch `shubham-changes-13-aug` after deploy  
**Purpose:** One API call loads the full Employee Profile screen (header + Personal Info + Assigned tab + Performance tab) for **sales**, **plant**, and other staff roles.

---

## Endpoint

| | |
|---|---|
| **Method** | `GET` |
| **Path** | `/api/admin/employees/:userId/profile` |
| **Auth** | Admin JWT — `Authorization: Bearer <accessToken>` |
| **Legacy** | `GET /api/admin/employees/:userId` still works (old shape). Use **`/profile`** for the new UI. |

**Base URL examples**

- Local: `http://localhost:5001`
- UAT: your UAT API host (e.g. `https://uat.flyweistechnology.com` if API is mounted there)

---

## Query parameters (all optional)

| Param | Type | Notes |
|--------|------|--------|
| `startDate` | ISO date | Filters assigned list + several performance counts |
| `endDate` | ISO date | Inclusive end of day |
| `assignedPage` | number | Pagination for assigned tab (default `1`) |
| `assignedLimit` | number | Page size (default `10`, max `200`) |
| `page`, `limit` | number | Aliases for `assignedPage` / `assignedLimit` |
| `lifecycleBucket` | `active` \| `closed` \| `all` | **Sales only** — default `all` |
| `temperature`, `scoreState`, `status` | `hot` \| `warm` \| `cold` | **Sales only** — filter assigned leads |
| `revenuePeriod` | `all` \| `year` \| `month` | **Sales only** — revenue card period (default `all`) |

---

## Response envelope

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "header": { },
    "personalInfo": { },
    "assignedWork": { },
    "performance": { },
    "employee": { }
  }
}
```

Render tabs from **`assignedWork.kind`** and **`performance.kind`** (role-specific).

---

## 1. Header (all roles)

Used for the top profile card (photo, name, role, join date, active badge, “X leads assigned” / “X active projects”).

```json
"header": {
  "employeeId": "69e61375e2dc3d6e7468ca3d",
  "name": "Sarah Johnson",
  "avatar": "",
  "role": "sales",
  "roleLabel": "Manager - Sales",
  "roleDisplay": "Sales",
  "department": "",
  "joinedAt": "2026-01-15T08:00:00.000Z",
  "isActive": true,
  "workSummary": {
    "count": 45,
    "label": "leads assigned",
    "shortLabel": "45 leads assigned"
  }
}
```

| `role` | `workSummary.label` |
|--------|---------------------|
| `sales` | `leads assigned` |
| `plant`, `construction` | `active projects` |
| `account` | `invoices` |

---

## 2. Personal Info tab

```json
"personalInfo": {
  "email": "sarah.johnson@company.com",
  "phone": "+1(555) 123-4567",
  "joinDate": "2026-01-15T08:00:00.000Z",
  "role": "sales",
  "roleDisplay": "Sales",
  "department": "",
  "permissionTags": ["Lead Access", "Follow-ups Access", "Reports Access"],
  "permissions": { }
}
```

- **`permissionTags`**: human-readable labels where any of `view` / `edit` / `delete` is true on that permission group.
- **Edit contact / permissions:** `PUT /api/admin/employees/:userId` (unchanged).

---

## 3. Assigned tab — discriminated union

### Sales — `assignedWork.kind === "sales_leads"`

Table columns: Lead info, Status, Quote value, Score state, View action.

```json
"assignedWork": {
  "kind": "sales_leads",
  "total": 45,
  "page": 1,
  "limit": 10,
  "lifecycleBucket": "all",
  "items": [
    {
      "leadId": "...",
      "customerName": "John Doe",
      "jobId": "Q-2025-1047",
      "projectId": "Q-2025-1047",
      "projectName": "Workshop",
      "buildingType": "PEMB",
      "location": "Texas",
      "status": "proposal_sent",
      "statusLabel": "Quotation Sent",
      "quoteValue": 12500,
      "score": 72,
      "temperature": "hot",
      "scoreStateLabel": "Hot",
      "isTerminated": false,
      "createdAt": "...",
      "lead": { }
    }
  ]
}
```

- **`statusLabel`**: display string for badge (e.g. `Payment Received`, `Quotation Sent`).
- **`scoreStateLabel`**: current temperature label. There is **no** `Warm → Hot` history in v1; show current temp only unless product adds history later.
- **View action:** navigate using `leadId` or nested `lead`.

### Plant — `assignedWork.kind === "plant_projects"`

```json
"assignedWork": {
  "kind": "plant_projects",
  "total": 7,
  "page": 1,
  "limit": 10,
  "items": [
    {
      "leadId": "...",
      "projectName": "ABC Constructions",
      "jobId": "PRO-001",
      "projectId": "PRO-001",
      "buildingType": "Storage",
      "location": "Texas",
      "customerName": "John Doe",
      "buildingsCount": 4,
      "status": "bom_received",
      "statusLabel": "BOM Ready",
      "projectValue": 12500
    }
  ]
}
```

### Construction — `assignedWork.kind === "construction_deliveries"`

`items[]` = delivery cards (same shape as construction panel cards from `buildDeliveryCard`).

### Account — `assignedWork.kind === "account_invoices"`

`items[]`: `invoiceId`, `invoiceNumber`, `status`, `statusLabel`, `totalAmount`, `leadId`, `createdAt`.

### Other roles

`kind: "none"`, `items: []`.

---

## 4. Performance tab — discriminated union

### Sales — `performance.kind === "sales"`

```json
"performance": {
  "kind": "sales",
  "metrics": {
    "leadsClosed": 32,
    "conversionRate": 71,
    "followUpsCompletedPercent": 89,
    "followUpsTotal": 50,
    "followUpsCompleted": 45,
    "customerSatisfaction": null,
    "revenueGenerated": 125000,
    "revenuePeriodLabel": "This Year",
    "quotesCreated": 45,
    "escalationsRaised": 25,
    "totalLeads": 18
  }
}
```

| UI card | Field |
|---------|--------|
| Leads closed | `leadsClosed` |
| Conversion rate | `conversionRate` (0–100) |
| Follow-ups completed | `followUpsCompletedPercent` |
| Customer satisfaction | `customerSatisfaction` — **always `null` today** (not stored in backend) |
| Revenue generated | `revenueGenerated` + `revenuePeriodLabel` |
| Quotes created | `quotesCreated` |
| Escalation raised | `escalationsRaised` |

Use `?revenuePeriod=year` for “This Year” revenue.

### Plant — `performance.kind === "plant"`

```json
"performance": {
  "kind": "plant",
  "metrics": {
    "totalProjects": 32,
    "drawingsUploaded": 28,
    "drawingApprovalRate": 95,
    "bomSubmissionPending": 12,
    "bomSubmissionApproved": 30,
    "bomSubmissionRejected": 30
  }
}
```

Note: `bomSubmissionRejected` counts BOM jobs with status `failed` in the backend.

### Construction — `performance.kind === "construction"`

`totalProjects`, `tasksTotal`, `tasksDone`, `tasksInProgress`, `tasksCompletionRate`, `deliveriesHandled`, `invoicesRaised`.

### Account — `performance.kind === "account"`

`invoicesCreated`, `invoicesMarkedPaid`, `revenueCollected`.

---

## 5. `employee` object

Lean user document for edit forms (no password):

`_id`, `name`, `email`, `phone`, `role`, `department`, `isActive`, `avatar`, `permissions`, `createdAt`, `updatedAt`.

---

## Frontend integration checklist

1. On Employee Profile load: **`GET /api/admin/employees/:userId/profile`** once.
2. Map **header** to top card; use `workSummary.shortLabel`.
3. **Personal Info** tab → `data.personalInfo`.
4. **Assigned** tab → switch on `data.assignedWork.kind` and render the matching table.
5. **Performance** tab → switch on `data.performance.kind` and bind KPI cards to `metrics`.
6. Pagination / date filters → pass query params on the same endpoint (no second list API required).
7. Do **not** use `GET /:userId/assigned-leads` for the new profile unless you need legacy pagination only for sales.

---

## Errors

| HTTP | When |
|------|------|
| `401` | Missing/invalid token |
| `403` | Not admin |
| `404` | Employee not found (or role `admin` user — employees list excludes admins) |
| `400` | Invalid query (e.g. bad `temperature`) |

---

## Example request

```bash
curl -sS "https://<API_HOST>/api/admin/employees/69e61375e2dc3d6e7468ca3d/profile?assignedPage=1&assignedLimit=10&revenuePeriod=year" \
  -H "Authorization: Bearer <admin_access_token>"
```

---

## Deploy note

This route is **not** on production until the backend branch that contains commit with `GET .../profile` is **pushed and deployed** (Render auto-deploy from `shubham-changes-13-aug` or manual deploy). If the API returns `404 Route not found`, the server is still on an older build.
