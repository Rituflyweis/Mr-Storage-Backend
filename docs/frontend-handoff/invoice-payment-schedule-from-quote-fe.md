# Invoice Payment Schedule ← Quote milestones (FE handoff)

## Problem

Quote preview showed **Milestone Payment Schedule** (Deposit / Remaining Balance), but the invoice screen **Payment Schedule** stayed empty (“Add”) — tax auto-filled; milestones did not.

## Backend fix

Quote milestones (`EstimateQuote.milestoneSchedule` / `depositTerms`) now **auto-seed** the lead’s `PaymentSchedule` (same pattern as quote tax → invoice tax).

| API | Behavior |
|-----|----------|
| `GET /api/leads/:leadId/quotations/latest-approved-tax` | Also returns `paymentSchedule`, `paymentScheduleStages`, `paymentScheduleTotal` (and seeds DB if empty) |
| `GET /api/payment-schedules/lead/:leadId` | If no schedule / empty stages → seeds from quote milestones |
| `POST /api/leads/:leadId/invoices` | Seeds schedule before create; response includes `paymentSchedule` |

Stages are stored as **fixed $** amounts (Deposit, Remaining Balance Due, etc.) matching the quote.

Existing schedules with invoiced/paid stages are **not** overwritten.

## FE wiring (like tax)

On invoice create form load:

1. Call `latest-approved-tax` (already used for tax/markup).
2. If `paymentScheduleStages.length`:
   - Prefill Payment Schedule UI (do not leave “Add” empty).
   - Or refetch `GET /payment-schedules/lead/:leadId`.
3. Bind stage rows to schedule editor / `paymentScheduleStageId` when billing one stage.

Example new fields on `latest-approved-tax`:

```json
{
  "tax": 2431,
  "total": 64163,
  "paymentScheduleStages": [
    { "stageName": "Deposit", "amount": 19249, "amountType": "fixed", "status": "pending" },
    { "stageName": "Remaining Balance Due", "amount": 44914, "amountType": "fixed", "status": "pending" }
  ],
  "paymentScheduleTotal": 64163,
  "paymentSchedule": { "_id": "…", "stages": [ "…" ], "totalAmount": 64163 },
  "paymentScheduleSeededFromQuote": true
}
```

## Checklist

- [ ] Invoice form uses `paymentScheduleStages` from tax/prefill API (or GET schedule after seed)
- [ ] Payment Schedule shows Deposit + Remaining (or custom milestones) without manual Add
- [ ] Tax still uses existing tax fields unchanged
