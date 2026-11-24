# Plan — Custom Quote: same edit + approval flow as PEMB/Storage quotes

**Audience:** Product (Flyweis), Figma, Frontend (Ahmadullah), Backend  
**Date:** 2026-10-31 (updated after FE review)  
**Ask:** Custom quote today is **calculate → save → PDF only**. It must use the **same platform screens and workflow** as shipper-based quotes: **edit on platform → submit for admin approval → send to customer** — not a broken/dead link with a one-off UI.

### FE review (Ahmadullah) — answers

| Question | Answer |
|----------|--------|
| **Integrate smoothly with the rest?** | **Yes** for approval, admin queue, send-to-client, status chips, and quotation detail — **reuse existing routes/components** after `POST /quotations/from-custom-quote/:id`. No parallel approval UI. |
| **What needs a different edit flow?** | **Only the first editor** (manual cost/margin form). After conversion, **quotation edit rules** are the same (version bump → re-pending). While still a draft **custom quote**, edit via `PUT /custom-quotes/:id` (same pattern as estimate draft `PUT`). |
| **Lead selection?** | **Same as PEMB:** pick lead **before or when saving**; **required before** Send for Approval / convert. See **§ Lead selection** below. |

---

## Lead selection (same pattern as estimate / quotation)

Custom quote must behave like shipper quotes for CRM linkage — not a separate lead UX.

| Step | UI (match existing quoting) | API |
|------|------------------------------|-----|
| Open from Sales panel | Lead list / search → **“Custom quote”** on lead row (next to PEMB quote) | Pre-fill `leadId`; `GET /api/sales/leads/:leadId` for customer name/location |
| Open from global Custom Quote menu | **Lead picker modal** (required before Save or show banner until set) | `POST /custom-quotes` body `{ leadId, customer, … }` — customer/location can pre-fill from lead |
| Change lead on draft | Same control as estimate (dropdown / change lead) | `PUT /custom-quotes/:id` `{ leadId }` |
| Submit for approval | Block if `!leadId` — same copy as estimate conversion | `POST /quotations/from-custom-quote/:id` body `{ leadId? }` fallback if only stored on doc |
| Access control | Sales: lead must be **assigned** to user (same as `checkLeadAccess` on estimates) | Backend enforces on create/update/convert |

**Figma:** Copy the **lead header strip** from PEMB quote (company, job #, address) onto custom quote editor; do not invent a new lead widget.

**Optional v1 shortcut:** Deep link `?leadId=` from lead detail — same as estimate entry.

---

## Edit flow — what changes vs what stays the same

```text
                    PEMB / Storage              Custom quote
                    ─────────────              ─────────────
Draft editing       Estimate editor            Custom quote editor ONLY
                    (shipper, pricing)         (mat/freight/labor/margin)
Document preview    POST …/estimates/…/preview POST …/custom-quotes/:id/pdf
                    or estimateId preview      (or future preview HTML endpoint)
Convert             from-estimate              from-custom-quote (new)
After convert       Quotation screens          Same quotation screens (no fork)
Edit when pending   Quotation + estimate PUT   Custom PUT + quotation sync (backend)
Edit when approved  Auto re-pending            Same (via linked quotation)
Admin approve       Existing                   Existing
Send to client      Existing                   Existing
```

**FE work for “edit flow changes” (Ahmadullah):**

1. **Custom quote editor** — keep `#page-custom` fields; add **Save**, **Preview**, **Lead** strip, **View quotation** when converted.
2. **Do not rebuild** admin approval or send modals — navigate to `/quotations/:id` (or your existing path).
3. **Two edit surfaces after convert:**  
   - **Pricing/content** → back to custom quote editor (`sourceCustomQuoteId` on quotation response).  
   - **Approval metadata** → existing quotation detail (priority, notes) — unchanged.
4. **History row actions:** Edit draft → custom editor; Edit sent → quotation flow (same as estimate history).

---

## 1. Current state (as built)

| Capability | PEMB / Storage (`EstimateQuote`) | Custom Quote (`CustomQuote`) |
|------------|----------------------------------|------------------------------|
| Data model | `EstimateQuote` + optional `Quotation` | `CustomQuote` only |
| CRUD + list | `/api/sales/estimates/*` | `/api/sales/custom-quotes/*` |
| Document preview/PDF | Estimate document APIs + `Quotation` send payload | `POST …/custom-quotes/:id/pdf` only |
| Convert to `Quotation` | `POST /api/quotations/from-estimate/:estimateId` | **None** |
| Submit / approve / send | `/api/quotations/:id/submit-approval`, approve, send | **None** |
| History / conversion badge | Estimate history + `conversion` on GET estimate | List custom quotes only |
| Lead linkage | Required for approval path | Optional `leadId` on create |
| Re-edit after approval | Quotation version + auto re-pending (see delta doc) | N/A |

**Backend references:** `CustomQuote.js`, `customQuote.controller.js`, `custom-quote-api.md`  
**Approval references:** `quotation-approval-workflow-api-2026-09-02.md`, `estimate-to-quotation-conversion-api-2026-09-03.md`, `frontend-api-delta-2026-09-10-quotation-approval-versions.md`

**Product intent (from chat):** All **approval and editing screens** should match existing quote flows; Figma should be updated to show custom quote entering that same journey (not an isolated “generate & download” page).

---

## 2. Target experience (single journey)

```text
Lead (optional but required before approval)
        │
        ▼
Custom Quote editor (manual costs / margin / inclusions)
        │  POST custom-quotes/preview (live calc)
        │  POST custom-quotes (save draft)  OR  PUT …/:id
        ▼
“Create quotation” / auto on first Submit
        │  POST /api/quotations/from-custom-quote/:customQuoteId   ← NEW
        ▼
Same screens as today:
  • Sales: quotation detail, edit, Send for Approval
  • Admin: pending queue, approve / reject
  • Sales: Send to customer (after approved)
        ▼
Customer portal + email (existing quotation send)
```

**Rule:** After step “Create quotation”, **reuse 100% of existing quotation UI** — do not build a second approval UI for custom.

---

## 3. Figma updates (what to design)

Mirror **existing PEMB quote / quotation screens**; only the **entry editor** differs.

| # | Screen (reuse vs new) | Custom quote behavior |
|---|------------------------|------------------------|
| 1 | **New:** Custom quote editor | Manual fields (`customer`, costs, margin, inclusions/exclusions, SOW). Buttons: **Calculate**, **Save draft**, **Preview document**. |
| 2 | **Reuse:** Quote history / list | Add tab or filter **“Custom”** alongside PEMB/Storage; row opens custom editor or linked quotation. |
| 3 | **Reuse:** Document preview panel | Same layout as estimate preview (HTML sections); content from custom quote PDF/HTML generator until parity with quotation send payload. |
| 4 | **Reuse:** Send for Approval modal | Same copy, status chips (`not_submitted` → `pending_approval`). Requires **lead linked**. |
| 5 | **Reuse:** Admin approval inbox | Same row; badge **source: Custom** (optional column). |
| 6 | **Reuse:** Quotation detail / edit | **Primary:** “Edit custom quote” → custom editor (linked by `sourceCustomQuoteId`). Quotation form fields (non-pricing) stay on existing quotation screen. |
| 7 | **Reuse:** Send to customer | Unchanged; gated on `workflowStatus === approved`. |
| 8 | **Reuse:** Client rejected / re-submit | Same as delta doc (edit → auto pending). |

**Fix “link not working”:** Every list/history row must navigate with **`customQuoteId`** until converted, then **`quotationId`** (show conversion chip like estimate history).

**Reference API doc for fields:** `docs/frontend-handoff/custom-quote-api.md`  
**Reference approval UX:** `docs/frontend-handoff/quotation-send-for-approval-fe.md`

---

## 4. Backend plan (phased)

### Phase A — Bridge to `Quotation` (required for approval)

| Item | Detail |
|------|--------|
| Schema | Add `Quotation.sourceCustomQuoteId` (ObjectId, indexed). Keep `sourceEstimateId` null for custom-sourced quotes. |
| Optional | `CustomQuote.quotationId`, `CustomQuote.status`: `draft \| converted \| archived` |
| Endpoint | `POST /api/quotations/from-custom-quote/:customQuoteId` |
| Body | `{ leadId? }` — same lead resolution as estimate conversion |
| Mapping | `mapCustomQuoteToQuotationPayload()` — map `sell` → `finalPrice` / `basePrice`, costs → COGS fields, `customer`/`location`/`size`/`scope`, store HTML snapshot or `documentType: 'custom'` flag |
| Idempotent | If quotation already exists for `sourceCustomQuoteId`, return existing (like estimate) |
| Audit | `source: 'custom_quote_conversion'` |

### Phase B — Approval shortcuts (parity with estimate)

| Item | Detail |
|------|--------|
| Submit approval | Extend `POST …/submit-approval` shortcut: if id is `CustomQuote` _id, call from-custom-quote then submit (mirror estimate shortcut) |
| PDF/email | Ensure `mapQuotationToDocumentPayload` uses custom HTML generator when `sourceCustomQuoteId` set |
| Edit sync | On `PUT /custom-quotes/:id`, if linked quotation exists and quotation was approved/sent, apply same **version bump → pending_approval** rules as estimate edit (reuse quotation controller helpers) |

### Phase C — Polish

| Item | Detail |
|------|--------|
| GET custom quote | Include `conversion: { quotationId, quoteNumber, workflowStatus }` (mirror GET estimate) |
| Admin list | Filter quotations by source custom |
| Permissions | Sales sees own custom quotes; admin sees all |

**Out of scope (v1):** Merging custom quote into `EstimateQuote` shipper engine; milestones/deposit on custom (unless product asks — can add deposit terms on `CustomQuote` later).

---

## 5. Frontend plan (Ahmadullah)

### Phase 1 — Wire existing APIs

- Implement full CRUD from `custom-quote-api.md` (many builds only PDF today).
- Require **lead picker** before “Send for approval” (block with message if missing).

### Phase 2 — Join quotation workflow

After backend Phase A:

1. Save custom quote → **Convert** → `quotationId`.
2. Navigate to **existing quotation detail** route (same component as PEMB).
3. Wire **Send for Approval**, **Send to customer**, status pills from `workflowStatus`.

### Phase 3 — History & deep links

- Unified “Quotes” list: estimates + custom quotes + quotations (or tabs).
- Fix routes: `/sales/custom-quotes/:id/edit`, `/sales/quotations/:quotationId` with back-link to custom editor when `sourceCustomQuoteId` present.

### Phase 4 — Parity testing

Use same QA script as PEMB approval (see `quotation-approval-workflow-api-2026-09-02.md` checklist) on a custom quote path.

---

## 6. Suggested delivery order

| Order | Owner | Deliverable |
|-------|--------|-------------|
| 1 | Figma | Updated flows §3 (entry editor + reuse screens); share link with product |
| 2 | Backend | Phase A + B (`from-custom-quote`, submit shortcut, conversion meta on GET) |
| 3 | FE | Phase 1–2 (editor + quotation workflow) |
| 4 | FE + QA | Phase 3–4; sign-off with product |

**Estimate:** Backend Phase A–B ~2–4 dev days; FE ~3–5 days depending on how much of custom UI exists vs stub; Figma parallel.

---

## 7. Acceptance criteria (product sign-off)

- [ ] Sales can **save and re-open** a custom quote from the platform (not only download PDF).
- [ ] Sales can **submit for admin approval** from the **same** approval UI as PEMB.
- [ ] Admin can **approve/reject**; sales can **send to customer** only when approved.
- [ ] Editing an approved custom quote **re-triggers pending approval** (same as quotation delta doc).
- [ ] List/history links open the correct editor or quotation (no dead routes).
- [ ] Optional: lead record shows quote value updated on conversion (parity with estimate conversion).

---

## 8. Open decisions (product to confirm)

1. **Auto-convert on save** vs explicit **“Create quotation”** button? (Recommend: explicit button first, optional auto on submit-approval.)
2. **Must custom quotes use the same quote number series** as PEMB quotations? (Recommend: yes — single `QUO-` sequence.)
3. **Customer-facing PDF layout:** keep current custom template or align visually with PEMB estimate PDF? (Figma decision.)
4. **Deposit / milestones** on custom quotes in v1? (Recommend: no unless required.)

---

## 9. Related docs

- Custom quote API: [`custom-quote-api.md`](./custom-quote-api.md)
- Estimate → quotation: [`../estimate-to-quotation-conversion-api-2026-09-03.md`](../estimate-to-quotation-conversion-api-2026-09-03.md)
- Approval workflow: [`../quotation-approval-workflow-api-2026-09-02.md`](../quotation-approval-workflow-api-2026-09-02.md)
- Edit while pending: [`../frontend-api-delta-2026-09-10-quotation-approval-versions.md`](../frontend-api-delta-2026-09-10-quotation-approval-versions.md)
- Send for approval FE: [`quotation-send-for-approval-fe.md`](./quotation-send-for-approval-fe.md)
