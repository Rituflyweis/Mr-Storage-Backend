# Milestone Payments — where they live + quote preview

## History page (only `estimateId` available)

History does **not** need to send pricing, `grand`, or `milestoneSchedule`. Backend loads the full estimate.

### Quote preview (includes Milestone Payment Schedule in HTML)

```http
POST /api/sales/estimates/documents/preview
{ "estimateId": "<id>" }
```

or

```http
GET|POST /api/sales/estimates/:estimateId/documents/preview
```

Response includes `quoteHtml` / `assembledHtml` with the schedule (when saved), plus:

- `grandTotal`
- `milestoneSchedule` / `milestones`
- `milestoneNote`
- `depositTerms`
- `pricing` / `fullQuote`

### Milestone modal re-open from history

```http
POST /api/sales/estimates/milestones/preview
{ "estimateId": "<id>" }
```

or `GET|POST /api/sales/estimates/:estimateId/milestones/preview`

Backend fills `grand` from the estimate total and `rows` from saved `milestoneSchedule`. Optional body fields still override when present.

### Load raw estimate

```http
GET /api/sales/estimates/:estimateId
```

→ `milestoneSchedule`, `milestoneNote`, `depositTerms`, full pricing.

---

## Where milestones are available

| Purpose | Method | Path |
|--------|--------|------|
| Live calc (modal) | `POST` | `/api/sales/estimates/milestones/preview` |
| History calc (id only) | `GET\|POST` | `/api/sales/estimates/:estimateId/milestones/preview` |
| Save on estimate | `PUT` | `/api/sales/estimates/:estimateId/milestones` |
| Load with estimate | `GET` | `/api/sales/estimates/:estimateId` |
| Standalone schedule PDF/HTML | `POST` | `/api/sales/estimates/documents/milestones/pdf` |
| **On main quote preview** | `POST` | `/api/sales/estimates/documents/preview` |
| History quote preview | `GET\|POST` | `/api/sales/estimates/:estimateId/documents/preview` |

Stored on `EstimateQuote`: `milestoneSchedule[]`, `milestoneNote`.

## Live calc body (editor modal — full data on hand)

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

If `grand` is omitted, backend uses the estimate’s saved grand total.

## Show on quote preview

**Prefer estimateId** (especially from history):

```json
{ "estimateId": "<id>", "sections": ["quote", "sow", "contract"] }
```

Optional live overrides (editor) can still send `milestoneSchedule` / pricing; empty arrays do **not** wipe saved milestones.

Standalone pretty schedule (print from modal):

```http
POST /api/sales/estimates/documents/milestones/pdf
{ "estimateId": "<id>", "format": "html" }
```

`grand` / `rows` optional when `estimateId` is set.

## FE checklist

1. Editor modal “Save & Create Schedule” → `PUT …/milestones`.
2. **History / quote preview** → `documents/preview` with **only** `{ estimateId }` (or path `/:estimateId/documents/preview`). Do not require client-side schedule/pricing.
3. History milestone modal → `milestones/preview` with `{ estimateId }` (or path preview).
4. Optional print → `documents/milestones/pdf` with `{ estimateId }`.
