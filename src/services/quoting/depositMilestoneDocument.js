/**
 * Deposit receipt + Milestone schedule documents — faithful ports of
 * SM-QuotingTool v7 printDepositReceipt (L7106) and printMilestones (L7365).
 */

const { getCompanyInfo } = require("./companyInfo");
const { computeDeposit, computeMilestones } = require("./depositMilestoneEngine");

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
const today = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/**
 * @param {object} input { quote:{id,customer,location,address,buildingSize,jobNumber},
 *   grand, pct, flat, note, company }
 */
const generateDepositReceiptHtml = (input = {}) => {
  const info = getCompanyInfo(input.company);
  const q = input.quote || {};
  const grand = Number(input.grand) || 0;
  const d = computeDeposit({ grand, pct: input.pct, flat: input.flat });
  const note = input.note || "";
  const invNum = "DEP-" + String(q.id || q._id || "000000").slice(-6).toUpperCase();
  const pctLabel = d.pct + "%";

  const css = `*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;font-size:13px;color:#111;background:#fff;}.page{max-width:700px;margin:0 auto;padding:48px 40px;}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;}.co-name{font-size:22px;font-weight:900;color:#1e3a8a;letter-spacing:-.5px;}.co-meta{font-size:11px;color:#64748b;line-height:1.8;margin-top:6px;}.inv-title{text-align:right;}.inv-label{font-size:28px;font-weight:900;color:#1e3a8a;}.inv-num{font-size:12px;color:#64748b;margin-top:4px;}.inv-date{font-size:12px;color:#64748b;margin-top:2px;}.divider{border:none;border-top:2px solid #1e3a8a;margin:0 0 28px;}.bill-row{display:flex;gap:40px;margin-bottom:28px;}.bill-block{flex:1;}.bill-label{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;}.bill-val{font-size:14px;font-weight:700;color:#111;line-height:1.5;}.bill-sub{font-size:12px;color:#64748b;line-height:1.5;}table{width:100%;border-collapse:collapse;}thead tr{background:#1e3a8a;color:#fff;}thead th{padding:10px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;}thead th:last-child{text-align:right;}tbody tr{border-bottom:1px solid #e2e8f0;}tbody td{padding:12px 14px;font-size:13px;vertical-align:top;}tbody td:last-child{text-align:right;font-weight:600;}.desc-main{font-weight:700;color:#111;}.desc-sub{font-size:11px;color:#64748b;margin-top:3px;line-height:1.5;}.totals{margin-left:auto;width:300px;}.tot-row{display:flex;justify-content:space-between;padding:8px 14px;font-size:13px;}.tot-row.sub{border-bottom:1px solid #e2e8f0;color:#64748b;}.tot-row.dep{background:#f0fdf4;border:1.5px solid #86efac;border-radius:6px;font-weight:800;color:#15803d;font-size:15px;margin:6px 0;}.tot-row.bal{background:#fff8ed;border:1.5px solid #fed7aa;border-radius:6px;font-weight:700;color:#92400e;font-size:13px;}.note-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin-top:22px;font-size:12px;color:#374151;}.note-label{font-weight:700;font-size:10px;text-transform:uppercase;color:#64748b;margin-bottom:4px;letter-spacing:.05em;}.sig-area{display:flex;gap:40px;margin-top:40px;padding-top:24px;border-top:1px solid #e2e8f0;}.sig-line{flex:1;}.sig-rule{border-top:1.5px solid #111;margin-top:44px;margin-bottom:6px;}.sig-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;}.footer{margin-top:36px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center;}@media print{.page{padding:24px 20px;}}`;

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Deposit Invoice ${invNum}</title><style>${css}</style></head><body><div class="page">` +
    `<div class="header"><div><div class="co-name">${esc(info.name)}</div><div class="co-meta">${info.address ? esc(info.address) + "<br>" : ""}${esc(info.phone)} &nbsp;·&nbsp; ${esc(info.email)}</div></div>` +
    `<div class="inv-title"><div class="inv-label">INVOICE</div><div class="inv-num">${invNum}</div><div class="inv-date">Date: ${today()}</div></div></div>` +
    `<hr class="divider">` +
    `<div class="bill-row"><div class="bill-block"><div class="bill-label">Bill To</div><div class="bill-val">${esc(q.customer || "Customer")}</div><div class="bill-sub">${esc(q.location || q.address || "")}</div></div>` +
    `<div class="bill-block"><div class="bill-label">Project</div><div class="bill-val">${esc(q.buildingSize || "")}</div><div class="bill-sub">${q.jobNumber ? "Job #" + esc(q.jobNumber) : ""}</div></div>` +
    `<div class="bill-block"><div class="bill-label">Due</div><div class="bill-val" style="color:#dc2626;">Upon Receipt</div></div></div>` +
    `<table><thead><tr><th>Description</th><th style="text-align:right;">Amount</th></tr></thead><tbody>` +
    `<tr><td><div class="desc-main">Deposit — Pre-Engineered Metal Building</div><div class="desc-sub">${pctLabel} deposit on total contract value of ${money(grand)}<br>Per fabrication &amp; supply agreement. Non-refundable upon order placement.</div></td><td>${money(d.deposit)}</td></tr>` +
    `</tbody></table>` +
    `<div class="totals"><div class="tot-row sub"><span>Contract Total</span><span>${money(grand)}</span></div>` +
    `<div class="tot-row dep"><span>Deposit Due Now</span><span>${money(d.deposit)}</span></div>` +
    `<div class="tot-row bal"><span>Balance at Delivery</span><span>${money(d.balance)}</span></div></div>` +
    (note ? `<div class="note-box"><div class="note-label">Payment Instructions</div>${esc(note)}</div>` : "") +
    `<div class="sig-area"><div class="sig-line"><div class="sig-rule"></div><div class="sig-lbl">Customer Signature</div></div><div class="sig-line"><div class="sig-rule"></div><div class="sig-lbl">Date</div></div><div class="sig-line"><div class="sig-rule"></div><div class="sig-lbl">Authorized · ${esc(info.name)}</div></div></div>` +
    `<div class="footer">Thank you for your business · ${esc(info.name)}${info.email ? " · " + esc(info.email) : ""}</div>` +
    `</div></body></html>`
  );
};

/**
 * @param {object} input { quote:{...}, grand, rows:[{label,amount}], note, company }
 */
const generateMilestoneScheduleHtml = (input = {}) => {
  const info = getCompanyInfo(input.company);
  const q = input.quote || {};
  const grand = Number(input.grand) || 0;
  const m = computeMilestones({ grand, rows: input.rows });
  const note = input.note || "";
  const invNum = "MS-" + String(q.id || q._id || "000000").slice(-6).toUpperCase();

  const rowsHTML = m.rows
    .map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      return (
        `<tr style="background:${bg};border-bottom:1px solid #e2e8f0;">` +
        `<td style="padding:11px 14px;font-size:13px;font-weight:700;color:#7c3aed;text-align:center;">${i + 1}</td>` +
        `<td style="padding:11px 14px;font-size:13px;color:#111;">${esc(r.label || "Milestone " + (i + 1))}</td>` +
        `<td style="padding:11px 14px;font-size:14px;font-weight:800;color:#111;text-align:right;">${money(r.amount)}</td></tr>`
      );
    })
    .join("");

  const balanceRow =
    m.remaining !== 0
      ? `<tr style="background:#fff8ed;border-bottom:1px solid #fed7aa;"><td style="padding:11px 14px;font-size:13px;font-weight:700;color:#92400e;text-align:center;">—</td><td style="padding:11px 14px;font-size:13px;color:#92400e;font-weight:700;">Remaining Balance</td><td style="padding:11px 14px;font-size:14px;font-weight:800;color:#92400e;text-align:right;">${money(m.remaining)}</td></tr>`
      : "";

  const css = `*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;font-size:13px;color:#111;background:#fff;}.page{max-width:700px;margin:0 auto;padding:44px 36px;}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:18px;border-bottom:2.5px solid #7c3aed;}.co-name{font-size:21px;font-weight:900;color:#7c3aed;letter-spacing:-.5px;}.co-meta{font-size:11px;color:#64748b;line-height:1.8;margin-top:5px;}.doc-title{text-align:right;}.doc-label{font-size:26px;font-weight:900;color:#7c3aed;}.doc-num{font-size:11px;color:#64748b;margin-top:3px;}.doc-date{font-size:11px;color:#64748b;margin-top:2px;}.info-row{display:flex;gap:32px;margin-bottom:20px;}.info-block{flex:1;}.info-label{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px;}.info-val{font-size:14px;font-weight:700;color:#111;line-height:1.4;}.contract-box{background:#f5f3ff;border:2px solid #ddd6fe;border-radius:8px;padding:14px 18px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:center;}.contract-label{font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;}.contract-val{font-size:26px;font-weight:900;color:#7c3aed;}table{width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1.5px solid #e2e8f0;}thead tr{background:#7c3aed;color:#fff;}thead th{padding:10px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;text-align:left;}thead th:last-child,thead th:nth-child(3){text-align:right;}.total-row{background:#f5f3ff!important;border-top:2px solid #7c3aed;}.total-row td{padding:12px 14px;font-weight:800;font-size:14px;}.note-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:11px 14px;margin-top:18px;font-size:12px;color:#374151;}.note-label{font-weight:700;font-size:10px;text-transform:uppercase;color:#64748b;margin-bottom:4px;letter-spacing:.05em;}.sig-area{display:flex;gap:36px;margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;}.sig-line{flex:1;}.sig-rule{border-top:1.5px solid #111;margin-top:44px;margin-bottom:5px;}.sig-lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;}.footer{margin-top:30px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center;}@media print{.page{padding:22px 18px;}}`;

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Milestone Schedule ${invNum}</title><style>${css}</style></head><body><div class="page">` +
    `<div class="header"><div><div class="co-name">${esc(info.name)}</div><div class="co-meta">${info.address ? esc(info.address) + "<br>" : ""}${esc(info.phone)} &nbsp;·&nbsp; ${esc(info.email)}</div></div>` +
    `<div class="doc-title"><div class="doc-label">MILESTONE SCHEDULE</div><div class="doc-num">${invNum}</div><div class="doc-date">Date: ${today()}</div></div></div>` +
    `<div class="info-row"><div class="info-block"><div class="info-label">Customer</div><div class="info-val">${esc(q.customer || "")}</div></div>` +
    `<div class="info-block"><div class="info-label">Location</div><div class="info-val">${esc(q.location || q.address || "")}</div></div>` +
    `<div class="info-block"><div class="info-label">Project</div><div class="info-val">${esc(q.buildingSize || "")}</div></div></div>` +
    `<div class="contract-box"><div class="contract-label">Total Contract Value</div><div class="contract-val">${money(grand)}</div></div>` +
    `<table><thead><tr><th style="width:44px;">#</th><th>Description</th><th style="text-align:right;">Amount Due</th></tr></thead><tbody>` +
    rowsHTML +
    balanceRow +
    `<tr class="total-row"><td colspan="2" style="color:#7c3aed;">Total Scheduled</td><td style="text-align:right;color:#7c3aed;">${money(m.scheduled)}</td></tr>` +
    `</tbody></table>` +
    (note ? `<div class="note-box"><div class="note-label">Payment Instructions</div>${esc(note)}</div>` : "") +
    `<div class="sig-area"><div class="sig-line"><div class="sig-rule"></div><div class="sig-lbl">Customer Signature</div></div><div class="sig-line"><div class="sig-rule"></div><div class="sig-lbl">Date</div></div><div class="sig-line"><div class="sig-rule"></div><div class="sig-lbl">Authorized · ${esc(info.name)}</div></div></div>` +
    `<div class="footer">${esc(info.name)}${info.email ? " · " + esc(info.email) : ""}${info.phone ? " · " + esc(info.phone) : ""}</div>` +
    `</div></body></html>`
  );
};

module.exports = { generateDepositReceiptHtml, generateMilestoneScheduleHtml };
