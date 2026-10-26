# Admin — project budget & custom lines API

**Base URL (prod):** `https://mr-storage-backend-025k.onrender.com`  
**Base path:** `/api/admin/leads/:leadId`  
**Auth:** `Authorization: Bearer <token>` · roles **`admin`** (and routes that already use admin lead APIs)

This document covers **Budget Planning** (category cards per project): fixed heads (Material, Logistic, Production, Shipper) plus **dynamic** categories you can **add** and **delete**. Account/sales **read** the same budget data via their own endpoints; they do not use these admin routes for writes.

## Budget Planning UI (Figma) → API

| Screen action | API |
|---------------|-----|
| Load cards + header totals | `GET …/budget` → `planningCards[]`, `totalBudget`, `expectedProfit` |
| **Update** on Material / Logistic / Production / Shipper card | `PUT …/budget/categories/{material\|logistic\|production\|shipper}` body `{ "amount": 343000 }` |
| **Update Budget** / **Save as Draft** (full form) | `POST …/budget` (partial body OK) |
| **Add** new category card | `POST …/budget/custom-lines` `{ "label": "Permits", "amount": 8000 }` |
| **Update** on a custom card | `PUT …/budget/custom-lines/:lineKey` |
| **Delete** custom category | `DELETE …/budget/custom-lines/:lineKey` |

Render cards from **`data.budget.planningCards`** (do not hardcode only four cards). Preset rows have `isPreset: true`, `canDelete: false`. Custom rows have `canDelete: true`.

**Account panel (read-only consumption):** [`frontend-account-panel-api.md`](./frontend-account-panel-api.md) §5 Budget vs actual · [`frontend-account-new-apis-handoff.md`](./frontend-account-new-apis-handoff.md) (account routes only).

---

## Overview

Each lead/project has at most one **`ProjectBudget`** document:

| Field | Purpose |
|-------|---------|
| `materialBudget` | Fixed head — material |
| `logisticBudget` | Fixed head — freight/logistics |
| `productionBudget` | Fixed head — manpower/labor |
| `shipperBudget` | Fixed head — subcontractor/shipper |
| `otherCost` | Fixed head — miscellaneous |
| `customLines[]` | Extra budget rows defined by admin |
| `totalBudget` | Stored sum: five fixed fields + all `customLines[].amount` |

**`customLines[]` item:**

| Field | Required | Notes |
|-------|----------|--------|
| `key` | Recommended | Stable id (slug/uuid). Auto-generated if omitted. Duplicates skipped. |
| `label` | Yes | Shown as cost head name in budget vs actual |
| `amount` | No | Default `0` |
| `expenseCategories` | No | `Expense.category` values that map **actual** spend into this line |

**Partial updates:** On `POST`, any omitted top-level budget field keeps the **existing** value. Sending `customLines` **replaces** the whole array; omit `customLines` to leave existing custom lines unchanged.

**Downstream (no admin call needed):** `totalBudget`, dashboard budget teaser, cost variance, customer/project profitability, and `GET /api/account/financial/budget-vs-actual` all include fixed heads plus one row per custom line (`isCustom: true`).

---

## GET budget

```http
GET /api/admin/leads/6aadb0a0464b5c58eb1a042b/budget
Authorization: Bearer <admin-token>
```

**Response:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "budget": {
      "_id": "67a1b2c3d4e5f6789012345a",
      "leadId": "6aadb0a0464b5c58eb1a042b",
      "materialBudget": 120000,
      "logisticBudget": 25000,
      "productionBudget": 30000,
      "shipperBudget": 15000,
      "otherCost": 10000,
      "customLines": [
        {
          "key": "permits",
          "label": "Permits & fees",
          "amount": 8000,
          "expenseCategories": ["permits", "administrativeCost"]
        }
      ],
      "totalBudget": 218000,
      "createdBy": "69e79dc9e3d92b7f3e1df429",
      "createdAt": "2026-09-20T10:00:00.000Z",
      "updatedAt": "2026-10-15T08:00:00.000Z",
      "expectedProfit": 1472600,
      "planningCards": [
        {
          "key": "material",
          "label": "Material Budget",
          "description": "Estimate all material related costs for the project.",
          "amount": 120000,
          "isPreset": true,
          "canDelete": false,
          "expenseCategories": []
        },
        {
          "key": "permits",
          "label": "Permits & fees",
          "description": "",
          "amount": 8000,
          "isPreset": false,
          "canDelete": true,
          "expenseCategories": ["permits"]
        }
      ]
    }
  }
}
```

If no budget exists yet, `data.budget` is `null`.

`expectedProfit` = lead `quoteValue` − resolved `totalBudget` (computed on read/write).

---

## POST / set budget

```http
POST /api/admin/leads/6aadb0a0464b5c58eb1a042b/budget
Authorization: Bearer <admin-token>
Content-Type: application/json
```

**Full example:**

```json
{
  "materialBudget": 120000,
  "logisticBudget": 25000,
  "productionBudget": 30000,
  "shipperBudget": 15000,
  "otherCost": 10000,
  "customLines": [
    {
      "key": "permits",
      "label": "Permits & fees",
      "amount": 8000,
      "expenseCategories": ["permits", "other"]
    },
    {
      "key": "insurance-2026",
      "label": "Project insurance",
      "amount": 5000,
      "expenseCategories": []
    }
  ]
}
```

**Partial update (only change material + add/replace custom lines):**

```json
{
  "materialBudget": 125000,
  "customLines": [
    {
      "key": "permits",
      "label": "Permits & fees",
      "amount": 10000,
      "expenseCategories": ["permits"]
    }
  ]
}
```

Unmentioned fields (`logisticBudget`, `productionBudget`, etc.) stay as stored before this request.

**Response `data`:**

```json
{
  "budget": {
    "_id": "67a1b2c3d4e5f6789012345a",
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "materialBudget": 125000,
    "logisticBudget": 25000,
    "productionBudget": 30000,
    "shipperBudget": 15000,
    "otherCost": 10000,
    "customLines": [
      {
        "key": "permits",
        "label": "Permits & fees",
        "amount": 10000,
        "expenseCategories": ["permits"]
      }
    ],
    "totalBudget": 215000,
    "createdBy": "69e79dc9e3d92b7f3e1df429",
    "expectedProfit": 1475600
  }
}
```

**Side effects:** audit log (`BUDGET_SET`), lead list socket update (`trigger: 'budget'`).

**Errors:** `404` if lead not found; validation errors if numeric/array rules fail.

---

## Validation (express-validator)

| Body field | Rule |
|------------|------|
| `materialBudget`, `logisticBudget`, `productionBudget`, `shipperBudget`, `otherCost` | optional numeric |
| `customLines` | optional array |
| `customLines.*.key`, `customLines.*.label` | optional string |
| `customLines.*.amount` | optional numeric |
| `customLines.*.expenseCategories` | optional array |

Lines without a non-empty `label` are dropped. Empty `customLines: []` clears all custom lines.

---

## Dynamic category CRUD (add / delete)

### Add category

```http
POST /api/admin/leads/{leadId}/budget/custom-lines
Content-Type: application/json

{
  "label": "Equipment rental",
  "amount": 12000,
  "key": "equipment-rental",
  "expenseCategories": ["Equipment"]
}
```

`label` required. `key` optional (auto-generated if omitted).

### Update custom category

```http
PUT /api/admin/leads/{leadId}/budget/custom-lines/equipment-rental
{ "amount": 15000, "label": "Equipment rental (revised)" }
```

### Delete custom category

```http
DELETE /api/admin/leads/{leadId}/budget/custom-lines/equipment-rental
```

Preset keys (`material`, `logistic`, `production`, `shipper`) **cannot** be deleted — set `amount` to `0` or hide in UI if needed.

### Update one preset card (per-card Update button)

```http
PUT /api/admin/leads/{leadId}/budget/categories/material
{ "amount": 343000 }
```

`categoryKey`: `material` · `logistic` · `production` · `shipper` · `other`

---

## How account UI sees custom lines

After admin saves, account routes reflect the same budget without calling admin APIs:

```http
GET /api/account/financial/budget-vs-actual?leadId=6aadb0a0464b5c58eb1a042b
Authorization: Bearer <account-token>
```

**Fragment of `data`:**

```json
{
  "totalBudget": 215000,
  "customBudgetLines": [
    {
      "key": "permits",
      "label": "Permits & fees",
      "amount": 10000,
      "expenseCategories": ["permits"]
    }
  ],
  "costHeads": [
    {
      "head": "Material Cost",
      "budget": 125000,
      "actual": 20000,
      "variance": -105000,
      "isCustom": false
    },
    {
      "head": "Permits & fees",
      "budget": 10000,
      "actual": 0,
      "variance": -10000,
      "isCustom": true,
      "customKey": "permits"
    }
  ]
}
```

Sales lead detail may return the same `budget` object shape when loading a lead (read path only).

---

## Quick verification

```bash
# After login as admin, replace TOKEN and LEAD_ID
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://mr-storage-backend-025k.onrender.com/api/admin/leads/$LEAD_ID/budget"

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"otherCost":5000,"customLines":[{"key":"test","label":"Test line","amount":100}]}' \
  "https://mr-storage-backend-025k.onrender.com/api/admin/leads/$LEAD_ID/budget"
```

---

*Doc version: 2026-10-15 · Related backend: `ProjectBudget`, `setLeadBudget` / `getLeadBudget`, `budgetVsActual.util.js`*
