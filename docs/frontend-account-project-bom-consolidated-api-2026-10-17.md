# Account panel — Project consolidated BOM (detail screen)

**Date:** 2026-10-17  
**Screen:** Project detail → **View BOM** / **BOM Files Details**  
**Auth:** `admin` | `account` · `Authorization: Bearer <token>`

Per-building **`bomFiles[]`** is no longer returned. Use **consolidated BOM** only (same data plant generates for shipper/vendor).

---

## Primary endpoint (recommended)

```http
GET /api/account/projects/:projectId/bom/consolidated
Authorization: Bearer <token>
```

`:projectId` = Mongo **`leadId`** or **`jobId`**.

### Success `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Riverside Complex",
    "jobId": "PRO-001",
    "bomId": "PRO-001",
    "uploadId": "consolidated-bom.xlsx",
    "consolidatedBOMId": "6aadb4fb78547f45e45e8f8e",
    "status": "approved",
    "generatedAt": "2026-09-18T22:02:34.937Z",
    "updatedAt": "2026-09-18T22:02:34.937Z",
    "summary": {
      "totalItems": 125,
      "totalWeightLbs": 32000,
      "totalPanelsAreaSqm": 3300,
      "totalCost": 77230.47,
      "missingDataCount": 0
    },
    "downloads": {
      "excelUrl": "https://.../consolidated.xlsx",
      "pdfUrl": null,
      "fileUrl": "https://.../consolidated.xlsx",
      "fileName": "consolidated-bom.xlsx"
    },
    "rows": [
      {
        "lineNumber": 1,
        "category": "Primary Steel",
        "item": "RF-1",
        "description": "Rigid Frame RF-Section",
        "quantity": 50,
        "unitWeightLbs": 120,
        "totalWeightLbs": 6000,
        "partColor": null,
        "costUnit": "LB",
        "unitCost": 1.2,
        "totalCost": 7200,
        "buildings": [1]
      }
    ]
  }
}
```

### Figma mapping

| UI | Field |
|----|--------|
| Project title | `projectName`, `bomId` / `jobId` |
| Upload ID | `uploadId` |
| Total Items | `summary.totalItems` |
| Total Weight | `summary.totalWeightLbs` |
| Total Panels Area | `summary.totalPanelsAreaSqm` |
| Missing Data Issue | `summary.missingDataCount` (show “Missing: N”) |
| Table `#` | `rows[].lineNumber` |
| Category | `rows[].category` |
| Item | `rows[].item` |
| Description | `rows[].description` |
| Quantity | `rows[].quantity` |
| Unit Weight | `rows[].unitWeightLbs` |
| Download Excel | `downloads.excelUrl` or `downloads.fileUrl` |
| Download PDF | `downloads.pdfUrl` (null if plant only stored Excel) |

### Errors

| HTTP | When |
|------|------|
| `404` | Project not found, or **no consolidated BOM** yet (plant must run consolidate) |
| `401` / `403` | Auth / role |

---

## Alias (same payload)

```http
GET /api/account/projects/:projectId/bom
```

Returns **identical** `data` as `/bom/consolidated`. Prefer **`/bom/consolidated`** for new UI.

`GET /api/account/projects/:projectId` → `actionLinks.bom` points to **`/bom/consolidated`**.

---

## Not included

- Per-building raw `.out` uploads (plant-only).
- BOM upload / regenerate (plant: `POST /api/plant/projects/:leadId/consolidated-bom/generate`).

---

*Backend: `consolidatedBomAccount.util.js`, `accountProjectSubpages.service.js`*
