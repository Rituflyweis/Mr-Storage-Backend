# Account Cost Variance — project budget vs total expense (FE)

## What changed

**Cost Variance → Variance Details** is no longer freight-only by default.

Default view = **whole project planned budget** vs **whole project expense** (manual expenses + vendor/material bids + freight bids).

Freight bid awarded-vs-actual remains available via `view=freight`.

## Endpoints

| Purpose | Method / path |
|---------|----------------|
| KPI cards | `GET /api/account/costs/variance/summary` |
| Alerts | `GET /api/account/costs/variance/alerts` |
| Trend | `GET /api/account/costs/variance/trend` |
| Table | `GET /api/account/costs/variance/details` |

### Details query

| Param | Values | Default |
|-------|--------|---------|
| `view` | `project` \| `freight` \| `all` | `project` |
| `page`, `limit` | pagination | 1 / 10 |
| `status` | substring of status (`Over`, `Under`, `On Budget`, …) | — |
| `search` | project name / job id | — |
| `leadId` / `projectId` | filter one project | — |
| `startDate`, `endDate` | filter expense dates | — |
| `includeBreakdown=true` | add category expense sub-rows under each project | false |

### Details row (project view)

```json
{
  "leadId": "…",
  "project": "BRANDON CUTTS",
  "projectName": "BRANDON CUTTS",
  "jobId": "2026241",
  "description": "Total project budget vs total expense",
  "vendor": "",
  "awardedAmount": 500000,
  "plannedBudget": 500000,
  "actualInvoice": 432000,
  "actualExpense": 432000,
  "variance": -68000,
  "variancePct": -13.6,
  "approvalStatus": "Under Budget",
  "source": "project_budget",
  "breakdown": {
    "manualExpense": 120000,
    "vendorMaterial": 250000,
    "freight": 62000,
    "categories": { "materialCost": 250000, "logisticsCost": 62000 }
  }
}
```

Bind table:

| Column | Field |
|--------|--------|
| Project | `project` / `projectName` |
| Description | `description` |
| Vendor | `vendor` (optional; often empty on project rows) |
| Awarded Amount | `awardedAmount` or `plannedBudget` |
| Actual Invoice | `actualInvoice` or `actualExpense` |
| Variance | `variance` |
| Status | `approvalStatus` |

### Summary — new fields (additive)

| Field | Meaning |
|-------|---------|
| `totalPlannedBudget` | Sum of project budgets |
| `totalActualExpense` | Sum of project expenses |
| `projectCount` | Projects with a budget doc |
| `noBudget` | Projects with spend but no budget |
| existing | `netVariance`, `overBudget`, `underBudget`, `onBudget`, … |

### Alerts

Now project budget vs expense (±5% variance), not vendor shipper quotes.

## FE checklist

- [ ] Default details call: `GET …/variance/details` (no `view` or `view=project`)
- [ ] Optional toggle “Freight only” → `view=freight`
- [ ] Bind KPI cards to new summary totals if useful
- [ ] Status filter still uses `approvalStatus` text

## Note

Expense rollup = same combined logic as analytics (`Expense` + approved/pending shipper quotes + selected freight bids). Planned = `ProjectBudget` fixed parts + custom lines (`resolveTotalBudget`).
