# AI Voice Call (Twilio + Claude) — FE / ops handoff

**Status:** Backend implemented  
**Date:** 11 Nov 2026  
**Related:** [`../ai-call-twilio-integration-plan.md`](../ai-call-twilio-integration-plan.md)

Customers who already registered via **chat** can dial the Twilio number; AI (same Claude chat brain) talks on the phone and **shares chat memory** (`Message` + `Lead.aiContextSummary`). Call turns are also stored as Messages with `origin: "call"`.

---

## Twilio console setup (ops)

Point the inbound Voice number webhooks to:

| Event | Method | URL |
|-------|--------|-----|
| A call comes in | `POST` | `{TWILIO_WEBHOOK_BASE_URL}/api/twilio/voice/inbound` |
| Call status changes | `POST` | `{TWILIO_WEBHOOK_BASE_URL}/api/twilio/voice/status` |
| Primary handler fails | `POST` | `{TWILIO_WEBHOOK_BASE_URL}/api/twilio/voice/fallback` |

Gather loop uses:  
`POST {TWILIO_WEBHOOK_BASE_URL}/api/twilio/voice/gather?sessionId=…` (returned in TwiML).

**Env (Render):**

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=+1…          # SMS
TWILIO_PHONE_NUMBER=+1…        # Voice inbound (optional; falls back to FROM)
TWILIO_WEBHOOK_BASE_URL=https://mr-storage-backend-025k.onrender.com
TWILIO_VALIDATE_SIGNATURE=true
```

`TWILIO_WEBHOOK_BASE_URL` **must** be public HTTPS with **no trailing slash** so Gather `action` URLs are absolute.

---

## Behaviour summary

1. Caller dials Twilio number → `inbound` looks up `Customer` by phone (normalized).
2. **First contact (unknown number)** → create Customer + Lead from **caller ID** (`source: call`), placeholder name `Caller` + pending email `call.{phone}@pending.voice.local`. AI greets and **collects name, then email**, then project details (same 10 quote fields as chat).
3. **Returning customer** → open existing lead, greet by name, continue with shared chat/call memory.
4. Each speech turn → save turns as `Message` (`origin: "call"`) → Claude via `chat.service.js`.
5. When name + real email are captured → update Customer; clear `needsContactDetails`. Enquiry email may fire.
6. Quote ready / handoff only after contact is complete → same `handleQuoteReady` as chat; TTS closes and hangs up.
7. If already handed to sales → no AI conversation; hangup message only.

---

## Staff APIs

```http
GET /api/admin/leads/:leadId/calls?page=1&limit=20
GET /api/admin/calls/:callSessionId

GET /api/sales/leads/:leadId/calls?page=1&limit=20
GET /api/sales/calls/:callSessionId
```

Auth: Bearer JWT (`admin` / `sales`). Sales scoped to assigned leads.

### List response

```json
{
  "success": true,
  "data": {
    "calls": [
      {
        "callSessionId": "…",
        "twilioCallSid": "CA…",
        "status": "completed",
        "fromNumber": "+1…",
        "startedAt": "…",
        "endedAt": "…",
        "durationSeconds": 120,
        "isHandedToSales": false
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

### Detail response

```json
{
  "success": true,
  "data": {
    "call": { "callSessionId": "…", "leadId": "…", "status": "completed", "…" },
    "turns": [
      { "turnId": "…", "role": "ai", "transcript": "Hi…", "createdAt": "…" },
      { "turnId": "…", "role": "customer", "transcript": "I need a warehouse…", "createdAt": "…" }
    ]
  }
}
```

---

## Chat history badge

`GET /api/public/chat/history/:leadId` messages now include:

| Field | Values |
|-------|--------|
| `origin` | `chat` (default) \| `call` |
| `callSessionId` | set for call-originated rows |

FE can badge call turns inside the existing transcript UI.

---

## Socket.io (`/admin`)

| Event | Payload |
|-------|---------|
| `call_started` | `{ callSessionId, leadId, customerId, fromNumber }` |
| `call_turn` | `{ callSessionId, leadId, role, transcript, createdAt }` |
| `call_ended` | `{ callSessionId, leadId, durationSeconds, status }` |

Also emitted to room `lead:{leadId}` when `leadId` is present.

---

## FE checklist

- [ ] Lead detail → **Calls** tab using list + detail APIs  
- [ ] Chat transcript → badge `origin === "call"`  
- [ ] Live monitor: listen for `call_*` on `/admin`  
- [ ] Ops: configure Twilio Voice webhooks + `TWILIO_WEBHOOK_BASE_URL`  
