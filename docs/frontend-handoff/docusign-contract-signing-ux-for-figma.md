# DocuSign contract signing — UX guide for Figma / product design

**Audience:** Figma designer, product, frontend  
**Purpose:** Explain how DocuSign works in plain language so screens, states, and empty/error cases can be designed correctly.  
**Status:** Product design brief (backend integration planned; not every API is live yet)  
**Date:** 9 Nov 2026  

---

## 1. What DocuSign is (in one minute)

DocuSign is a **third-party e-signature service**. We do **not** draw signature pads ourselves for the legal contract.

| Our app does | DocuSign does |
|--------------|---------------|
| Decide **when** a contract can be sent | Host the **signing experience** (email link or embedded iframe) |
| Show **status** in Sales / Admin / Customer / Account | Collect signatures, timestamps, audit trail |
| Store the **final signed PDF** on the project | Keep legal proof of who signed what, when |

Think of DocuSign like Stripe for payments: we trigger “send for signature,” then we react when DocuSign says “completed” or “declined.”

---

## 2. What document is being signed?

In this product the document is the **Fabrication & Supply Agreement** (the **contract** section of the quote pack), not the quote price sheet alone.

Today (without DocuSign):

1. Sales generates / previews contract HTML from the estimate.
2. Someone gets a wet-ink or offline signature.
3. Staff **manually uploads** a “Signed contract.pdf” onto the lead.
4. Account / project detail shows **Agreement → signed** with a file link.

With DocuSign, steps 2–3 become: **Send → Customer signs in DocuSign → we auto-attach the signed PDF** to the same “agreement” place in the UI.

**Design implication:** Keep one clear place in the product called **Contract / Agreement**. Status should feel like the same object across Sales, Customer, and Account — only the *how it got signed* changes.

---

## 3. Roles (who sees what)

| Role | Typical need |
|------|----------------|
| **Sales** | Send contract for signature, remind, void, see status, open signed PDF |
| **Admin** | Same oversight as Sales (or read-only + intervene) |
| **Customer** (portal / email) | Get notified, open DocuSign, sign, download copy |
| **Account** | See “Signed” + document for project financials (usually not send envelopes) |
| **Plant / Construction** | Usually **no** DocuSign actions — may only see that agreement exists |

Primary UX work: **Sales** send/status flows + **Customer** “sign your contract” entry points.

---

## 4. Two signing UX patterns (pick one primary for Figma)

DocuSign supports both. Product should choose a **default**; design can show the other as a secondary path later.

### A) Email signing (simplest — recommended v1)

1. Sales clicks **Send for signature**.
2. Customer receives **email from DocuSign** (branded by DocuSign; we can pass subject / message).
3. Customer clicks **Review Document** → DocuSign website → signs.
4. Our app updates status via webhook; Sales sees **Completed**.

**Figma:** Sales screens only need a “Sent” confirmation + status badge. No in-app signature canvas.

### B) Embedded signing (in our Customer portal)

1. Sales sends (or Customer opens portal).
2. Customer taps **Sign contract** inside our app.
3. We open DocuSign **inside an iframe / webview** (or redirect to DocuSign and return).
4. After sign, return user to our success screen.

**Figma:** Need portal screens: “Ready to sign,” loading DocuSign, success, decline, error (session expired).

**Recommendation for first Figma pass:** Design **email signing as primary**, and a light **Customer portal status** card (“Awaiting your signature — check email” / “Signed”). Add embedded signing screens as a Phase 2 frame if needed.

---

## 5. Happy path (storyboard)

Use this as the main flow board.

```text
[Quote finalized / contract ready]
        ↓
[Sales: Review contract PDF/preview]
        ↓
[Sales: Send for signature]
   • To: customer email (editable)
   • Optional: CC / company signer
   • Optional: message to customer
        ↓
[Status: Sent]  →  Customer gets DocuSign email
        ↓
[Status: Delivered / Viewed]  (optional intermediate)
        ↓
[Customer signs in DocuSign]
        ↓
[Status: Completed]
   • Signed PDF stored on project (Agreement)
   • Sales + Account show “Signed” + download
```

Optional later:

```text
Customer signs → Steel countersigns (second signer) → Completed
```

If product wants **dual signature**, design a status like **Partially signed (waiting for Steel)** between customer sign and fully complete.

---

## 6. Status vocabulary (use consistently in UI)

Map these badges across Sales list, project detail, and Customer portal. Prefer short labels.

| Internal / DocuSign idea | UI label (suggested) | Meaning for design |
|--------------------------|----------------------|--------------------|
| `not_sent` / none | **Not sent** | Contract exists; no envelope yet |
| `created` / draft | **Draft** | Rare in UI; usually skip |
| `sent` | **Sent** | Envelope emailed; not opened yet |
| `delivered` | **Delivered** | Email accepted by server (optional to show) |
| `viewed` / `delivered` | **Opened** | Customer opened DocuSign (if we get this event) |
| `completed` | **Signed** / **Completed** | Fully signed; PDF available |
| `declined` | **Declined** | Customer refused; needs redesign / re-send |
| `voided` | **Voided** | Sales cancelled the request |
| `expired` | **Expired** | Signing window ended; re-send |

**Account panel** can stay binary for v1: **Unsigned** vs **Signed** (only flip to Signed on `completed`).

**Color guidance (align with existing admin/sales badges):**

- Neutral gray — Not sent  
- Blue — Sent / Opened  
- Green — Signed / Completed  
- Red / coral — Declined / Voided / Expired  
- Amber — Waiting (partially signed, if dual sign)

---

## 7. Screens to design (checklist)

### Sales — Project / Quote area

1. **Contract card (before send)**  
   - Preview / download draft contract  
   - Primary CTA: **Send for signature**  
   - Disabled + helper if quote/estimate not ready (e.g. still draft)

2. **Send for signature modal**  
   - Signer name + email (prefill from customer)  
   - Optional message  
   - Confirm button: **Send with DocuSign**  
   - Microcopy: “Customer will receive an email from DocuSign to review and sign.”

3. **Contract card (after send)**  
   - Status badge  
   - Sent date / last updated  
   - Actions: **Remind**, **Void**, **Resend**, **View in DocuSign** (optional), **Download signed PDF** (only when completed)

4. **Empty / error**  
   - Send failed (invalid email)  
   - DocuSign unavailable  
   - Already signed (don’t allow second send without void)

### Customer portal (web / app)

5. **Contract status strip**  
   - “Action needed: Sign your contract” (when sent)  
   - “We’re waiting for DocuSign email” + resend request?  
   - “Contract signed” + download  

6. **If embedded (Phase 2)**  
   - Full-screen / modal host for DocuSign  
   - Success / decline return pages  

### Account / Admin project detail

7. **Agreement block** (already in product language)  
   - Signed: document name, signed on date, download  
   - Not signed: “Awaiting signature” or “Not uploaded”  
   - After DocuSign: same block, source can be DocuSign instead of manual upload  

### Emails (optional Figma frames — content only)

8. **Our notification** (optional): “We’ve sent your contract via DocuSign”  
9. **DocuSign’s email** is mostly controlled by DocuSign — design a **note**, not a full branded email mock, unless marketing owns DocuSign branding settings.

---

## 8. What the designer should *not* invent

Avoid designing:

- A custom in-app signature pad that “looks like” DocuSign (legal/compliance risk; duplicate UX)  
- Editing the contract text *inside* DocuSign as a free-form Word editor (DocuSign signs a **fixed PDF** we generate)  
- Real-time “cursor watching the customer type” — we only get status events  
- Assuming instant sync — show a short **“Updating…”** / refresh after send; status may lag a few seconds after signing until webhook lands  

---

## 9. Edge cases (design states)

| Case | Suggested UX |
|------|----------------|
| Customer **declines** | Red status + reason (if available) + Sales CTA **Revise & send again** |
| Sales **voids** | Status Voided; CTA **Send new envelope** |
| Envelope **expires** | Expired + **Resend** |
| Wrong email | Allow edit email on Resend; don’t silently keep bad address |
| Customer already signed | Hide Send; show Download only |
| Manual upload still exists | Temporary: “Upload signed PDF” as fallback for edge cases; mark as legacy so Figma doesn’t treat it as the primary path |
| Dual signers | Progress: 1 of 2 signed |

---

## 10. Content & copy snippets (starter)

**Send modal title:** Send contract for signature  

**Body:** We’ll email the Fabrication & Supply Agreement through DocuSign. The customer signs electronically; you’ll see status update here when it’s done.

**Primary button:** Send for signature  

**Sent toast:** Contract sent via DocuSign  

**Customer portal (awaiting):** Your contract is ready to sign. Check your email for a message from DocuSign, or open the signing link below.

**Completed:** Contract signed. Download your copy anytime from this project.

---

## 11. Data the UI will eventually show (for component props)

Design components around these fields (names may match API later):

| Field | Example |
|-------|---------|
| `status` | `sent` / `completed` / … |
| `statusLabel` | `Sent` |
| `signerName` | `Jane Customer` |
| `signerEmail` | `jane@example.com` |
| `sentAt` | ISO date |
| `completedAt` | ISO date |
| `documentName` | `Fabrication & Supply Agreement` |
| `signedPdfUrl` | download when completed |
| `canSend` / `canRemind` / `canVoid` | drive button enablement |

---

## 12. Suggested Figma page structure

1. **Overview** — this doc’s happy path as a flowchart  
2. **Sales — Contract card** — all statuses as variants of one component  
3. **Sales — Send modal**  
4. **Customer — Contract status**  
5. **Account — Agreement** (signed / awaiting)  
6. **Edge cases** — declined, voided, expired, error  
7. **(Optional) Embedded signing** — Phase 2  

Use **component variants** for status badges so Sales list + detail stay consistent.

---

## 13. Out of scope for v1 UX (call out on Figma)

- Bulk send contracts for many projects at once  
- In-person “DocuSign on an iPad at the office” (same product statuses, different entry)  
- Customer editing contract clauses during signing  
- Replacing quote preview / COG quote PDF with DocuSign (only the **agreement** signing step)

---

## 14. How this ties to existing product language

| Existing UI language | After DocuSign |
|----------------------|----------------|
| Signed contract / Agreement | Same label — prefer **Contract** or **Agreement** everywhere |
| Manual “Upload signed agreement” | Becomes secondary / fallback |
| Quote sections: quote, SOW, **contract**, drawings | **Contract** section is what gets signed |
| Estimate `final` / “client contract issued” | Natural gate for enabling **Send for signature** |

---

## 15. Open product decisions (mark as sticky notes on Figma)

Designers / PM should confirm:

1. **Email signing only** vs **embedded in customer portal** for v1?  
2. **Customer only** vs **Customer + Steel countersign**?  
3. Can Sales send before deposit / only after estimate is final?  
4. Keep **manual upload** forever as fallback?  
5. Should Customer portal show a big CTA when status is `sent`, or only email?

---

## 16. One-line summary for the designer

> **We send a fixed contract PDF through DocuSign; the customer signs on DocuSign (usually via email); our app only shows status and then stores the signed PDF on the project like today’s Agreement block.**

Questions on API fields or exact button enablement can go to backend/FE after status vocabulary is locked in Figma.
