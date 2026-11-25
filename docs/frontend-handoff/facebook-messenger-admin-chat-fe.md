# Facebook Messenger — admin and sales chat (FE handoff)

**Date:** 24 Nov 2026  
**Panels:** Admin, Sales  
**Backend:** `Mr-Storage-Backend` (`shubham-changes-13-aug`, Render `https://mr-storage-backend-025k.onrender.com`)  
**Related:** `docs/customer-online-status-frontend-guide.md`, `docs/sales_lead_chat_integration.md`, `docs/frontend-handoff/optional-email-phone-admin-sales.md`

Facebook Page messages are handled by **Sam** (same AI as the website chat). Each Messenger thread becomes a **lead** with `source: "messenger"`. Staff use the **same Open Chat UI** as website leads: join the lead room on `/admin`, read history, send `sales_message`, first staff reply stops Sam and delivers the text to the customer on Facebook.

---

## What to build in the UI

1. **Lead list / detail** — show that the lead came from Facebook (`lead.source === "messenger"`). Do not expect email or phone on new Messenger customers; show blank or “Not provided” (see optional contact doc).
2. **Open Chat** — one thread per lead. Each message bubble should show **where it was sent** using `sourceLabel` (**Website** vs **Facebook**). Phone transcripts use **Phone** when present.
3. **Online indicator** — reuse the existing green dot / “Active now” from `chat-status` and `customer_online_status`. For Facebook there is no website socket; the customer is marked online for **~5 minutes** after they send a message on Messenger.
4. **Staff send** — unchanged socket event `sales_message`; backend routes replies to Facebook when the customer has a Messenger id.
5. **Do not** show old placeholder values (`fb-…@pending.messenger.local`, `+0 …` PSID as phone). If you still see them, refresh after backend cleanup; new leads never get those fields.

---

## Lead and customer fields

| Field | Messenger lead | Website chat lead |
|-------|----------------|-------------------|
| `lead.source` | `"messenger"` | `"chat"` (or others) |
| `customer.email` | Often absent | Usually present |
| `customer.phone` | Often absent | Often present |
| Message `origin` | `"messenger"` | `"chat"` (default) |

There is no separate “Facebook inbox” API. Filter or badge leads with `source: "messenger"` in the list/detail you already use.

---

## Message shape (history + live)

Every chat message row (REST and sockets) should include:

| Field | Type | Meaning |
|-------|------|---------|
| `origin` | `"chat"` \| `"messenger"` \| `"call"` | Storage enum |
| `source` | `"website"` \| `"facebook"` \| `"phone"` | UI channel id |
| `sourceLabel` | `"Website"` \| `"Facebook"` \| `"Phone"` | Human label for the bubble or chip |
| `senderType` | `"customer"` \| `"ai"` \| `"admin"` \| `"sales"` | Unchanged |
| `senderName` | string | e.g. customer first name, **Sam**, staff name |
| `content` | string | Message body |
| `createdAt` | ISO date | |

**Example — Facebook customer + Sam**

```json
{
  "_id": "…",
  "senderType": "customer",
  "senderName": "Node",
  "content": "I need a quote for a 40x60 building",
  "createdAt": "2026-11-23T12:18:20.692Z",
  "origin": "messenger",
  "source": "facebook",
  "sourceLabel": "Facebook"
}
```

**Example — staff reply (also delivered to Messenger)**

```json
{
  "_id": "…",
  "senderType": "admin",
  "senderName": "Admin User",
  "content": "I'll have sales call you this afternoon.",
  "createdAt": "2026-11-23T13:00:00.000Z",
  "origin": "messenger",
  "source": "facebook",
  "sourceLabel": "Facebook",
  "leadId": "…"
}
```

**UI suggestion:** small caption under or beside the bubble — `Facebook` / `Website` — from `sourceLabel`. Optional thread header chip: **Chat via Facebook** when `GET …/chat-status` returns `channel: "facebook"`.

---

## REST endpoints (unchanged paths)

### Lead detail (initial chat pane)

```http
GET /api/admin/leads/:leadId/detail
GET /api/sales/leads/:leadId/detail   # assigned lead only
Authorization: Bearer <token>
```

`data.recentMessages` — last 20 messages, ascending, each mapped with `origin`, `source`, `sourceLabel`.

Sales path note: prefer **`/detail`**, not `GET /api/sales/leads/:leadId` alone, for the full payload including `recentMessages`.

### Chat status (online + channel)

```http
GET /api/admin/leads/:leadId/chat-status
GET /api/sales/leads/:leadId/chat-status
```

**New field on `data`:**

| Field | Values | UI |
|-------|--------|-----|
| `channel` | `"website"` \| `"facebook"` | Header: “Website chat” vs “Facebook Messenger” |

Other fields unchanged: `isCustomerOnline`, `isStaffChatActive`, `isAiActive`, `canStaffSend`, `customerOnline`, `leadOnlineAt`, `leadLastSeenAt`. See `docs/customer-online-status-frontend-guide.md`.

### Full transcript (optional tabs)

```http
GET /api/admin/leads/:leadId/transcripts?channel=all
GET /api/sales/leads/:leadId/transcripts?channel=all
```

| `channel` query | Use |
|-----------------|-----|
| `all` | Chat + call + summary |
| `chat` | Website + messenger text (excludes `origin: "call"`) |
| `messenger` | Only `origin: "messenger"` |
| `call` | Call turns |

Each message in `data.chat.messages` or `data.messenger.messages` includes `origin`, `source`, `sourceLabel`.

### Public history (same shape)

`GET /api/public/chat/history/:leadId` — messages include `origin`, `source`, `sourceLabel` (website widget only in practice).

---

## Socket.io (admin / sales panel)

Namespace: **`/admin`**, auth: `auth.token` = JWT (same as today).

| Event | Direction | Notes |
|-------|-----------|--------|
| `join_lead_chat` | Client → server | `{ leadId }` — required to receive lead messages |
| `sales_message` | Client → server | `{ leadId, content }` — **unchanged**; first message sets `isStaffChatActive`, stops Sam; Facebook customers get the text on Messenger |
| `new_message` | Server → client | Payload includes `origin`, `source`, `sourceLabel` when backend is current |
| `chat_status` | Server → client | Includes `channel` |
| `customer_online_status` | Server → client | Same as website; fires when Messenger user messages or goes idle |
| `staff_chat_active` | Server → client | Sam handed off |
| `error` | Server → client | e.g. `{ message: "Saved in the CRM, but Facebook did not accept the reply" }` if Graph API fails after save |

**Composer:** Keep using `sales_message`. Do not add a separate “Facebook send” API.

**Customer widget (`/chat`):** Messenger users do not use the website widget; no FE change there for Facebook.

---

## AI vs staff (same rules as website)

| State | Customer messages | Who replies |
|-------|-------------------|-------------|
| Default | Saved | **Sam** (`senderType: "ai"`, `senderName: "Sam"`) |
| After first `sales_message` | Saved | Staff only; Sam silent |
| `isHandedToSales` | Saved | Staff (existing handoff rules) |
| `isChatEnded` | Blocked on website | Staff can still use end/reopen endpoints |

Messenger inbound while staff is active: customer text is stored; Sam does not auto-reply (same as website staff takeover).

---

## Contact block on lead detail

For `source: "messenger"`:

- Show **Name** from Facebook profile (`customer.firstName` / `lastName`).
- **Email** / **Phone** — empty until staff adds them via lead edit or customer edit (`PUT` with optional contact — see optional-email-phone doc).
- Do not treat missing email as an error state for Messenger leads.
- Customer portal login still requires email later if you want portal access.

---

## Online presence (Facebook)

| Mechanism | Website | Facebook |
|-----------|---------|----------|
| Customer connects | `/chat` socket `join_lead` | Webhook when user messages Page |
| `Lead.isOnline` / `Customer.isOnline` | Socket registry | `true` on message; **false** ~5 min after last message with no website socket |
| Staff UI | Existing dot on Open Chat | **Same** fields — no separate Facebook flag |

Listen for `customer_online_status` on `admin_room`, `lead:{leadId}`, and assigned `user:{salesId}`.

---

## Typing in the Facebook app (customer view)

The Page shows Meta’s **typing bubble** when:

| Who | Backend |
|-----|---------|
| **Sam** | `typing_on` while Claude runs (re-pulsed every ~18s) through send; cleared when the reply is sent |
| **Admin / sales** | Existing `sales_typing_start` / `sales_typing_stop` on `/admin` also call Messenger `typing_on` / `typing_off` when the lead’s customer has `facebookPsid` |

**FE:** Keep emitting `sales_typing_start` while the staff user is composing in Open Chat (same as website). On send, `sales_message` clears typing before the outbound Facebook text.

**Not supported:** Showing *customer* typing to staff from Facebook — Meta does not webhook inbound typing events.

---

## Lead list (optional polish)

If the list API returns `lead.source`, show a small **Messenger** or **Facebook** badge next to `initial contact` leads. Score/list rows that expose `isOnline` / `lastSeenAt` behave the same for Messenger leads when the customer was recently active on Facebook.

---

## QA checklist

1. Open a lead with `source: "messenger"` — contact shows no fake email/phone.
2. Open Chat — history shows Sam + customer lines with **Facebook** on `origin: "messenger"` rows.
3. Send staff message — appears in admin UI and in the Facebook thread; Sam does not answer the next customer line.
4. While customer is messaging on Facebook, `chat-status.isCustomerOnline` is true; after ~5 minutes idle, false.
5. Website lead messages show **Website** on bubbles; mixed-origin only if one customer used both channels on different leads (unusual).

---

## Backend deploy note for FE

Confirm Render is on a commit that includes:

- Empty Messenger contact (no placeholder email/phone)
- `source` / `sourceLabel` on messages and `channel` on chat-status
- Staff `sales_message` → Messenger send + Facebook online presence

If `sourceLabel` is missing on `recentMessages`, the deployed API is behind; ping backend to deploy latest `shubham-changes-13-aug`.

---

## Not in scope (v1)

- Instagram DMs  
- Meta “Lead Centre” lead ads import (only Page Messenger webhook today)  
- Customer typing indicators on Facebook (Meta does not send typing webhooks to the Page)  
- Splitting one lead into separate website vs Facebook threads (single lead thread, labels per message)