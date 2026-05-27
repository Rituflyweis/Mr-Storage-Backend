# AI Voice Call via Twilio — Implementation Reference

> **Status:** Not implemented. This document captures the demo behaviour and maps it onto the existing Mr Storage backend so we can implement it later without re-discovering requirements.
>
> **Related docs:** [sales_lead_chat_integration.md](./sales_lead_chat_integration.md) · [ai_script_socket.md](./ai_script_socket.md)

---

## 1. Goal

Mirror the existing **AI chat** experience as an **AI phone call**:

- A customer who has already chatted (or exists in CRM) calls a **Twilio phone number** from their registered phone.
- The backend identifies them, loads lead + conversation context, and runs the same Claude logic used in chat.
- Twilio handles the voice layer (TTS playback, speech transcription webhooks).
- Every turn is stored as **call history with transcriptions**.
- Future **chat or call** sessions reuse the same rolling context (`aiContextSummary`, message/call history).

This is **not** a sales-rep live call — it is AI-first, identical lifecycle to chat until `isHandedToSales = true`.

---

## 2. Current State (as of May 2026)

| Area | Status |
|---|---|
| Twilio SDK / webhooks | ❌ Not present |
| Voice / SMS env vars | ❌ Not in `.env.example` |
| AI (Claude) chat | ✅ `src/services/ai/chat.service.js` |
| Customer match by phone | ✅ `POST /api/public/chat/init` and `Customer.phone.number` index |
| Message storage | ✅ `src/models/Message.js` (`customer` \| `ai` \| `sales`) |
| Rolling AI summary | ✅ `Lead.aiContextSummary` |
| Quote ready + round-robin | ✅ `src/services/socket/chat.handler.js` → `handleQuoteReady` |
| Lead scoring | ✅ `src/services/ai/scoring.service.js` |

**Reuse as much chat infrastructure as possible.** The voice layer is new; the brain is not.

---

## 3. Demo Flow (what we built in the demo)

```
Customer dials Twilio number
        │
        ▼
Twilio POST → /api/twilio/voice/inbound   (webhook)
        │
        ├─ Lookup Customer by caller phone (From)
        ├─ Resolve active Lead (same logic as chatInit)
        ├─ Create CallSession record
        └─ Return TwiML greeting (TTS)
        │
        ▼
Call loop (repeat until hangup or handoff to sales)
        │
        ├─ Twilio captures caller speech → sends transcription webhook
        │       POST → /api/twilio/voice/transcription  (or gather callback)
        │
        ├─ Backend saves customer turn (transcript text)
        ├─ Loads full context (messages + prior call turns + aiContextSummary)
        ├─ Calls Claude via chat.service (same prompt / QUOTE_DATA parsing)
        ├─ Saves AI turn (transcript text)
        ├─ Returns TwiML <Say> or streaming TTS with AI reply
        │
        └─ Optional: emit Socket.io events to /admin for live monitoring
        │
        ▼
On hangup → Twilio status callback
        POST → /api/twilio/voice/status
        └─ Mark CallSession ended, duration, final status
```

### Key demo behaviours to preserve

1. **Returning caller recognition** — match `Customer` by `phone.number` (normalize E.164 / strip country code consistently with chat init).
2. **Same AI personality and quote extraction** — reuse `chat.service.js`; `QUOTE_DATA:{...}` still triggers quote-ready + round-robin.
3. **Shared memory** — a customer who chatted yesterday and calls today should not start from zero; Claude sees prior chat messages + prior call transcripts + `aiContextSummary`.
4. **Post-handoff silence** — once `lead.isHandedToSales === true`, AI stops replying on calls (play message: "Your sales rep will follow up" or transfer — product decision).
5. **Admin visibility** — sales/admin panel can see live call turns via Socket.io (same pattern as chat `new_message` on `/admin`).

---

## 4. Architecture Diagram

```
┌─────────────┐     PSTN      ┌──────────────┐   webhooks    ┌─────────────────────┐
│  Customer   │ ────────────► │    Twilio    │ ────────────► │  Express (this API) │
│  (phone)    │ ◄──────────── │  Voice #     │ ◄──────────── │  /api/twilio/voice/*│
└─────────────┘   TTS/audio   └──────────────┘    TwiML      └──────────┬──────────┘
                                                                          │
                    ┌─────────────────────────────────────────────────────┤
                    │                                                     │
                    ▼                                                     ▼
           ┌────────────────┐                                  ┌──────────────────┐
           │  chat.service  │◄── same Claude prompt ──────────│  CallSession +   │
           │  scoring.service│                                 │  CallTurn models │
           │  roundRobin    │                                  │  Message (opt.)  │
           └────────────────┘                                  └──────────────────┘
                    │
                    ▼
           ┌────────────────┐
           │  Socket.io     │  live turns → /admin namespace
           │  /admin        │  `call_turn`, `call_started`, `call_ended`
           └────────────────┘
```

---

## 5. Twilio Integration Surface

### 5.1 New env vars (add to `.env.example` when implementing)

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=          # inbound number customers dial
TWILIO_WEBHOOK_BASE_URL=      # public HTTPS base, e.g. https://api.example.com
TWILIO_VALIDATE_SIGNATURE=true # reject unsigned webhooks in production
```

### 5.2 Webhook routes (proposed)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/twilio/voice/inbound` | Initial call — identify customer, start session, return greeting TwiML |
| `POST` | `/api/twilio/voice/gather` | Speech result / transcription turn — Claude reply loop |
| `POST` | `/api/twilio/voice/status` | Call completed / failed / busy — finalize session |
| `POST` | `/api/twilio/voice/fallback` | Error TwiML if primary webhook fails |

> **Auth:** Twilio webhooks are **not JWT-protected**. Validate `X-Twilio-Signature` instead. Do not mount these behind `verifyToken`.

### 5.3 TwiML response pattern (conceptual)

Each turn returns XML roughly like:

```xml
<Response>
  <Say voice="Polly.Joanna">Hi John, thanks for calling. What can I help you with today?</Say>
  <Gather input="speech" action="/api/twilio/voice/gather?sessionId=..." speechTimeout="auto" />
</Response>
```

After Claude generates text, strip any `QUOTE_DATA:{...}` block before TTS (same as chat UI would hide raw JSON).

**Product note:** Demo may have used Twilio ConversationRelay / Media Streams for lower latency. Pick one approach at implementation time; the backend contract (transcript in → Claude → text out) stays the same.

---

## 6. Customer & Lead Resolution

Reuse logic from `src/controllers/public.controller.js` → `chatInit`:

1. Normalize incoming `From` number to match `Customer.phone.number` storage format.
2. `Customer.findOne({ 'phone.number': normalizedPhone })`.
3. If **no customer** → play TwiML: "We don't recognize this number. Please start on our website chat first." → hang up. (Or optionally create customer via IVR — out of demo scope.)
4. If customer exists → `Lead.findOne({ customerId, lifecycleStatus: { $nin: CLOSED_STAGES } }).sort({ createdAt: -1 })`.
5. If no active lead → create lead (same as chatInit step 4) with `source: 'call'` (add to `LEAD_SOURCES` in `constants.js` if needed).

Attach `callSession.leadId` and `callSession.customerId` for all subsequent turns.

---

## 7. Claude Integration — Reuse Chat Service

**Do not fork a second prompt.** Import and call existing helpers:

| Chat (today) | Call (future) |
|---|---|
| `chatService.chat(allMessages, { customer, currentConversationSummary })` | Same function |
| Messages from `Message` collection | Build equivalent array from chat messages **+** call turns |
| `chatService.refreshContextSummary(leadId)` | Call after each AI turn (fire-and-forget) |
| `scoringService.updateLeadScore(leadId, ...)` | Call after each AI turn |
| `handleQuoteReady(...)` | Extract to shared module; call from both chat handler and voice handler |

### Context assembly for Claude

When building `allMessages` for a call turn, merge in order:

1. Existing `Message` documents for `leadId` (`senderType`, `content`, `createdAt`).
2. Turns from **current** `CallSession` (and optionally prior completed sessions for same lead).
3. Pass `lead.aiContextSummary` as `currentConversationSummary` (already supported by `chat.service.js`).

Suggested mapping for call turns inside the Claude messages array:

| Speaker | Maps to `senderType` |
|---|---|
| Caller transcript | `customer` |
| AI spoken reply (text before TTS) | `ai` |

---

## 8. Data Model (proposed)

### 8.1 `CallSession`

```js
{
  twilioCallSid:   String,   // unique, indexed
  customerId:      ObjectId,
  leadId:          ObjectId,
  fromNumber:      String,   // E.164 or normalized
  toNumber:        String,   // Twilio number
  status:          'in-progress' | 'completed' | 'failed' | 'no-answer' | 'busy',
  startedAt:       Date,
  endedAt:         Date,
  durationSeconds: Number,
  isHandedToSales: Boolean,  // snapshot at start; re-check each turn
}
```

### 8.2 `CallTurn` (one row per speech exchange)

```js
{
  callSessionId: ObjectId,
  leadId:        ObjectId,
  customerId:    ObjectId,
  role:          'customer' | 'ai',
  transcript:    String,     // speech-to-text or AI text sent to TTS
  twilioGatherSid: String,   // optional trace id
  createdAt:     Date,
}
```

### 8.3 Optional: extend `Message` instead of separate turns

Alternative — add fields to existing `Message` model:

```js
channel: { type: String, enum: ['chat', 'call'], default: 'chat' }
callSessionId: { type: ObjectId, ref: 'CallSession', default: null }
```

**Recommendation:** Start with `CallSession` + `CallTurn` for clean call history APIs; **also** mirror customer/AI turns into `Message` with `channel: 'call'` so chat history UI and Claude context stay unified without custom merge logic everywhere.

---

## 9. REST APIs (proposed, for admin/sales UI)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/admin/leads/:leadId/calls` | admin | List call sessions for a lead |
| `GET` | `/api/admin/calls/:callSessionId` | admin, sales (own leads) | Full transcript (turns) |
| `GET` | `/api/sales/leads/:leadId/calls` | sales | Same, scoped to assigned leads |

Chat history endpoint stays as-is; optionally extend `GET /api/public/chat/history/:leadId` to include `channel` field so frontends can badge chat vs call messages.

---

## 10. Socket.io Events (proposed, `/admin` namespace)

Mirror chat monitoring events:

| Event | Direction | Payload (sketch) |
|---|---|---|
| `call_started` | server → admin | `{ callSessionId, leadId, customerId, fromNumber }` |
| `call_turn` | server → admin | `{ callSessionId, leadId, role, transcript, createdAt }` |
| `call_ended` | server → admin | `{ callSessionId, leadId, durationSeconds, status }` |
| `lead_quote_ready` | already exists | Reuse when QUOTE_DATA detected on a call |

Room strategy: same as chat — `lead:${leadId}` plus notify assigned sales `user:${assignedSalesId}`.

No customer Socket.io connection on phone calls (unless we add a parallel web widget later).

---

## 11. Handoff & Quote-Ready Parity

When Claude returns `QUOTE_DATA:{...}` during a call, run the **same side effects** as chat:

1. Update lead: `isQuoteReady`, `quoteValue`, `aiQuoteData`.
2. Audit log: `LEAD_QUOTE_READY`.
3. Round-robin assign sales (`roundRobinService.assignNextSales`).
4. Set `isHandedToSales = true` (via existing assignment flow).
5. Emit `lead_quote_ready` + `lead_handed_to_sales` on admin namespace.
6. Play closing TTS: inform caller a sales representative will follow up (no further AI gather loop).

Reference implementation today: `handleQuoteReady` in `src/services/socket/chat.handler.js` — **extract to** `src/services/leadHandoff.service.js` (or similar) before wiring voice.

---

## 12. Phone Number Normalization

Critical for matching chat-registered customers:

- Chat init stores `phone.number` as digits the client sends (e.g. `9876543210`) and `phone.countryCode` separately (e.g. `+91`).
- Twilio `From` arrives E.164 (e.g. `+919876543210`).
- Implement one shared util: `normalizePhoneForLookup(twilioFrom, countryCode?)` used by both chat init and voice webhooks.

Index already exists: `CustomerSchema.index({ 'phone.number': 1 })`.

---

## 13. Files to Create / Modify (checklist)

### New files

```
src/routes/twilio/voice.routes.js
src/controllers/twilio/voice.controller.js
src/services/twilio/twilioClient.js          # SDK wrapper
src/services/twilio/voiceCall.service.js     # session + turn orchestration
src/services/twilio/twiml.builder.js         # XML helpers
src/middleware/twilioSignature.js            # validate X-Twilio-Signature
src/models/CallSession.js
src/models/CallTurn.js
src/utils/normalizePhone.js
```

### Modify existing

```
app.js                          # mount /api/twilio (no JWT)
src/config/env.js               # Twilio env validation
src/config/constants.js         # LEAD_SOURCES add 'call', AUDIT_ACTIONS for call events
src/models/Message.js           # optional channel + callSessionId
src/services/socket/chat.handler.js  # extract handleQuoteReady to shared service
package.json                    # add "twilio" dependency
.env.example                    # Twilio vars
docs/API_REFERENCE.md           # document new endpoints when built
postman_collection.json         # optional Twilio webhook simulation notes
```

---

## 14. Security & Ops Notes

- **Webhook signature validation** — mandatory in production (`twilio.validateRequest`).
- **Public URL** — Twilio requires HTTPS; local dev uses ngrok / Cloudflare tunnel pointing at `TWILIO_WEBHOOK_BASE_URL`.
- **Rate limiting** — consider separate limiter on `/api/twilio/*`; speech turns can arrive quickly.
- **Idempotency** — Twilio retries webhooks; use `twilioCallSid` + gather sequence to dedupe turn processing.
- **PII** — call transcripts are as sensitive as chat messages; same retention/access rules as `Message`.
- **Vercel** — if deployed serverless, confirm webhook timeout limits; long Claude calls may need streaming TTS or async gather pattern.

---

## 15. Testing Plan (when implementing)

1. **Unit:** phone normalization, TwiML builder, context merge (chat messages + call turns).
2. **Integration:** mock Twilio POST payloads for inbound → gather → status.
3. **E2E manual:**
   - Register customer via `POST /api/public/chat/init`.
   - Send a few chat messages.
   - Call Twilio number from same phone.
   - Verify AI references prior chat context.
   - Complete quote flow on call; confirm round-robin + `isHandedToSales`.
   - Call again; verify AI is silent / handoff message plays.
4. **Admin UI:** confirm `call_turn` socket events appear on lead detail.

---

## 16. Open Product Decisions (resolve before build)

| # | Question |
|---|---|
| 1 | Unknown caller — reject call or IVR collect name/email? |
| 2 | After handoff — hang up, hold music, or warm transfer to sales cell? |
| 3 | Store call turns only in `CallTurn`, only in `Message`, or both? |
| 4 | Show call transcript inside existing chat UI or separate "Calls" tab? |
| 5 | Twilio speech: `<Gather input="speech">` vs ConversationRelay / Media Streams? |
| 6 | Record full call audio to S3 or transcript-only? |

---

## 17. One-Line Prompt for Future Implementation

> "Implement AI voice calls per `docs/ai-call-twilio-integration-plan.md`: Twilio inbound webhooks, customer lookup by phone, reuse `chat.service.js` for Claude, store `CallSession`/`CallTurn` transcripts, shared context with chat via `aiContextSummary` + merged messages, quote-ready handoff identical to chat, admin socket events for live monitoring."

---

*Last updated: May 2026 — planning doc only, no code changes.*
