# Frontend handoff — Admin Panel Dashboard (Figma)

Complete Admin Dashboard APIs for the Steel Building Depot **Admin Panel** Figma screens (KPI row, delivery/freight, funnel, tax, plant, pipeline kanban, search, etc.).

**Base:** `https://mr-storage-backend-025k.onrender.com` (local: `http://localhost:5001`)  
**Prefix:** `/api/admin/dashboard`  
**Auth:** `Authorization: Bearer <admin accessToken>`  
**Role:** `admin` (mounted under admin router)

**Envelope**

```json
{ "success": true, "message": "…", "data": { } }
```

```json
{ "success": false, "message": "…" }
```

---

## 1. Query params (all GET section routes)

| Param | Values | Notes |
|-------|--------|--------|
| `period` | `today` \| `week` \| `month` \| `all` | Default on overview: `month`. `all` = no date filter |
| `startDate` | ISO date | Overrides `period` when set (with/without `endDate`) |
| `endDate` | ISO date | Inclusive end-of-day |
| `limit` | 1–50 | Kanban / lists / search / activity |

**Recommended FE:** top tabs **Today / Week / Month / All Time** → `?period=today|week|month|all`.

---

## 2. Preferred call: one overview

### `GET /api/admin/dashboard/overview?period=month`

Returns **every Figma section** in one payload (lazy-load sections below if you prefer).

**Request**

```http
GET /api/admin/dashboard/overview?period=month
Authorization: Bearer <token>
```

**Response `200` (shape)**

```json
{
  "success": true,
  "message": "Admin dashboard overview",
  "data": {
    "period": "month",
    "generatedAt": "2026-10-28T11:17:20.243Z",
    "kpis": {
      "totalLeads": 250,
      "confirmedLeads": 1,
      "pipelineValue": 1909822410,
      "monthlyRevenue": 264204,
      "revenue": 264204,
      "unreadMessages": 51
    },
    "deliveryFinance": {
      "freightSpend": 4886732,
      "pendingCarrierPayments": 0,
      "freightSavings": 119220
    },
    "loadOptimization": {
      "totalBundlesCreated": 12,
      "totalBundlesCreatedChangePct": 20,
      "totalTruckloadsPlanned": 8,
      "totalTruckloadsPlannedChangePct": 14.3,
      "avgLoadUtilizationPct": 65,
      "avgLoadUtilizationChangePct": 0,
      "optimizationSavings": 4000,
      "optimizationSavingsChangePct": -10,
      "bundlePlans": 5
    },
    "deliveryOperations": {
      "totalDeliveriesToday": 4,
      "upcomingDeliveries": 10,
      "delayedDeliveries": 2,
      "rescheduledDeliveries": 1,
      "completedDeliveriesToday": 1
    },
    "communicationStatus": {
      "confirmationsSentPct": 89,
      "reminders48hrSentPct": 60,
      "reminders24hrSentPct": 88,
      "failedNotificationsPct": 20,
      "totals": { "sent": 40, "failed": 10, "total": 50 }
    },
    "freightActivity": {
      "activeFreightRequests": 32,
      "bidsPending": 63,
      "loadsAwardedToday": 2,
      "loadsInTransit": 1,
      "delayedShipments": 2
    },
    "conversionFunnel": {
      "newLeads": 40,
      "contacted": 30,
      "inPipeline": 25,
      "closedWon": 12,
      "stages": [
        { "key": "newLeads", "label": "New Leads", "count": 40, "pct": 100 },
        { "key": "contacted", "label": "Contacted", "count": 30, "pct": 75 },
        { "key": "proposalSent", "label": "Proposal Sent", "count": 15, "pct": 37.5 },
        { "key": "negotiation", "label": "Negotiation", "count": 10, "pct": 25 },
        { "key": "closedWon", "label": "Closed Won", "count": 12, "pct": 30 }
      ]
    },
    "dealSizeDistribution": {
      "averageDealSize": 67500,
      "totalDeals": 89,
      "buckets": [
        { "key": "0_50k", "label": "$0 - $50K", "count": 45, "pct": 51, "totalValue": 1200000 },
        { "key": "50_100k", "label": "$50K - $100K", "count": 28, "pct": 31, "totalValue": 2100000 },
        { "key": "100_200k", "label": "$100K - $200K", "count": 12, "pct": 13, "totalValue": 1800000 },
        { "key": "200k_plus", "label": "$200K+", "count": 4, "pct": 5, "totalValue": 1100000 }
      ]
    },
    "reportsOverview": {
      "customers": 240,
      "revenue": 250000,
      "income": 250000,
      "expense": 160000,
      "weeklySeries": [
        { "date": "2026-10-22", "label": "Wed", "revenue": 12000, "income": 12000, "expense": 4000 }
      ]
    },
    "leadSources": {
      "totalLeads": 1245,
      "bySource": [
        { "source": "chat", "count": 456, "pct": 36.6 },
        { "source": "manual", "count": 103, "pct": 8.3 }
      ],
      "byChannel": [
        { "channel": "Website", "count": 456, "pct": 36.6 },
        { "channel": "Social Media", "count": 0, "pct": 0 },
        { "channel": "Email Campaign", "count": 0, "pct": 0 },
        { "channel": "Referrals", "count": 156, "pct": 12.5 },
        { "channel": "Direct", "count": 103, "pct": 8.3 }
      ]
    },
    "dispatchReadiness": {
      "loadsReadyForPickup": 3,
      "loadsReadyForPickupChangePct": 5.6,
      "pendingMaterial": 39,
      "pendingMaterialChangePct": 11.4,
      "pickupsToday": 45,
      "pickupsTodayChangePct": 8.1,
      "missedPickups": 3,
      "missedPickupsChangePct": 7.4
    },
    "leadConversion": {
      "totalLeads": 100,
      "stages": [
        { "key": "newLeads", "label": "New Leads", "count": 52, "pct": 52 },
        { "key": "contacted", "label": "Contacted", "count": 21, "pct": 21 },
        { "key": "proposalSent", "label": "Proposal sent", "count": 74, "pct": 74 },
        { "key": "negotiation", "label": "Negotiation", "count": 50, "pct": 50 },
        { "key": "closedWon", "label": "Closed win", "count": 36, "pct": 36 },
        { "key": "closedLost", "label": "Closed lost", "count": 0, "pct": 0 }
      ]
    },
    "tonnageSold": {
      "total": 3013,
      "categories": [
        { "category": "Garage", "tonnage": 1146, "deals": 20, "value": 500000, "pct": 38 },
        { "category": "Workshop", "tonnage": 638, "deals": 12, "value": 300000, "pct": 21.2 }
      ]
    },
    "opsKpis": {
      "onTimeDeliveryPct": 20,
      "acknowledgementsPendingPct": 60,
      "deliverySuccessRate": 50,
      "rescheduleRate": 33
    },
    "pipelineStageOverview": {
      "stages": [
        { "status": "initial_contact", "label": "Initial Contact", "count": 40 },
        { "status": "proposal_sent", "label": "Proposal Sent", "count": 28 }
      ]
    },
    "queryHandling": {
      "employeeHandled": 156,
      "employeeHandledPct": 33,
      "aiHandled": 312,
      "aiHandledPct": 67,
      "withAi": 312,
      "withSales": 156,
      "total": 468
    },
    "pipelineKanban": {
      "columns": [
        {
          "key": "qualified",
          "label": "Qualified",
          "total": 42,
          "leads": [
            {
              "id": "…",
              "name": "Johnson Manufacturing",
              "value": 85000,
              "updatedAt": "2026-10-26T10:00:00.000Z",
              "assignedTo": "John Davis",
              "lifecycleStatus": "requirements_gathered"
            }
          ]
        },
        { "key": "proposal", "label": "Proposal", "total": 28, "leads": [] },
        { "key": "negotiation", "label": "Negotiation", "total": 15, "leads": [] }
      ]
    },
    "recentClosedDeals": {
      "totalThisWeek": 705000,
      "items": [
        {
          "id": "…",
          "name": "Global Industries",
          "value": 300000,
          "closedAt": "2026-10-28T08:00:00.000Z",
          "assignedTo": "Sarah Miller",
          "status": "deal_closed"
        }
      ]
    },
    "salesActivity": {
      "items": [
        {
          "type": "deal_closed",
          "title": "Deal closed: Global Industries",
          "value": 300000,
          "at": "2026-10-28T10:00:00.000Z",
          "actor": "Sarah Miller"
        }
      ]
    },
    "topPerformers": {
      "teamTotal": 1420000,
      "topPerformer": { "rank": 1, "name": "Sarah Miller", "revenue": 485000, "closedLeads": 23, "closeRate": 89 },
      "performers": [
        { "rank": 1, "id": "…", "name": "Sarah Miller", "leads": 26, "closedLeads": 23, "revenue": 485000, "closeRate": 89 }
      ]
    },
    "taxSummary": {
      "totalTaxDue": 17788.25,
      "totalSales": 83000,
      "avgTaxRate": 6.5,
      "filings": 12
    },
    "taxByState": {
      "states": [
        { "state": "TX", "contracts": 4, "taxDue": 9240, "totalSales": 112000, "taxRate": 8.25 }
      ]
    },
    "taxByBuildingType": {
      "totalTax": 17788.25,
      "items": [
        { "buildingType": "PEMB", "sales": 89200, "tax": 5802.5, "deals": 10, "pct": 33 }
      ]
    },
    "constructionProgress": {
      "projects": [
        {
          "id": "…",
          "projectName": "Downtown Office Complex",
          "projectCode": "PRJ-001",
          "manager": "John Smith",
          "lifecycleStatus": "fabrication_started",
          "statusLabel": "On Track",
          "progressPct": 72
        }
      ]
    },
    "plantProduction": {
      "materialValue": 8458798,
      "materialValueChangePct": 0,
      "outflowThisMonth": 48988.78,
      "outflowChangePct": -19,
      "reorderRequestsPending": 6,
      "reorderRequestsChangePct": 41,
      "emergencyMaterialAlerts": 2,
      "emergencyAlertsChangePct": 0
    },
    "businessHighlights": {
      "topSector": { "key": "steel", "label": "Steel Building Depot", "value": 500000, "deals": 12, "monthOverMonthPct": 0 },
      "topCustomerByProfit": { "id": "…", "name": "ABC Corporation", "totalProfit": 25500, "revenue": 80000, "deals": 3 },
      "currentMonthOI": 125000,
      "oiGrowthRatePct": 0
    },
    "customerApprovals": {
      "totalInvoicesGenerated": 1230,
      "activities": [
        { "id": "…", "name": "Oklahoma Steel Structures", "date": "2026-01-30T00:00:00.000Z", "status": "pending", "amount": 1845, "type": "carrier" }
      ],
      "invoices": []
    },
    "salesMix": {
      "sales": 754,
      "revenue": 234,
      "expenses": 312,
      "slices": [
        { "key": "sales", "label": "Sales", "amount": 754, "pct": 58 },
        { "key": "revenue", "label": "Revenue", "amount": 234, "pct": 18 },
        { "key": "expenses", "label": "Expenses", "amount": 312, "pct": 24 }
      ]
    }
  }
}
```

Numbers above are illustrative of shape; live DB returns real aggregates.

---

## 3. Section endpoints (same `data` as overview keys)

Use these for lazy loading / widgets.

| Figma area | Method | Path |
|------------|--------|------|
| KPI cards (leads / pipeline / revenue) | GET | `/kpis` |
| Delivery Finance | GET | `/delivery-finance` |
| Load Optimization | GET | `/load-optimization` |
| Delivery Operations | GET | `/delivery-operations` |
| Communication Status | GET | `/communication-status` |
| Freight Activity | GET | `/freight-activity` |
| Sales Conversion Funnel | GET | `/conversion-funnel` |
| Deal Size Distribution | GET | `/deal-size-distribution` |
| Reports & Overview + weekly chart | GET | `/reports-overview` |
| Lead Source donut | GET | `/lead-sources` |
| Dispatch & Readiness | GET | `/dispatch-readiness` |
| Lead Conversion bars | GET | `/lead-conversion` |
| Tonnage Sold | GET | `/tonnage-sold` |
| On-time / ack / success / reschedule | GET | `/ops-kpis` |
| Pipeline Stage Overview bars | GET | `/pipeline-stages` |
| Query Handling (AI vs Employee) | GET | `/query-handling` |
| Active Pipeline Stages kanban | GET | `/pipeline-kanban?limit=5` |
| Recent Closed Deals | GET | `/recent-closed-deals?limit=10` |
| Recent Sales Activity | GET | `/sales-activity?limit=15` |
| Top Sales Performers | GET | `/top-performers?limit=10` |
| Tax Summary | GET | `/tax-summary` |
| Tax Due by State | GET | `/tax-by-state` |
| Tax by Building Type | GET | `/tax-by-building-type` |
| Construction Progress | GET | `/construction-progress?limit=10` |
| Plant Production Status | GET | `/plant-production` |
| Top Sector / Top Customer / OI | GET | `/business-highlights` |
| Customer activities & invoices | GET | `/customer-approvals?limit=10` |
| Sales / Revenue / Expenses donut | GET | `/sales-mix` |
| Global search | GET | `/search?q=acme` |

### Example — KPIs

```http
GET /api/admin/dashboard/kpis?period=week
```

```json
{
  "success": true,
  "message": "Dashboard KPIs",
  "data": {
    "totalLeads": 18,
    "confirmedLeads": 3,
    "pipelineValue": 980000,
    "monthlyRevenue": 120000,
    "revenue": 120000,
    "unreadMessages": 4
  }
}
```

### Example — Load optimization

```http
GET /api/admin/dashboard/load-optimization?period=month
```

```json
{
  "success": true,
  "data": {
    "totalBundlesCreated": 35,
    "totalBundlesCreatedChangePct": 12.5,
    "totalTruckloadsPlanned": 18,
    "totalTruckloadsPlannedChangePct": 8.2,
    "avgLoadUtilizationPct": 65,
    "avgLoadUtilizationChangePct": 3.1,
    "optimizationSavings": 2000,
    "optimizationSavingsChangePct": -5,
    "bundlePlans": 10
  }
}
```

### Example — Deal size

```http
GET /api/admin/dashboard/deal-size-distribution?period=month
```

```json
{
  "success": true,
  "data": {
    "averageDealSize": 67500,
    "totalDeals": 89,
    "buckets": [
      { "key": "0_50k", "label": "$0 - $50K", "count": 45, "pct": 51, "totalValue": 1200000 }
    ]
  }
}
```

### Example — Search

```http
GET /api/admin/dashboard/search?q=steel&limit=20
```

```json
{
  "success": true,
  "message": "Search results",
  "data": {
    "query": "steel",
    "leads": [
      { "id": "…", "type": "lead", "name": "Acme Steel", "projectName": "Bldg A", "projectId": "JOB-1", "value": 120000, "status": "proposal_sent" }
    ],
    "projects": [
      { "id": "…", "type": "project", "name": "Bldg A", "projectId": "JOB-1", "status": "proposal_sent" }
    ],
    "customers": [
      { "id": "…", "type": "customer", "name": "Acme Corp", "email": "a@acme.com" }
    ]
  }
}
```

**400** if `q` / `search` missing:

```json
{ "success": false, "message": "q (search text) is required" }
```

---

## 4. Figma → field map (quick)

| UI label | JSON path |
|----------|-----------|
| Monthly Total Leads | `kpis.totalLeads` |
| Monthly Confirmed Leads | `kpis.confirmedLeads` (`isQuoteReady`) |
| Monthly Pipeline Value | `kpis.pipelineValue` |
| Monthly Revenue | `kpis.monthlyRevenue` |
| Freight Spend / Pending / Savings | `deliveryFinance.*` |
| Bundles / Truckloads / Utilization / Savings | `loadOptimization.*` |
| Delivery ops cards | `deliveryOperations.*` |
| Confirmations / 48hr / 24hr / Failed % | `communicationStatus.*` |
| Freight activity cards | `freightActivity.*` |
| Funnel | `conversionFunnel.stages` |
| Deal size + average | `dealSizeDistribution.*` |
| Customers / Revenue / Income / Expense chart | `reportsOverview.*` |
| Lead source donut | `leadSources.byChannel` (display) or `bySource` (raw) |
| Dispatch readiness | `dispatchReadiness.*` |
| Lead conversion bars | `leadConversion.stages` |
| Tonnage sold | `tonnageSold.*` |
| Ops KPI row | `opsKpis.*` |
| Pipeline stage chart | `pipelineStageOverview.stages` |
| AI vs Employee pie | `queryHandling.*` |
| Kanban Qualified / Proposal / Negotiation | `pipelineKanban.columns` |
| Recent closed + week total | `recentClosedDeals.*` |
| Activity feed | `salesActivity.items` |
| Leaderboard | `topPerformers.performers` |
| Tax summary / by state / by type | `taxSummary`, `taxByState`, `taxByBuildingType` |
| Construction progress list | `constructionProgress.projects` |
| Plant production cards | `plantProduction.*` |
| Top sector / customer / OI | `businessHighlights.*` |
| Approvals + invoice count | `customerApprovals.*` |
| Sales donut | `salesMix.slices` |

---

## 5. Auth example

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@example.com", "password": "…" }
```

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ…",
    "role": "admin",
    "user": { "_id": "…", "name": "…", "email": "…", "role": "admin" }
  }
}
```

---

## 6. Notes / caveats for FE

1. **Confirmed leads** = `isQuoteReady: true` (quote-ready), not a separate “confirmed” lifecycle.
2. **Lead sources** in DB are `chat | manual | import | customer_portal`. `byChannel` maps to Figma labels (Website / Direct / Referrals…). Social Media / Email Campaign may be `0` until those sources exist.
3. **Closed lost** is not a lifecycle stage today → `closedLost` count is `0`.
4. **Tax by building type** uses closed-deal `quoteValue × ~6.5%` as a distribution proxy when Avalara rows aren’t tied to building type.
5. **Communication %** uses follow-up dispatch logs when present; otherwise delivery confirmation proxies.
6. **Load utilization** comes from `DailyProductionLog.utilizationPct` (plant daily logs).
7. Existing tax filing export / schedule APIs remain under `/api/admin/financials/tax-filing*` (not duplicated here).
8. Legacy routes still work: `/lead-stats`, `/customer-stats`, `/ai-vs-human`, `/performance-trend`.

---

## 7. FE integration checklist

- [ ] Login as admin → store JWT  
- [ ] Header period tabs → `period=today|week|month|all` on `GET /overview` (or per section)  
- [ ] Bind KPI / finance / ops cards from overview keys  
- [ ] Charts: funnel, deal size, sources, tonnage, sales mix, pipeline stages  
- [ ] Kanban + closed deals + activity + performers lists  
- [ ] Tax widgets + link “View Full Report” to existing `/financials/tax-filing`  
- [ ] Search bar → `GET /search?q=`  
- [ ] Handle empty arrays / zero metrics gracefully  

---

## 8. Code map

| Piece | Path |
|-------|------|
| Service | `src/services/admin/adminDashboard.service.js` |
| Controller | `src/controllers/admin/dashboard.controller.js` |
| Routes | `src/routes/admin/dashboard.routes.js` |
| Mount | `src/routes/admin/index.js` → `/dashboard` |

---

*Created October 2026 — Admin Dashboard Figma coverage.*
