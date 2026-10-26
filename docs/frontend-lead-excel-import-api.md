# Bulk lead import — Admin & Sales (Excel / CSV)

Supports **TractIQ-style exports** such as `Storage Project Leads 2026-10-22.xlsx` (header row with **Project**, **Added**, **Address**, etc.) and legacy CSV templates.

**Auth:** Admin or Sales JWT  
**Content-Type:** `multipart/form-data` (Excel) or JSON (CSV)

| Panel | Method | Path |
|--------|--------|------|
| Admin | `POST` | `/api/admin/leads/import` |
| Sales | `POST` | `/api/sales/leads/import` |
| Admin | `GET` | `/api/admin/leads/import/jobs/:jobId` |
| Sales | `GET` | `/api/sales/leads/import/jobs/:jobId` |

## Large files (2,600+ rows)

Excel imports with **more than 50 rows** run as a **background job** (avoids HTTP timeouts):

- **POST** returns **`202`** immediately with `data.async: true`, `data.jobId`, `data.status: "processing"`, `data.totalRows`, `data.progressPct: 0`.
- **Poll** `GET .../import/jobs/:jobId` every few seconds until `status` is `completed` or `failed`.
- Same upload (multipart file); **no change** to how the file is sent.
- Optional: `?sync=true` forces synchronous import (small tests only; may timeout on large files).

```json
{
  "success": true,
  "message": "Import started for 2682 rows...",
  "data": {
    "async": true,
    "jobId": "671a…",
    "status": "processing",
    "totalRows": 2682,
    "processedRows": 0,
    "created": 0,
    "skipped": 0,
    "progressPct": 0,
    "headerRowIndex": 4,
    "sheetName": "Leads"
  }
}
```

When `status === "completed"`, `created` / `imported` and `skipped` are final. **`errors`** capped at ~150 rows.

## Excel upload (recommended)

```http
POST /api/admin/leads/import
Authorization: Bearer <token>
Content-Type: multipart/form-data

file=<.xlsx>
```

- Field name: **`file`**
- Max size: **25 MB**
- Sheet: **`Leads`** (or first worksheet)
- Header row is detected automatically (TractIQ title rows above row 4 are skipped)

### Response (admin)

```json
{
  "success": true,
  "data": {
    "created": 1200,
    "skipped": 1482,
    "totalRows": 2682,
    "headerRowIndex": 4,
    "sheetName": "Leads",
    "errors": [{ "row": 12, "reason": "duplicate project", "leadId": "..." }]
  }
}
```

Sales uses the same import logic; response uses **`imported`** instead of **`created`**.

## CSV (legacy)

```json
POST /api/sales/leads/import
{ "csv": "projectName,customerEmail,...\n..." }
```

## Row rules

- **Required:** `Project` / `projectName`
- **No email/phone:** synthetic customer (`import.*@imports.mrstorage.internal`) from project + location hash
- **Duplicates skipped:** same `projectName` + city + state + ZIP
- **Building type:** inferred from description (`Self-Storage`, etc.)
- TractIQ columns (`Stage`, `Market`, `Source`, lat/lng, map/street view links, etc.) are stored in lead **`notes`**

## Frontend checklist

- [ ] File input → `FormData` append `file`
- [ ] Show `totalRows`, `created`/`imported`, `skipped`, first N `errors`
- [ ] Large files (~2.6k rows) may take several minutes; show progress / disable double-submit
