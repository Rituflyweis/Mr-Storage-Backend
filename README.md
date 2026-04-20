# Construction AI Backend

Node.js + Express + Socket.io + MongoDB + Claude AI sales automation backend.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Express 5 |
| Database | MongoDB + Mongoose 8 |
| Realtime | Socket.io 4 |
| AI | Anthropic Claude (claude-sonnet-4-20250514) |
| Email | Nodemailer |
| File uploads | AWS S3 presigned URLs |
| Auth | JWT (access + refresh) |

---

## Setup

### 1. Install
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env and fill in all values
```

Required values:
- `MONGO_URI` — MongoDB connection string
- `JWT_ACCESS_SECRET` — random secret (32+ chars)
- `JWT_REFRESH_SECRET` — different random secret (32+ chars)
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- SMTP credentials (Nodemailer)
- AWS credentials + S3 bucket (file uploads)

### 3. Seed the database (creates first admin + initialises round-robin tracker)
```bash
npm run seed
```

Default admin credentials: `admin@construction.com` / `Admin@123`

Override with env vars:
```bash
SEED_EMAIL=you@company.com SEED_PASS=yourpass SEED_NAME="Your Name" npm run seed
```

### 4. Create additional users
```bash
node scripts/createUser.js "Sales Rep Name" sales@company.com password123 sales
node scripts/createUser.js "Another Admin" admin2@company.com password123 admin
```

### 5. Run
```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

---

## API Overview

Base URL: `http://localhost:5001`

### Auth — `/api/auth`
| Method | Path | Description |
|---|---|---|
| POST | `/login` | Login (all roles) |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Logout |
| PUT | `/change-password` | Change password |

### Public — `/api/public` (no auth)
| Method | Path | Description |
|---|---|---|
| POST | `/chat/init` | Start customer chat — creates customer + lead |
| GET | `/chat/history/:leadId` | Load chat history |

### Admin — `/api/admin/*` (role: admin)
| Group | Endpoints |
|---|---|
| Dashboard | 3 stats endpoints |
| Customers | List, detail, project detail |
| Leads | Stats, list, create, import CSV, edit, assign, detail, timeline, AI scoring |
| Meetings | List, create, edit, complete |
| Follow-ups | Stats, upcoming, create, KPI, AI script generator |
| Employees | Stats, performance, list, create, detail, edit |
| Escalations | List, assign/resolve |
| PO Orders | List, approve/reject |

### Sales — `/api/sales/*` (role: sales)
| Group | Endpoints |
|---|---|
| Dashboard | Lead stats, customer stats |
| Leads | List, detail, update lifecycle, escalate, raise PO |
| Follow-ups | Stats, upcoming, create, complete, KPI |
| Projects | Closed leads |
| PO Orders | My PO orders |

### Common — `/api/*` (role: admin or sales)
| Group | Endpoints |
|---|---|
| Quotations | Create, get, edit, send, AI summary |
| Invoices | Create, get, edit, send, **mark as paid** |
| Payment Schedules | Create, get, mark payment paid |
| Uploads | S3 presigned URL, add/remove document on lead |

All list endpoints accept `?startDate=&endDate=` for date range filtering.

---

## Socket.io

### Namespace `/chat` — customer-facing (no auth)

| Event | Direction | Description |
|---|---|---|
| `join_lead` | client→server | Join lead room |
| `customer_message` | client→server | Send message → triggers Claude AI |
| `typing_start` / `typing_stop` | client→server | Typing indicator |
| `new_message` | server→client | New message (AI or sales) |
| `ai_typing` | server→client | AI is processing |
| `customer_typing` | server→client | Customer typing indicator |
| `lead_handed_to_sales` | server→client | AI→sales handoff |

### Namespace `/admin` — admin + sales (JWT in handshake.auth.token)

| Event | Direction | Description |
|---|---|---|
| `join_lead_chat` | client→server | Join a lead's chat room |
| `sales_message` | client→server | Sales sends message to customer |
| `mark_messages_read` | client→server | Mark customer messages as read |
| `sales_typing_start` / `sales_typing_stop` | client→server | Sales typing indicator |
| `new_message` | server→client | New message in a lead |
| `lead_assigned` | server→client | Lead assigned to this sales user |
| `lead_score_updated` | server→client | AI scored a lead |
| `lead_quote_ready` | server→client | AI detected quote data |
| `new_lead` | server→client | New customer started chat |
| `new_escalation` | server→client | Sales escalated a lead |
| `new_po_order` | server→client | Sales raised a PO order |
| `lead_no_sales_available` | server→client | No active sales for round-robin |

---

## Chat Flow

```
Customer visits landing page
  → POST /api/public/chat/init   (collect name, email, phone)
  → Returns { customerId, leadId }
  → Customer connects to socket /chat
  → Emits join_lead { leadId, customerId }
  → Customer sends messages via customer_message socket event
  → Claude AI responds (fire-and-forget: score update + rolling summary)
  → When Claude outputs QUOTE_DATA:{...}:
      → Draft Quotation created (AI-generated)
      → Lead marked isQuoteReady=true
      → Round-robin assigns sales employee
      → Customer notified: "connected to [Sales Name]"
      → Sales employee gets lead_assigned socket event
  → All subsequent messages route to the assigned sales employee
```

---

## Key Design Decisions

- **Quote ready trigger**: Claude outputs `QUOTE_DATA:{...}` in its response text. No checklist needed — AI decides when it has enough info.
- **No Redis**: Refresh tokens are client-side only. Logout just clears client storage. Add Redis + blacklist before production if needed.
- **No job queues**: AI scoring and context summary updates run as fire-and-forget promises. If server crashes mid-job, the next message re-triggers them.
- **Overdue follow-ups**: Not stored as a status. Computed at query time: `followUpDate < now AND status = pending`.
- **Returning customer**: Any customer with more than 1 Lead document.
- **Round-robin edge case**: If no active sales employees exist, admin is notified via socket and must manually assign.
- **AuditLog**: Insert-only. Never updated. All canonical action strings in `src/config/constants.js`.

---

## Environment Variables Reference

```
PORT=5001
NODE_ENV=development
MONGO_URI=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
ANTHROPIC_API_KEY=
CLAUDE_MAX_PRIOR_CONTEXT_CHARS=45000
CLAUDE_MAX_LIVE_CONTEXT_CHARS=28000
CLAUDE_CONTEXT_SUMMARY_MAX_CHARS=2200
CLAUDE_LIVE_VERBATIM_TURNS=12
CLAUDE_MAX_SCORE_PRIOR_CHARS=22000
CLAUDE_MAX_SCORE_LIVE_CHARS=18000
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
AWS_S3_PRESIGNED_URL_EXPIRES=300
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
CLIENT_URL=http://localhost:3000
```

Set all `CLAUDE_*` vars to `0` to disable context trimming during development (full message history, may hit token limits).
