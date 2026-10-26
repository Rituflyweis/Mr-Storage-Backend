# Lead bulk import — Excel + CSV

**Date:** 2026-10-23  
**Auth:** Admin or Sales token

## Endpoints

| Panel | Method | Path |
|-------|--------|------|
| Admin | POST | `/api/admin/leads/import` |
| Sales | POST | `/api/sales/leads/import` |

## Excel upload (recommended)

```http
POST /api/admin/leads/import
Authorization: Bearer <token>
Content-Type: multipart/form-data

file=<.xlsx>
businessUnit=steel          (optional form field)
```

- Field name: **`file`**
- Max size: **25 MB**
- Supports **TractIQ-style** sheets (title rows skipped; header row auto-detected) and **export-style** columns (`Project Name`, `Customer Email`, …).

**Response 200**

```json
{
  "success": true,
  "message": "Import complete: 1200 created, 1482 skipped (2682 rows)",
  "data": {
    "created": 1200,
    "skipped": 1482,
    "totalRows": 2682,
    "headerRowIndex": 4,
    "sheetName": "Leads",
    "errors": [{ "row": 12, "reason": "duplicate project", "leadId": "…" }]
  }
}
```

Sales response uses `imported` instead of `created` (same count).

## CSV (legacy)

```http
POST /api/admin/leads/import
Content-Type: application/json

{
  "csv": "projectName,customerEmail,customerPhone,buildingType,location\n…",
  "businessUnit": "steel"
}
```

## Field mapping (TractIQ → Lead / Customer)

| Excel column | Stored as |
|--------------|-----------|
| Project | `Lead.projectName` |
| Description, Stage, Status, Market, Source, links | `Lead.notes` (combined) |
| Address, City, State, ZIP | `location`, `city`, `state`, `pincode`, `installAddress` |
| Sq ft | `Lead.sqft` |
| Project value | `Lead.quoteValue` |
| Owner email / Developer email / Business contact | `Customer.email` (or synthetic import email if missing) |
| Owner phone / Developer phone | `Customer.phone` (or generated placeholder if missing) |
| Developer / owner, Owner / LLC | `Customer.firstName` / `company` |

- **`source`:** `import`
- **`lifecycleStatus`:** `initial_contact`
- **`jobId`:** auto-generated on create
- **Duplicates:** skipped when same `projectName` + city + state + ZIP already exists

## Frontend

Use `FormData`: append `file`, optional `businessUnit`. Do not send `Content-Type: application/json` for Excel.
