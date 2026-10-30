# Material Requests — Project / Site column (real project name)

**Status:** Ready  
**Date:** 30 Oct 2026  
**Endpoints (same payload):**
- `GET /api/admin/construction/material-requests`
- `GET /api/construction/material-requests`
- `GET /api/sales/material-requests`
- `GET /api/plant/material-requests`

---

## Bug you saw

Table showed **“Downtown Office Complex (Site A/B)”** for every row.

**Backend data is fine** — e.g. live DB:

| Request ID | Actual `projectName` | Site |
|------------|----------------------|------|
| MR-2026-0048 | daniels Project | Site A |
| MR-2026-0047 | Adam Gilchrist | Site B |
| MR-2026-0046 | Garage LLC | Site B |

So the UI was **not binding** `project.projectName` (likely a hardcoded Figma/mock label).

---

## Bind these fields (prefer flat)

Each list/detail row now includes:

| Field | Example | Use |
|-------|---------|-----|
| **`projectSite`** | `daniels Project (Site A)` | **Primary** — whole “Project / Site” cell |
| **`projectName`** | `daniels Project` | Project title only |
| **`jobId`** | `2026018` | Job / quote id |
| **`site`** | `Site A` | Site / building label |
| `project.projectName` | same as `projectName` | Nested (existing) |
| `siteLocation` / `buildingLabel` | raw stored site fields | Filters / detail |

### Example row

```json
{
  "requestId": "MR-2026-0048",
  "projectName": "daniels Project",
  "jobId": "2026018",
  "site": "Site A",
  "projectSite": "daniels Project (Site A)",
  "project": {
    "leadId": "…",
    "projectName": "daniels Project",
    "jobId": "2026018",
    "location": "…"
  },
  "siteLocation": "Site A",
  "buildingLabel": ""
}
```

---

## FE checklist

- [ ] **Project / Site** column → `row.projectSite` (or `` `${row.projectName} (${row.site})` ``)
- [ ] Remove any hardcoded `"Downtown Office Complex"` / mock project title
- [ ] Do **not** use `siteLocation` alone as the project name
- [ ] Optional subtitle: `row.jobId`
