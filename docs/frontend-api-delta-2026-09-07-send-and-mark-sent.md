# Frontend API Delta — 2026-09-07 (Send + Mark Sent)

Invoice and quotation send now support a **To / CC / editable message** draft. Staff can also **manually mark a document as sent** when they emailed it outside the app (Gmail, Outlook, etc.). That unblocks the next workflow without requiring a successful platform SMTP send.

Admin **approval is still required** before either path. Platform send still **does not** flip `status` to `sent` if email delivery fails.

---

## Product rules

- Do **not** invent a new status. Both paths set `status: "sent"`.
- Distinguish how it was sent with `sendMethod`: `"platform"` | `"manual"` | `null`.
- Keep **two endpoints**: `/send` (SMTP) vs `/mark-sent` (no email).
- Approval + current-revision checks apply to both.
- `/send` requires email to be configured. `/mark-sent` does **not**.
- Quotation `/send` and `/mark-sent` both advance the lead to `proposal_sent` when the current stage is earlier. Invoice create still requires lifecycle ≥ `proposal_sent`.

---

## 1) Platform send — invoice

### Endpoint
`POST /api/invoices/:invoiceId/send`

Admin and sales (common invoice routes).

### Request body (all optional)

| Field | Type | Notes |
|---|---|---|
| `toEmail` or `to` | string | Defaults to `customer.email` if omitted |
| `cc` / `ccEmail` / `ccEmails` | string **or** string[] | Comma/semicolon string also accepted. Max 10. Duplicates and CC equal to To are dropped |
| `message` / `note` / `emailMessage` / `coverNote` | string | First non-empty key is used as the email cover note |

```json
{
  "toEmail": "customer@example.com",
  "cc": ["boss@example.com", "ap@example.com"],
  "message": "Please find the invoice attached."
}
```

### Response extras
Existing invoice payload plus:

```json
{
  "success": true,
  "message": "Invoice sent successfully",
  "data": {
    "invoice": {
      "status": "sent",
      "sentAt": "2026-09-07T10:00:00.000Z",
      "sendMethod": "platform",
      "sentTo": "customer@example.com",
      "sentCc": ["boss@example.com"],
      "sentMessage": "Please find the invoice attached."
    },
    "sendMethod": "platform",
    "sentTo": "customer@example.com",
    "sentCc": ["boss@example.com"],
    "messageIncluded": true,
    "messageSourceKey": "message",
    "pdfAttached": true,
    "pdfWarning": null
  }
}
```

### Failures (unchanged intent)
- `400` if not approved, or edited after approval
- `400` if paid/cancelled
- `400` if To email missing/invalid
- `400` if SMTP is not configured
- `502` if SMTP send fails — **status stays unsent**

---

## 2) Mark invoice sent (external email)

### Endpoint
`POST /api/invoices/:invoiceId/mark-sent`

No SMTP. Same approval gate as `/send`.

### Request body (all optional)

| Field | Type | Notes |
|---|---|---|
| `note` or `message` | string | Stored on `sentMessage` and approval history |
| `sentAt` | ISO 8601 | Defaults to now |

```json
{
  "note": "Sent from Gmail on 7 Sep",
  "sentAt": "2026-09-07T10:00:00.000Z"
}
```

### Response

```json
{
  "success": true,
  "message": "Invoice marked as sent",
  "data": {
    "invoice": {
      "status": "sent",
      "sentAt": "2026-09-07T10:00:00.000Z",
      "sendMethod": "manual",
      "sentTo": "",
      "sentCc": [],
      "sentMessage": "Sent from Gmail on 7 Sep"
    },
    "sendMethod": "manual"
  }
}
```

`400` if already `sent`, paid, cancelled, not approved, or stale revision.

---

## 3) Platform send — quotation

### Endpoints
- `POST /api/quotations/:quotationId/send`
- `POST /api/sales/quotations/:quotationId/send` (same handler)

### Request body
Same To / CC / message fields as invoice send, plus existing:

| Field | Type | Notes |
|---|---|---|
| `sections` | string[] | Optional PDF sections. Default `["quote", "sow", "contract", "drawings"]` |

```json
{
  "toEmail": "customer@example.com",
  "cc": ["boss@example.com"],
  "message": "Please find attached.",
  "sections": ["quote", "sow"]
}
```

### Response extras
`quotation` now includes `sendMethod`, `sentTo`, `sentCc`, `sentMessage`, `sentAt`. Top-level: `sendMethod`, `sentTo`, `sentCc`, `messageIncluded`, `messageSourceKey`, `draftHtmlIncluded`, `pdfAttached`, `pdfWarning`.

The email body is the **sales-panel quotation draft** (assembled quote / SOW / contract HTML), plus the PDF of the same document. Optional `message` is prepended as a cover note. Drawings stay in the PDF attachment only.

On success, lead `lifecycleStatus` moves to `proposal_sent` if it was earlier (unlocks invoice create).

SMTP failure → `502`, quotation stays unsent, lead is **not** advanced.

---

## 4) Mark quotation sent (external email)

### Endpoints
- `POST /api/quotations/:quotationId/mark-sent`
- `POST /api/sales/quotations/:quotationId/mark-sent`

Same body as invoice mark-sent (`note` / `message`, optional `sentAt`).

Sets `status: "sent"`, `sendMethod: "manual"`, advances lead to `proposal_sent`, does **not** require SMTP.

`400` if already sent, not approved, or edited after approval.

---

## 5) GET payloads (list/detail)

Invoice and quotation documents now persist:

| Field | Type | When |
|---|---|---|
| `sendMethod` | `"platform"` \| `"manual"` \| `null` | After send / mark-sent |
| `sentAt` | ISO date \| `null` | Same |
| `sentTo` | string | Platform send only (empty on manual) |
| `sentCc` | string[] | Platform send only |
| `sentMessage` | string | Cover note or manual note |
| `customerEmail` | string | Customer record email, for send-modal **To** default |
| `defaultToEmail` | string | Same value as `customerEmail` |
| `customerName` | string | Customer first + last name (list + detail) |
| `projectName` | string | Lead project name |
| `jobId` / `projectId` | string | Lead job id (e.g. `PRO-011`). `projectId` is the same value |

Admin quotations list (`GET /api/quotations/approval/pending`) and sales quotations list now return these so the table can show who the quote belongs to.

`status` remains `"sent"` for both methods. Use `sendMethod` if the UI needs to label “Sent via email” vs “Marked sent”. Prefill send **To** with `quotation.defaultToEmail` or `quotation.customerEmail`. If omitted on `POST .../send`, backend still falls back to that customer email.

---

## Frontend wiring notes

1. Send modal: prefill **To** with `quotation.defaultToEmail` or `quotation.customerEmail`. Allow editing To, adding one or more CCs, and editing the draft. Attachments are still generated by the backend (invoice PDF / quotation PDF).
2. Two actions, two APIs:
   - **Send** → `POST .../send` (needs SMTP)
   - **Mark as sent** → `POST .../mark-sent` (Gmail/Outlook path)
3. Show **Mark as sent** only while `status !== "sent"` and approval is current.
4. Do not block invoice create just because `/send` was never used. After quotation mark-sent, lead is `proposal_sent`.
5. If `/send` returns 502, keep the document in the unsent/approved state and show the error. Do not treat it as sent.
6. Re-send via `/send` is still allowed after a successful send (updates `sendMethod` to `platform`). Mark-sent is rejected if already sent.
