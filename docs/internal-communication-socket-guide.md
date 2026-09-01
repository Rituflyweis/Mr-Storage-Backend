# Internal Communication — Socket & API Guide

Backend integration guide for the Internal Communication section (Direct + Group chat) for internal staff — Admin, Sales, Plant, Construction, Account. Customers are excluded; this system is entirely separate from customer-facing chat.

- **Base URL:** `{baseUrl}/api`
- **Socket namespace:** `/admin`
- **Transport:** Socket.IO v4
- **Auth:** JWT access token (same one used for REST calls)

---

## 1. Connection Setup

### Environment

| Variable | Example |
|---|---|
| `API_BASE_URL` | `https://api.mrstorage.dev/api` |
| `SOCKET_URL` | `https://api.mrstorage.dev` (namespace `/admin` appended by the client) |

### 1. Authenticate

```js
const { data } = await axios.post(`${API_BASE_URL}/auth/login`, {
  email: "user@mrstorage.dev",
  password: "••••••••",
});
const { accessToken, refreshToken } = data.data;
// accessToken expires in 15 min — POST /auth/refresh with refreshToken to renew
```

### 2. REST client

```js
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

### 3. Socket connection

```js
import { io } from "socket.io-client";

const socket = io(`${SOCKET_URL}/admin`, {
  auth: { token: accessToken },
  transports: ["websocket"],
});

socket.on("connect", () => {
  // Server auto-joins this socket to room `user:{yourUserId}`
  // — every DM notice and group-membership event lands here.
});

socket.on("connect_error", (err) => {
  // "Authentication required" — no token sent
  // "Invalid token"          — expired/malformed token, refresh and retry
});
```

No chat history is replayed on connect — fetch it via REST first, then let the socket carry new messages from that point on.

**Response envelope for every REST call below:**
```json
{ "success": true, "message": "...", "data": { ... } }
// errors: { "success": false, "message": "...", "errors": null | [...] }
```

---

## 2. ⚠️ Critical — channelId and channelType rules

> **This exact mistake crashed the production server once — read this before writing any chat code.**

- `channelType` accepts **only two values**: `"direct"` or `"group"`. There is no `"department"` channel type in this system — that belonged to an old, separate implementation. Do not reuse department-style keys.
- `channelId` must **always be a real MongoDB `_id`**:
  - For `direct` → the other user's `_id` (from `GET /team-chat/users`)
  - For `group` → the group's `_id` (from `POST /team-chat/groups` or `GET /team-chat/conversations`)
- **Never** hardcode a static string like `"sales_team"` or a department name as `channelId`.
- An invalid `channelId` on `team_message` emits `team_chat_error` back to you — listen for it. On `join_team_channel` it's a silent no-op (no error event, room just isn't joined) — don't assume a join succeeded just because nothing came back; confirm by watching for `new_team_message` events in that room.

---

## 3. REST API

All under `{baseUrl}/api/team-chat`. Header `Authorization: Bearer {accessToken}` required on every call.

### Direct chat

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/team-chat/users?search=` | List/search staff to start a conversation |
| GET | `/team-chat/conversations` | Combined direct + group list, sorted by recency |
| GET | `/team-chat/unread-count` | Unread badge (direct + group + total) |
| GET | `/team-chat/direct/:userId/messages` | History, paginated — auto-marks read |
| POST | `/team-chat/direct/:userId/messages` | Send a message (content and/or attachments) |

### Group chat

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/team-chat/groups` | Create a group with members |
| GET | `/team-chat/groups/:groupId` | Detail + populated member list |
| PUT | `/team-chat/groups/:groupId/members` | Add/remove members — admin-only |
| GET | `/team-chat/groups/:groupId/messages` | History, paginated — auto-marks read |
| POST | `/team-chat/groups/:groupId/messages` | Send a message (content and/or attachments) |

### Request/response examples

```js
// POST /team-chat/direct/:userId/messages
{ "content": "Delivery is staged, dispatching at 3pm.", "attachments": [] }

// → 201, data.message
{
  "_id": "66f0c1...", "channelType": "direct",
  "directKey": "66e1a2_66f0c1", "participants": ["66e1a2...", "66f0c1..."],
  "senderId": "66e1a2...", "senderName": "Aisha Khan", "senderRole": "plant",
  "content": "Delivery is staged, dispatching at 3pm.", "attachments": [],
  "readBy": ["66e1a2..."], "createdAt": "2026-08-21T14:04:32.714Z"
}

// POST /team-chat/groups
{ "name": "Project Alpha Team", "memberIds": ["66f0c1...", "66f0c2..."] }

// PUT /team-chat/groups/:groupId/members
{ "addMemberIds": ["66f0c3..."], "removeMemberIds": ["66f0c2..."] }
```

> Message send requires `content` or at least one `attachments` entry — never both empty. Attachments: max 10 per message, each needs a non-empty `url`, or the request returns `400`.

### Notification endpoints

All under `{baseUrl}/api/notifications`. Notifications are category-wise via `type`, carry a `priority`, and include `refId` + `refModel` for deep-linking on click.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/notifications` | List, paginated + filterable (`type`, `priority`, `read`, `page`, `limit`) |
| GET | `/notifications/unread-count` | Badge count |
| PUT | `/notifications/:id/read` | Mark one read |
| PUT | `/notifications/read-all` | Mark every unread notification read |
| DELETE | `/notifications/:id` | Delete one |

```json
// GET /notifications response
{
  "notifications": [{
    "_id": "66f0c1...", "type": "delivery", "priority": "high",
    "title": "Delivery delayed", "body": "DEL-2026-0043 rescheduled to tomorrow.",
    "refId": "66d2a1...", "refModel": "Delivery",
    "isRead": false, "createdAt": "2026-08-21T09:12:00.000Z"
  }],
  "total": 37,
  "stats": { "total": 37, "unread": 5, "highPriority": 2, "today": 3 },
  "page": 1, "limit": 20
}
```

`type` values: `task · delivery · drawing · payment · meeting · material_request · lead · quotation · invoice · freight_bid · chat · system · escalation · followup`
`priority` values: `high · medium · low`

`refModel` tells the frontend which screen to route to on tap — e.g. `"Delivery"` → delivery detail using `refId`, `"Task"` → task detail, `"Meeting"` → meeting detail.

**Note:** Notifications do not currently push over the socket — poll `/notifications/unread-count` or refetch on a relevant screen event.

### Attachment upload

```
POST /upload/presigned-url
```

```js
// 1. Request a signed URL
const { data } = await api.post("/upload/presigned-url", {
  fileName: "site-photo.jpg", fileType: "image/jpeg", folder: "chat-attachments",
});
const { uploadUrl, fileUrl } = data.data;

// 2. PUT the file directly to S3
await axios.put(uploadUrl, fileBuffer, { headers: { "Content-Type": "image/jpeg" } });

// 3. Send the message referencing fileUrl
await api.post(`/team-chat/direct/${userId}/messages`, {
  attachments: [{ url: fileUrl, name: "site-photo.jpg", type: "image/jpeg" }],
});
```

The socket/REST message events carry only the resulting file URL, never file bytes.

---

## 4. Rooms

A conversation only receives live events once the client explicitly joins its room with `join_team_channel`. Room names are derived server-side — the client never constructs them.

| Channel type | Room name | Who's in it |
|---|---|---|
| `direct` | `team_direct:{sortedUserIdA_userIdB}` | Both participants, once each has joined |
| `group` | `team_group:{groupId}` | Group members who have joined; membership is checked server-side on join |
| personal | `user:{userId}` | Auto-joined on connect — carries DM notices, group notices, and membership-change pushes regardless of which room is open |

The direct-room key is order-independent — joining from either user's socket lands in the same room.

On connect the server automatically:
- Joins the socket to `user:{userId}` (personal room)
- Joins `admin_room` additionally if the connecting user's role is `admin`

---

## 5. Socket Events — Client → Server

### `join_team_channel`
Joins the room for a direct or group conversation. Call this when a chat screen opens.

```js
socket.emit("join_team_channel", {
  channelType: "direct",  // "direct" | "group" — nothing else
  channelId:   "66f0c1...",  // the other user's Mongo _id, or the group's Mongo _id
});
```

For `group`, the server verifies `channelId` is a valid ObjectId and that the connecting user is still a member before allowing the join. Either check failing is a silent no-op — no event comes back.

### `leave_team_channel`
Leaves a room. Call this when a chat screen closes. Same payload shape as `join_team_channel`.

### `team_typing_start` / `team_typing_stop`
Broadcasts a typing indicator to everyone else in the room (sender doesn't get their own event back).

```js
socket.emit("team_typing_start", { channelType: "group", channelId: groupId });
// other members receive → "team_typing" { isTyping: true, name: "Aisha Khan" }
```

### `team_message`
Sends a message into a direct or group conversation. Text, attachments, or both — at least one required.

```js
socket.emit("team_message", {
  channelType:  "direct",          // "direct" | "group"
  channelId:    "66f0c1...",
  content:      "Delivery is staged, dispatching at 3pm.",
  attachments:  [                        // optional, max 10
    { url: "https://…s3…/chat-attachments/photo.jpg", name: "site-photo.jpg", type: "image/jpeg" }
  ],
});
```

Upload attachments first via `POST /api/upload/presigned-url` → PUT to S3 → reference `fileUrl` here.

An invalid `channelId` or a group you're not a member of on this event **does** emit `team_chat_error` back to you — listen for it, don't retry blindly.

---

## 6. Socket Events — Server → Client

Bind these once per socket connection, not per room — the payload tells you which conversation each event belongs to.

### `new_team_message`
Fires to everyone in the room whenever a message is created — whether via socket or REST. Single source of truth for rendering new messages.

```js
socket.on("new_team_message", (message) => {
  // {
  //   _id, channelType, groupId, directKey, participants,
  //   senderId, senderName, senderRole,
  //   content, attachments, readBy,
  //   createdAt, updatedAt
  // }
});
```

### `new_team_dm_notice`
Delivered to the recipient's personal room (`user:{id}`) on every direct message — fires even if they haven't joined that direct room yet. Right hook for a global "new DM" badge/toast.

```js
socket.on("new_team_dm_notice", ({ fromUserId, fromName, content }) => { /* … */ });
```

### `new_team_group_message_notice`
Same idea, for group messages — delivered to every other member's personal room regardless of whether they have the group open.

```js
socket.on("new_team_group_message_notice", ({ groupId, fromName, content }) => { /* … */ });
```

### `team_messages_read`
Fires to the room when a participant fetches messages via REST — server marks everything unread-by-them as read and broadcasts this so the sender's UI can flip single-tick to double-tick in real time.

```js
socket.on("team_messages_read", ({ by, channelType, channelId }) => { /* … */ });
```

### `group_members_updated`
Broadcast to the group's room whenever an admin adds/removes members via `PUT /team-chat/groups/:groupId/members`. A just-removed member has left the room server-side and won't receive this — handle their case via a 403 on their next action, or a REST re-check.

```js
socket.on("group_members_updated", ({ groupId, members }) => { /* members: full populated array */ });
```

### `new_team_group`
Sent to a user's personal room when they're added to a group — at creation or via a later member update. Use it to insert the new group into the conversation list without a refetch.

```js
socket.on("new_team_group", ({ group }) => { /* full group document */ });
```

### `team_chat_error`
Fires back to the sending socket only, when a `team_message` emit fails server-side (e.g. sender is no longer a group member, or `channelId` is invalid).

```js
socket.on("team_chat_error", ({ message }) => {
  // e.g. "Invalid group id" / "Not a member of this group"
  // show this to the user, don't retry the same payload blindly
});
```

---

## 7. REST vs. Socket writes

Both paths write the same document and trigger the same `new_team_message` broadcast — pick based on what the moment needs.

| | REST | Socket |
|---|---|---|
| Endpoint/event | `POST /team-chat/direct/:userId/messages` | `team_message` |
| Best for | First send in a session, attachment-heavy sends, anywhere you want an HTTP response with the saved message | Fast follow-up sends once socket is open and room already joined |
| Delivery to others | Broadcast over socket after saving | Broadcast over socket immediately after saving |
| Validation | 400 JSON error body | `team_chat_error` event back to sender |

---

## 8. End-to-end flow — opening a group chat

1. **Connect once** — open the socket on app load/login, authenticated with the current access token. Keep it alive across screens.
2. **Load history** — `GET /api/team-chat/groups/:groupId/messages` — this also marks unread messages as read and triggers `team_messages_read` to the room.
3. **Join the room** — `socket.emit("join_team_channel", { channelType: "group", channelId })` — do this on screen focus.
4. **Listen** — bind `new_team_message`, `team_typing`, and `group_members_updated` for this session.
5. **Send** — `socket.emit("team_message", …)` for quick sends, or the REST endpoint when attaching files.
6. **Leave on unmount** — `socket.emit("leave_team_channel", …)` when the screen closes — the socket itself stays connected for other rooms and DM notices.

---

## 9. Error Handling

- **Connection refused** — `connect_error` fires with `"Authentication required"` (no token) or `"Invalid token"` (expired/malformed). Refresh the access token and reconnect; do not retry with the same token.
- **Silent no-op on join** — joining a group room you're not a member of (or with an invalid `channelId`) does nothing and emits nothing back. If a client expects to be in a group but never receives room traffic, re-fetch `GET /team-chat/groups/:groupId` to confirm membership rather than assuming a dropped connection.
- **Message rejected** — `team_chat_error` arrives only on the sending socket, never broadcast. Typical causes: sender was removed from the group between opening the screen and sending, or `channelId` isn't a valid ObjectId.

All of the above has been exercised against live socket connections between multiple concurrent users — direct and group sends, read receipts, and membership-change broadcasts — verified working before this was written up.
