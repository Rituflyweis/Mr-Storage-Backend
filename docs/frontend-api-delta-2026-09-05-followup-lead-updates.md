# Frontend API Delta - 2026-09-05 (Follow-up + Lead Updates)

This note covers the latest backend updates completed today for follow-up status handling, channel delivery visibility, and lead dimension persistence.

---

## 1) Follow-up activity: completed items no longer shown as overdue

### What was fixed
- Some follow-ups with `completedAt` could still appear as `overdue` due to inconsistent legacy status text.
- Backend status classification now treats a follow-up as `completed` when:
  - `status === "completed"`, **or**
  - `completedAt` is present.

### APIs affected
- `GET /api/followups/activity` (common insights API)
- Admin follow-up APIs:
  - `GET /api/admin/followups/activity-log`
  - `GET /api/admin/followups`
- Sales follow-up stats endpoints now use the same defensive overdue logic.

### Result
- Completed follow-ups should not be misclassified as overdue in activity/summary views.

---

## 2) New per-channel delivery status in follow-up responses

### What was added
Separate delivery status is now available for:
- Customer SMS
- Customer Email
- Sales Employee SMS
- Sales Employee Email

This is derived from `FollowUpDispatchLog` and attached to follow-up payloads.

### New response shape
```json
{
  "deliveryStatus": {
    "customer": {
      "sms":   { "enabled": true, "status": "sent", "sentAt": "2026-09-05T12:42:36.430Z", "error": "" },
      "email": { "enabled": true, "status": "failed", "sentAt": "2026-09-05T12:24:04.918Z", "error": "..." }
    },
    "salesEmployee": {
      "sms":   { "enabled": true, "status": "failed", "sentAt": "2026-09-05T12:42:38.297Z", "error": "..." },
      "email": { "enabled": true, "status": "sent", "sentAt": "2026-09-05T12:42:39.722Z", "error": "" }
    }
  }
}
```

### Status values
- `pending` = enabled but no dispatch record yet
- `sent`
- `failed`
- `skipped`
- `disabled` = channel not enabled for that follow-up

### APIs affected
- `GET /api/followups/activity?view=detail`
  - Each `history[]` row now includes `deliveryStatus`.
- `GET /api/followups/activity?view=summary`
  - Each lead row now includes `lastDeliveryStatus` for the latest follow-up event.
- `GET /api/admin/followups/activity-log`
  - Each `activities[]` item now includes `deliveryStatus`.
- `GET /api/admin/followups`
  - Each `followups[]` item now includes `deliveryStatus`.

---

## 3) Lead roof pitch persistence (admin, sales, sendQuotesRequest consistency)

### What was fixed
`roofPitch` is now consistently persisted and editable across lead creation/edit flows.

### Backend changes
- Shared payload mapper now includes `roofPitch`:
  - create payload (`buildLeadCreatePayload`)
  - edit payload (`applyLeadUpdateFromBody`)
- Shared validators now accept `roofPitch` for:
  - lead create
  - lead edit
- Sales CSV import now maps:
  - `roofPitch`
  - `height` (added where missing in import create block)

### APIs affected
- Admin lead create/edit APIs (shared mapper path)
- Sales lead create/edit APIs (shared mapper path)
- Sales lead CSV import
- `POST /api/v1/user/sendQuotesRequest` already had `roofPitch`; no contract change needed there.

### Result
- `roofPitch` is saved in `Lead` documents and returned in lead detail responses (admin + sales lead detail APIs that return the lead object).

---

## 4) Follow-up config note (cold lead key precedence)

Current backend precedence:
- Primary key used by execution: `leadFollowUp.cold`
- Legacy compatibility fallback: `coldLead` (used only when `leadFollowUp.cold` is absent)

Recommendation for frontend:
- Use only:
  - `leadFollowUp.warm`
  - `leadFollowUp.cold`

---

## Changed backend files

- `src/controllers/common/followupInsights.controller.js`
- `src/controllers/admin/followup.controller.js`
- `src/controllers/sales/followup.controller.js`
- `src/utils/followupDispatchStatus.js` (new)
- `src/utils/leadPayload.js`
- `src/utils/leadCreateValidators.js`
- `src/controllers/sales/lead.controller.js`

