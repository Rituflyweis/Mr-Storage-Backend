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

## Voice engine (ElevenLabs)

The same Twilio number stays on `POST /api/twilio/voice/inbound`. Default engine is **ConversationRelay**:

- Deepgram listens (streaming)
- Claude streams the reply (same chat memory and summary as the widget)
- ElevenLabs v4 speaks it on the Twilio number

No ElevenLabs API key is stored in this backend. Twilio calls ElevenLabs. Optional env:

```env
VOICE_ENGINE=elevenlabs
ELEVENLABS_VOICE_ID=UgBBYS2sOqTuMpoF3BR0
ELEVENLABS_TTS_MODEL=v4
VOICE_LANGUAGE=en-US
```

Set `VOICE_ENGINE=gather` to roll back to the older Polly `<Gather>` loop.

WebSocket (Twilio connects, not the browser): `wss://{host}/api/twilio/voice/relay`

If the caller stays silent for `VOICE_SILENCE_MS` (default 8s) after Alex finishes speaking, Alex asks if they are still there. That happens `VOICE_SILENCE_CHECKS` times (default 3). If there is still no reply, the call ends.

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
GET /api/admin/leads/:leadId/transcripts?channel=all
GET /api/admin/leads/:leadId/calls?page=1&limit=20
GET /api/admin/calls/:callSessionId

GET /api/sales/leads/:leadId/transcripts?channel=all
GET /api/sales/leads/:leadId/calls?page=1&limit=20
GET /api/sales/calls/:callSessionId
```

Auth: Bearer JWT (`admin` / `sales`). Sales scoped to assigned leads.

### Lead transcripts (Chat / Call / Summary tabs)

One round-trip for switchable UI tabs. Pass `leadId`.

| Query | Values | Default |
|-------|--------|---------|
| `channel` | `all` \| `chat` \| `call` \| `summary` | `all` |

```http
GET /api/admin/leads/:leadId/transcripts
GET /api/sales/leads/:leadId/transcripts?channel=call
```

```json
{
  "success": true,
  "data": {
    "leadId": "…",
    "customerId": "…",
    "projectName": "Garage LLC",
    "jobId": "PRO-011",
    "tabs": {
      "hasChat": true,
      "hasCall": true,
      "hasSummary": true
    },
    "summary": {
      "text": "Customer needs a 40x60 garage in Texas…",
      "updatedAt": "2026-11-11T11:40:00.000Z"
    },
    "chat": {
      "messageCount": 12,
      "messages": [
        {
          "messageId": "…",
          "senderType": "customer",
          "content": "I need a quote",
          "createdAt": "…",
          "isRead": true,
          "origin": "chat",
          "callSessionId": null,
          "channel": "project"
        }
      ]
    },
    "call": {
      "sessionCount": 1,
      "turnCount": 8,
      "sessions": [
        {
          "callSessionId": "…",
          "twilioCallSid": "CA…",
          "status": "completed",
          "fromNumber": "+9195…",
          "toNumber": "+1618…",
          "startedAt": "…",
          "endedAt": "…",
          "durationSeconds": 95,
          "isHandedToSales": false,
          "turnCount": 8,
          "turns": [
            { "turnId": "…", "role": "ai", "transcript": "Hi…", "createdAt": "…", "messageId": "…" },
            { "turnId": "…", "role": "customer", "transcript": "I need a warehouse…", "createdAt": "…", "messageId": "…" }
          ]
        }
      ]
    }
  }
}
```

**FE usage**

- Tab **Chat** → `data.chat.messages` (excludes call-origin rows)
- Tab **Call** → `data.call.sessions[].turns` (grouped per call)
- Tab **Summary** → `data.summary.text`
- Use `data.tabs.hasChat / hasCall / hasSummary` to disable empty tabs
- Optional: fetch only one tab with `?channel=chat` (or `call` / `summary`)

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

- [ ] Lead detail → switchable **Chat / Call / Summary** tabs via `GET …/transcripts`  
- [ ] Lead detail → **Calls** list/detail still available for per-session drill-down  
- [ ] Chat transcript → badge `origin === "call"` (public history)  
- [ ] Live monitor: listen for `call_*` on `/admin`  
- [ ] Ops: configure Twilio Voice webhooks + `TWILIO_WEBHOOK_BASE_URL`  
