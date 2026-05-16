# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start with nodemon (development)
npm start         # Production server
npm run seed      # Seed first admin user + RoundRobinTracker (run once on fresh DB)
npm run create-user  # Create additional users (admin, sales, etc.)
```

No lint or test commands exist in this project.

## Architecture

Node.js + Express 5 backend for a construction/storage business with AI-powered sales automation.

**Stack:** MongoDB/Mongoose 8, Socket.io 4, Anthropic Codex (Codex-sonnet-4-20250514), JWT auth, AWS S3, Nodemailer.

**Entry points:**
- [server.js](server.js) — HTTP + Socket.io bootstrap
- [app.js](app.js) — Express middleware and route mounting

**Source layout:**

| Directory | Purpose |
|---|---|
| `src/config/` | `env.js` (validates + exports all env vars), `db.js`, `constants.js` (roles, lead stages, audit action strings) |
| `src/models/` | 14 Mongoose schemas |
| `src/routes/` | Organized by role: `auth`, `public`, `admin/*`, `sales/*`, `common/*` |
| `src/controllers/` | Business logic matching route groups |
| `src/middleware/` | `verifyToken`, `roleGuard`, error handler, validation |
| `src/services/` | AI chat, Socket.io handlers, email, audit logging, round-robin assignment |
| `src/utils/` | ID generation, API response helpers, date ranges |

## Authentication

JWT access + refresh tokens. `verifyToken` middleware attaches `req.user = { _id, email, role, name }`. `roleGuard(allowedRoles)` follows for protected routes. No server-side token blacklist — logout is client-side only.

## API Route Map

| Prefix | Auth | Roles |
|---|---|---|
| `/api/auth` | None | Login, refresh, logout, change password |
| `/api/public` | None | Chat init, chat history |
| `/api/admin/*` | JWT | admin |
| `/api/sales/*` | JWT | sales |
| `/api/quotations/*`, `/api/invoices/*`, `/api/payment-schedules/*`, `/api/upload/*` | JWT | admin, sales |

## Core Chat Flow

1. Customer POSTs `/api/public/chat/init` → creates Customer + Lead documents, returns `customerId` + `leadId`
2. Customer connects to Socket.io `/chat` namespace, emits `customer_message`
3. Codex AI responds and scores the lead (5-item breakdown stored on Lead)
4. When AI outputs `QUOTE_DATA:{...}` in its response:
   - Draft Quotation created, `lead.isQuoteReady = true`
   - Round-robin assigns an active sales employee
   - Customer notified via socket they're connected to a sales rep
   - Subsequent messages route to assigned sales employee
5. Admin/sales staff monitor via `/admin` Socket.io namespace (JWT required in `handshake.auth.token`)

## Socket.io Namespaces

| Namespace | Auth | Purpose |
|---|---|---|
| `/chat` | None | Customer ↔ AI/sales |
| `/admin` | JWT | Internal staff monitoring, notifications |

## Key Design Decisions

- **Context trimming:** Codex context trimmed by character limits — all limits configurable via env vars (set to 0 for full history in dev). See `src/services/ai/chat.service.js`.
- **No job queues:** AI scoring runs as fire-and-forget. Retriggers on next message if server crashes mid-job.
- **Round-robin edge case:** If no active sales employees exist, admin is notified via socket and must manually assign.
- **Overdue follow-ups:** Computed at query time (`followUpDate < now AND status = pending`), not stored as status.
- **AuditLog:** Insert-only. All action strings must come from `src/config/constants.js`.
- **Returning customer:** Any Customer with more than one Lead document.

## Environment Setup

Copy `.env.example` to `.env`. Required vars: `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ANTHROPIC_API_KEY`, AWS S3 credentials, SMTP credentials. All parsed and validated in `src/config/env.js` at startup.

Default seed admin: `admin@construction.com` / `Admin@123` (overridable via env vars).


<claude-mem-context>
# Memory Context

# [Mr_Storage_Backend] recent context, 2026-05-16 2:13am GMT+5:30

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,559t read) | 435,768t work | 95% savings

### May 14, 2026
S87 Caveman-style sales module backend implementation — Part 2 of multi-part feature build for Mr_Storage_Backend (May 14 at 3:38 PM)
S88 API Plan vs. Implementation Progress Audit — Mr_Storage_Backend (admin_panel_sales_panel_v2.md) (May 14 at 5:07 PM)
S107 Admin Panel Sales Panel v2 — Daily progress update for Part 2 API implementation across Leads, Follow-ups, Quotations, PO Orders, and Customers modules (May 14 at 6:26 PM)
### May 15, 2026
S108 Audit Mr_Storage_Backend Postman collection against newly implemented APIs to identify missing/outdated endpoints (May 15 at 2:06 AM)
S109 Reconcile all APIs from admin_panel_sales_panel_v2.md into the Postman collection (postman_collection.json) for Mr_Storage_Backend, and implement any missing backend endpoints (May 15 at 2:37 AM)
S110 Admin Panel Sales Panel V2 API audit — verify all APIs from plan doc exist, are implemented, and are in Postman collection (May 15 at 3:02 AM)
939 1:44p 🔵 Controller Export Audit Across Sales, Admin, and Common Modules
940 1:45p 🔵 Sales Router Architecture: Top-Level Routes for Quotations and PO Orders
941 " 🔵 Upload, Invoice, Payment, and Quotation Endpoints Verified in Postman Collection
942 1:46p 🔵 Postman Collection Contains 148 Requests Across 31 Organized Folders
943 1:47p 🔵 Final API Audit: 97.7% Plan Completion, Two Gaps Identified
944 " 🟣 Agreement Upload Endpoint Identified as Missing Implementation
945 " 🔵 Upload Controller Implementation Details and Common Route Guard Structure
946 1:48p 🔵 Lead Model Has 'contract' Document Type — Agreement Upload Requires No Schema Change
947 " 🟣 Agreement Upload Endpoint Implemented — Critical Audit Gap Resolved
948 " 🔴 Postman "Import Leads (CSV)" Entry Has Wrong URL — Points to Create Lead Instead of Import
S118 Investigate and explain the full lead onboarding, stage progression, and salesperson assignment flow in Mr_Storage_Backend, including how to manually add and advance a lead. (May 15 at 1:49 PM)
988 6:43p 🔵 Confirmed `/api/sales/leads/stats` Endpoint in Postman Collection
989 " 🔵 Postman "Lead Stats" Entry: Exact Name, Method, Auth, and Adjacent Endpoints
1005 8:23p 🔵 Frontend "New Project" Page Maps to `/leads` API Endpoint
1006 " 🔵 Admin `POST /customers/:customerId/leads` — Full Field Contract Confirmed
1007 " 🔵 Two Parallel "Create Project" Routes: Admin vs Sales — Field Requirements Differ
1008 8:24p 🔵 Lead Detail Response Diverges Between Admin and Sales — Admin Gets More Fields
1009 8:25p 🔵 Customer Onboarding Entry Point via Public Chat Route
1010 " 🔵 Full Chatbot Onboarding Flow: `chatInit` Controller Deep Dive
1011 8:26p 🔵 Admin Customer Management: Manual Onboarding vs Chatbot Onboarding Comparison
1012 8:28p 🔵 Socket.IO Chat Architecture: AI-Driven Onboarding Pipeline with Auto Quote Detection and Round-Robin Sales Assignment
1013 8:29p 🔵 AI Silence Gate: `isHandedToSales` Flag Stops AI Responses After Sales Handoff
1014 " 🔵 Customer Auth: JWT + OTP Password Reset with MASTER_OTP Bypass
1015 " 🔵 Customer Portal Routes: Self-Service Project Creation and Document/Payment Access
1016 8:32p 🔵 Postman Collection Reveals Full API Surface and Domain Model ("Construction AI")
1017 " 🔵 Customer Portal: Phone Number as Initial Password Confirmed in Postman Examples
1018 8:34p 🔵 Package Stack: Express 5, Mongoose 8, Anthropic SDK 0.39, AWS S3 SDK v3
1019 " 🔵 Runtime Environment: Node.js v24.12.0; Only AGENTS.md Modified in Working Tree
### May 16, 2026
1036 12:54a 🔵 Chatbot Handles Lead Progression Through Stages 0–3
1037 " 🔵 Lead Lifecycle Uses Named String Stages, Not Numeric Indexes
1038 " 🔵 Chatbot Owns Leads Until isHandedToSales Flag; Sales Handoff via Round-Robin Service
1039 12:55a 🔵 AI Scoring Service Advances Lead Lifecycle Stages with Advance-Only Guard
1040 " 🔵 Claude Chat Service Uses QUOTE_DATA Marker Protocol to Embed Structured JSON in Responses
1041 " 🔵 Sales Rep Can Freely Update lifecycleStatus; No Advance-Only Guard in Sales Controller
1042 12:56a 🔵 Lead Mongoose Schema — Complete Field Map Including AI and State Flag Fields
1043 " 🔵 Mr_Storage_Backend Lead Onboarding Entry Points via Public Routes
1044 " 🔵 Lead Onboarding Flow: chatInit Controller Logic in Mr_Storage_Backend
1045 " 🔵 Round-Robin Salesperson Auto-Assignment Service
1046 " 🔵 AI Chat Service Extracts QUOTE_DATA from Claude Response to Trigger Sales Handoff
1047 12:57a 🔵 Complete Lead Lifecycle Stages and Stage Progression Rules in Mr_Storage_Backend
1048 " 🔵 Chat Socket Handler Triggers Sales Handoff When AI Returns QUOTE_DATA
S119 Understand lead onboarding, stage progression, and salesperson assignment in Mr_Storage_Backend; create a way to manually test the full flow end-to-end. (May 16 at 12:57 AM)
1049 12:59a 🔵 Complete Socket.IO customer_message Handler: 10-Step Pipeline with Post-Handoff AI Silence
1050 " 🔵 Socket.IO Namespace Architecture: /chat (Public) and /admin (Authenticated)
1051 1:00a 🟣 Created test-chat.html: Browser-Based Lead Onboarding and Chat Pipeline Tester
S120 Provide a step-by-step test script with exact chat messages to trigger the full lead pipeline: onboarding → stage progression → QUOTE_DATA → sales handoff. (May 16 at 1:01 AM)
S121 How lead onboarding, stage progression, and sales assignment works in Mr_Storage_Backend — and how to manually add a lead and move it through stages (May 16 at 1:04 AM)
1052 1:27a 🔵 Sales API — Leads Endpoints Documented in Postman Collection
1053 1:47a 🔵 Mr_Storage_Backend Sales Leads API Endpoints in Postman Collection
1054 1:56a 🔵 Lead Detail API Response Structure — Steel Warehouse CRM
1055 2:00a 🔵 Customer Response Missing `company` and `location` Fields vs API Spec
1056 " 🔵 Root Cause Found: `company` and `location` Fields Not Defined in Customer Schema
1057 " 🔵 Controller Already Selects `company` and `location` — Schema Is the Only Missing Piece
1058 2:01a 🔵 Admin `getLeadDetail` Fetches Full Customer Document with `.lean()` — Bypasses `toJSON` Password Strip

Access 436k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>