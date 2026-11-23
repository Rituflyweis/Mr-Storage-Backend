# DocuSign contract signing — API

**Date:** 21 Nov 2026  
**Panels:** Admin, Sales, Customer  
**Flow:** Email signing. The customer signs on DocuSign’s site. This app stores status and, when signing is finished, the signed PDF on the project agreement.

Manual upload (`POST /api/upload/leads/:leadId/agreement`) still works as a fallback.

## Send

`POST /api/admin/leads/:leadId/contract/send`  
`POST /api/sales/leads/:leadId/contract/send`

Sales can send only on a lead assigned to them.

```json
{
  "signerName": "Jane Smith",
  "signerEmail": "jane@example.com",
  "message": "Please review and sign the fabrication agreement.",
  "cc": ["ops@example.com"],
  "companySigner": { "name": "Travis Overhue", "email": "travis@example.com" }
}
```

`signerName` and `signerEmail` default to the customer on the lead. `cc` and `companySigner` are optional. A company signer signs second. DocuSign emails the customer. Do not embed DocuSign.

**201** `data.signature`

```json
{
  "status": "sent",
  "statusLabel": "Sent",
  "signerName": "Jane Smith",
  "signerEmail": "jane@example.com",
  "documentName": "Fabrication & Supply Agreement",
  "sentAt": "2026-11-21T12:00:00.000Z",
  "signedPdfUrl": "",
  "canSend": false,
  "canRemind": true,
  "canVoid": true,
  "canDownload": false
}
```

## Status

`GET /api/admin/leads/:leadId/contract`  
`GET /api/sales/leads/:leadId/contract`  
`GET /api/customer/projects/:leadId/contract`

The staff and customer reads refresh from DocuSign when an envelope is still open, so the badge can update before the webhook arrives.

The same `signature` object is included on:

- `GET /api/admin/leads/:leadId/agreement`
- `GET /api/sales/leads/:leadId/agreement`
- the customer-project agreement reads

| `status` | `statusLabel` | Buttons |
|---|---|---|
| `not_sent` | Not sent | Send |
| `sent` | Sent | Remind, Void |
| `delivered` | Delivered | Remind, Void |
| `viewed` | Opened | Remind, Void |
| `completed` | Signed | Download `signedPdfUrl` |
| `declined` | Declined | Send again. Show `declineReason` when present |
| `voided` | Voided | Send again |
| `expired` | Expired | Send again |

`canSend` is false while a contract is out for signature or already signed. Void the open envelope before sending a new one.

## Remind, void, resend

| Action | Path | Body |
|---|---|---|
| Remind | `POST .../contract/remind` | none |
| Void | `POST .../contract/void` | `{ "reason": "Wrong email" }` |
| Resend | `POST .../contract/resend` | same fields as send |

Resend on an open envelope updates the signer email and emails DocuSign again. Resend after void, decline, or expiry creates a new envelope.

When status is `completed`, the signed PDF is also stored as the lead’s contract document. Agreement download uses that file. Accounts still treat the project as signed only when that file exists.

## Errors

**400** when DocuSign is not configured, the signer email is missing or invalid, a contract is already out for signature, or the contract is already signed.

```json
{ "success": false, "message": "A contract is already out for signature. Void it before sending another." }
```

## Webhook

DocuSign Connect posts to `POST /api/docusign/webhook`. In production the request must include `X-DocuSign-Signature-1` signed with `DOCUSIGN_CONNECT_SECRET`. Status still updates on the GET above if the webhook is late.

## Server env

`DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_RSA_PRIVATE_KEY`  
Optional: `DOCUSIGN_OAUTH_HOST` (default demo), `DOCUSIGN_BASE_URL` (default demo REST), `DOCUSIGN_CONNECT_SECRET`
