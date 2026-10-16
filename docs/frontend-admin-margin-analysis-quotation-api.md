# Admin — Margin Analysis (extracted quotation)

**Audience:** Admin panel only (Financial Overview → Margin Analysis).  
**Not** the account panel — account keeps invoice/expense-based margin under `/api/account/financial/margin-analysis`.

**Base:** `https://mr-storage-backend-025k.onrender.com/api/admin/financials`

**Full req/resp examples:** [`frontend-admin-margin-analysis-handoff.md`](./frontend-admin-margin-analysis-handoff.md)

---

## Data source

Responses include:

```json
{
  "dataSource": "quotation",
  "audience": "admin"
}
```

Numbers come from the **latest quotation per project**, enriched from the linked **EstimateQuote** (COG / spreadsheet extraction) when `quotation.sourceEstimateId` is set.

### Field mapping (quotation + extraction)

| UI / KPI | Backend source (priority order) |
|----------|----------------------------------|
| **Sales / revenue** | `profitAnalysis.revenueOverride` → `finalPrice` / `basePrice` → estimate `totalSell` / `fullQuoteResult.grandTotal` / `pricingResult.totSell` |
| **COGS** | `profitAnalysis.actualCostOverride` → `totalCOGS` → estimate `totalCOGS` / `pricing.totCost` → `materialCost + freightCost + installCost` |
| **Material** | `quotation.materialCost` or estimate `materialCost` |
| **Freight** | `quotation.freightCost` or estimate `freightCost` |
| **Labour / install** | estimate `installCost` or `pricing.instCost` → `labourInstallCost` on row |
| **Gross margin %** | `quotation.margin` → estimate `marginPercent` / `fullQuoteResult.grandMargin` / `pricing.profPct` → `quotation.markupPercent` → computed from revenue − COGS |
| **Markup** | `quotation.markupPercent`, `quotation.markupValue` |

---

## Endpoints

| Screen | Method | Path |
|--------|--------|------|
| KPI cards | GET | `/margin-analysis?startDate=&endDate=&projectId=&businessUnit=` |
| Trend chart | GET | `/margin-analysis/trend?period=month\|quarter\|year` |
| By project chart | GET | `/margin-analysis/by-project?limit=10&startDate=&endDate=` |
| P&L table | GET | `/profit-loss/projects?page=1&limit=10&search=` |

**Auth:** `Authorization: Bearer <admin token>`

### Trend response (extra series for charts)

Each `trend[]` item includes:

- `revenue`, `expense` (same as COGS), `cogs`, `grossProfit`
- `grossMarginPct`, `operatingMarginPct`, `netProfitMarginPct`, `contributionMarginPct`

### By-project / P&L row extras

- `markupPercent`, `marginFromQuotation`, `labourInstallCost`
- `grossMarginPct` uses quotation/extraction margin when present

---

## Frontend checklist

- [ ] Admin app calls **`/api/admin/financial/*`** only for this screen (not account routes).
- [ ] Do not expect `dataSource: "quotation"` on account margin APIs.
- [ ] P&L table: bind **Sales** → `salesUSD`, **COGS** → `cogsUSD`, **Gross profit** → `grossProfitUSD`, **Gross margin** → `grossMarginPct` (single column — remove duplicate headers in UI).
- [ ] Charts: use trend `revenue` and `expense`/`cogs` for line/bar series.

---

*Doc version: 2026-10-16*
