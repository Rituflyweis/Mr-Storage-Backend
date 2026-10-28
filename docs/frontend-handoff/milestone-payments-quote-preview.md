# Milestone Payments — where they live + quote preview

## Where milestones are available

| Purpose | Method | Path |
|--------|--------|------|
| Live calc (modal) | `POST` | `/api/sales/estimates/milestones/preview` |
| Save on estimate | `PUT` | `/api/sales/estimates/:estimateId/milestones` |
| Load with estimate | `GET` | `/api/sales/estimates/:estimateId` → `milestoneSchedule`, `milestoneNote` |
| Standalone schedule PDF/HTML | `POST` | `/api/sales/estimates/documents/milestones/pdf` |
| **On main quote preview** | `POST` | `/api/sales/estimates/documents/preview` |

Stored on `EstimateQuote`: `milestoneSchedule[]`, `milestoneNote`.

## Preview calc body (matches modal)

```json
{
  "grand": 1519074,
  "rows": [
    { "label": "Deposit", "type": "pct", "pct": 30 }
  ]
}
```

Also accepted: `type: "fixed"` + `amount`, or `milestones` instead of `rows`.

Response: `{ grand, rows[{label,type,pct,amount}], scheduled, remaining, pct, fullyScheduled }`.

## Save

```http
PUT /api/sales/estimates/:estimateId/milestones
```

```json
{
  "grand": 1519074,
  "rows": [{ "label": "Deposit", "type": "pct", "pct": 30 }],
  "note": "Optional payment instructions"
}
```

## Show on quote preview — yes

Pass milestones into `documents/preview` (or load via `estimateId` after save):

```json
{
  "estimateId": optional,
  "pricingResult": {},
  "fullQuote": {},
  "milestoneSchedule": [
    { "label": "Deposit", "type": "pct", "pct": 30 }
  ],
  "milestoneNote": "",
  "sections": ["quote", "sow", "contract"]
}
```

`quoteHtml` / `assembledHtml` include a **Milestone Payment Schedule** block (amount due, running total, unscheduled balance).

Standalone pretty schedule (print from modal):

```http
POST /api/sales/estimates/documents/milestones/pdf
{ "estimateId"?, "grand", "rows", "note", "format": "html" | omit for PDF }
```

## FE checklist

1. Modal “Save & Create Schedule” → `PUT …/milestones` (and/or keep rows in client state).
2. Quote Preview → `documents/preview` with `milestoneSchedule` (or `estimateId` after save).
3. Optional print → `documents/milestones/pdf`.
