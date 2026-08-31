# Quotation Server Preview Stylesheet (Frontend Handoff)

**Date:** 2026-08-29  
**Use case:** React frontend rendering `quoteHtml`, `sowHtml`, `contractHtml` from  
`POST /api/sales/estimates/documents/preview`

---

## Why preview looks unstyled

`quoteHtml`, `sowHtml`, and `contractHtml` are HTML fragments.  
They need the same CSS that backend uses (`QUOTE_STYLES` in `src/services/quoting/quoteDocumentGenerator.js`).

If you use `assembledHtml`, style is already included by backend.  
If you use section fragments (`quoteHtml`, `sowHtml`, `contractHtml`), inject this stylesheet in frontend.

---

## CSS to use (exact backend style)

```css
.quote-output{background:#fff;color:#111;border-radius:8px;padding:32px;margin-bottom:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
.q-logo-bar{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:3px solid #1e3a8a;gap:16px;}
.q-logo-sm{font-size:26px;font-weight:900;color:#1a1a1a;letter-spacing:-0.5px;font-family:Arial Black,Arial,sans-serif;padding:4px 6px 4px 0;display:inline-flex;align-items:center;}
.q-logo-mat{font-size:26px;font-weight:900;color:#fff;background:#2176c7;padding:4px 12px;display:inline-flex;align-items:center;letter-spacing:-0.5px;font-family:Arial Black,Arial,sans-serif;}
.q-logo-sub{font-size:10px;color:#64748b;margin-top:3px;line-height:1.5;}
.q-header-right{text-align:right;flex-shrink:0;}
.q-co-name{font-size:13px;font-weight:700;color:#111;}
.q-co-detail{font-size:11px;color:#64748b;line-height:1.6;}
.q-doc-info{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;background:#f8fafc;padding:14px;border-radius:6px;}
.q-field label{font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;}
.q-field p{font-size:13px;font-weight:600;color:#111;margin-top:2px;}
.q-price-box{background:#1e3a8a;color:#fff;padding:20px;border-radius:8px;text-align:center;margin:20px 0;}
.q-price-label{font-size:11px;color:#93c5fd;margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em;}
.q-price-val{font-size:36px;font-weight:900;letter-spacing:-1px;}
.q-price-sf{font-size:12px;color:#93c5fd;margin-top:4px;}
.q-section{margin-bottom:16px;}
.q-section-title{font-size:11px;font-weight:700;color:#1e3a8a;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:8px;}
.q-two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.q-list{margin:0;padding-left:16px;} .q-list li{font-size:12px;color:#374151;line-height:1.7;}
.q-list li::marker{color:#1e3a8a;} .q-exc li::marker{color:#dc2626;}
.q-breakdown table{width:100%;border-collapse:collapse;font-size:12px;}
.q-breakdown td{padding:5px 8px;border-bottom:1px solid #f1f5f9;}
.q-breakdown .q-total-row td{font-weight:700;font-size:13px;color:#1e3a8a;border-top:2px solid #1e3a8a;border-bottom:none;}
.q-breakdown .q-sub-row td{color:#64748b;}
.q-sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;}
.q-sign-block p{font-size:12px;color:#64748b;margin-top:4px;}
.q-sign-block strong{font-size:13px;color:#111;}
.q-sign-line{border-bottom:1px solid #94a3b8;margin-top:24px;margin-bottom:4px;}
.page-break{page-break-after:always;margin-bottom:32px;}
.drawing-page{page-break-before:always;page-break-inside:avoid;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:85vh;}
.drawing-page img{max-width:100%;max-height:82vh;border:1px solid #e2e8f0;border-radius:4px;}
@media print{.page-break{page-break-after:always;}}
```

---

## Recommended integration in React

### Option A (preferred): render `assembledHtml`

`assembledHtml` already includes `<style>...</style>` from backend.

```tsx
<div dangerouslySetInnerHTML={{ __html: data.assembledHtml }} />
```

### Option B: render section fragments (`quoteHtml` / `sowHtml` / `contractHtml`)

Inject CSS once globally (or scoped wrapper), then render fragment:

```tsx
// e.g. in a CSS/SCSS file imported by preview page:
// (paste stylesheet above)

<div className="preview-wrapper" dangerouslySetInnerHTML={{ __html: data.sowHtml }} />
```

---

## API request example (SOW + Contract preview)

`POST /api/sales/estimates/documents/preview`

```json
{
  "estimateId": "66abc123...",
  "sections": ["sow", "contract"]
}
```

Response fields to use:
- `data.sowHtml`
- `data.contractHtml`
- `data.assembledHtml`

---

## Notes

- If you use fragment HTML without CSS, preview will appear plain/unstyled.
- Keep this stylesheet synced with backend `QUOTE_STYLES`.
- For print/export consistency with backend PDF, use `assembledHtml`.

