/**
 * Change Order document generator — faithful port of SM-QuotingTool v7 printCO
 * (attachment L6562-6684). Produces a complete, print-ready HTML document.
 */

const { getCompanyInfo, getLogoHtml } = require("./companyInfo");

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();

/**
 * @param {object} co Change order: {coNum, customer, date, origDate, origVal, amount, cost, profit, margin, newTotal, desc}
 * @param {object} [opts]
 * @param {object|string} [opts.company] company info override/key
 * @param {Array}  [opts.priorCOs] prior COs on the same parent (coNum <= this one), ascending
 * @param {number} [opts.baseOrigVal] base quote original value (before any COs)
 */
const generateChangeOrderHtml = (co = {}, opts = {}) => {
  const info = getCompanyInfo(opts.company);
  const logoHtml = getLogoHtml(info);
  const amount = Number(co.amount) || 0;
  const deltaSign = amount >= 0 ? "+" : "-";
  const deltaColor = amount >= 0 ? "#15803d" : "#dc2626";
  const deltaAmtStr = money(Math.abs(amount));
  const today =
    co.date ||
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const coRef = "CO-" + String(co.coNum).padStart(3, "0");
  const newTotal = Number(co.newTotal) || Number(co.origVal) + amount;
  const baseOrigVal =
    opts.baseOrigVal != null ? Math.round(opts.baseOrigVal) : Math.round(co.origVal || 0);
  const priorCOs = (Array.isArray(opts.priorCOs) ? opts.priorCOs : [])
    .slice()
    .sort((a, b) => Number(a.coNum) - Number(b.coNum));

  const css = [
    "*{box-sizing:border-box;margin:0;padding:0;}",
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1.5;color:#111;background:#fff;padding:32px 40px;}',
    "@media print{@page{margin:.55in;size:letter;}body{padding:0!important;}}",
    ".q-logo-bar{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:3px solid #1e3a8a;gap:16px;}",
    ".q-logo-sub{font-size:10px;color:#64748b;margin-top:3px;line-height:1.5;}",
    ".q-header-right{text-align:right;flex-shrink:0;}",
    ".q-co-name{font-size:13px;font-weight:700;color:#111;}",
    ".q-co-detail{font-size:11px;color:#64748b;line-height:1.6;}",
    ".q-doc-info{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;background:#f8fafc;padding:14px;border-radius:6px;}",
    ".q-field label{font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;display:block;}",
    ".q-field p{font-size:13px;font-weight:600;color:#111;margin-top:2px;}",
    ".q-price-box{background:#1e3a8a;color:#fff;padding:20px 28px;border-radius:8px;margin:18px 0;}",
    ".q-price-box-top{text-align:center;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,.2);}",
    ".q-price-label{font-size:10px;color:#93c5fd;margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em;}",
    ".q-price-val{font-size:36px;font-weight:900;letter-spacing:-1px;line-height:1.1;}",
    ".q-price-sf{font-size:11px;color:#93c5fd;margin-top:4px;}",
    ".q-price-row{display:flex;justify-content:center;gap:40px;}",
    ".q-price-side{text-align:center;}",
    ".q-price-side-label{font-size:9px;color:#93c5fd;text-transform:uppercase;letter-spacing:.06em;}",
    ".q-price-side-val{font-size:15px;font-weight:700;margin-top:2px;}",
    ".q-section-title{font-size:11px;font-weight:700;color:#1e3a8a;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:10px;margin-top:18px;}",
    ".price-table{width:100%;border-collapse:collapse;font-size:13px;}",
    ".price-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9;}",
    ".price-table .sub td{color:#64748b;font-size:12px;}",
    ".price-table .total-row td{font-weight:700;font-size:14px;color:#1e3a8a;border-top:2px solid #1e3a8a;border-bottom:none;padding-top:9px;}",
    ".desc-box{background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #1e3a8a;border-radius:4px;padding:12px 14px;font-size:12px;line-height:1.7;white-space:pre-wrap;color:#374151;margin:8px 0 0;}",
    ".q-sign{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0;}",
    ".q-sign-block strong{font-size:12px;color:#111;display:block;margin-bottom:22px;}",
    ".q-sign-line{border-bottom:1px solid #94a3b8;margin-bottom:4px;}",
    ".q-sign-sub{font-size:10px;color:#94a3b8;}",
    ".q-sign-detail{font-size:11px;color:#374151;margin-top:8px;}",
    ".q-note{font-size:10px;color:#94a3b8;margin-top:10px;line-height:1.5;}",
  ].join("");

  const priorRows = priorCOs
    .map((c) => {
      const amt = Number(c.amount) || 0;
      const s = amt >= 0 ? "+" : "-";
      const clr = amt >= 0 ? "#15803d" : "#dc2626";
      const descSnippet = c.desc
        ? ' &mdash; <span style="font-weight:400;font-size:11px;color:#64748b;">' +
          esc(c.desc.length > 60 ? c.desc.substring(0, 60) + "…" : c.desc) +
          "</span>"
        : "";
      return (
        '<tr class="adj-row" style="color:' +
        clr +
        ';"><td>Change Order #' +
        c.coNum +
        " Adjustment" +
        descSnippet +
        '</td><td style="text-align:right;font-variant-numeric:tabular-nums;">' +
        s +
        money(Math.abs(amt)) +
        "</td></tr>"
      );
    })
    .join("");

  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
    coRef +
    " — " +
    esc(co.customer) +
    "</title><style>" +
    css +
    "</style></head><body>" +
    '<div class="q-logo-bar"><div><div>' +
    logoHtml +
    '</div><div class="q-logo-sub">' +
    esc(info.tagline) +
    " &middot; " +
    esc(info.address) +
    "<br>" +
    esc(info.phone) +
    " &middot; " +
    esc(info.email) +
    " &middot; " +
    esc(info.website) +
    '</div></div><div class="q-header-right"><div class="q-co-name">CHANGE ORDER #' +
    co.coNum +
    '</div><div class="q-co-detail">Reference: ' +
    coRef +
    "<br>Date: " +
    esc(today) +
    "<br>Business/Tax #: " +
    esc(info.taxId) +
    "</div></div></div>" +
    '<div class="q-doc-info"><div class="q-field"><label>Customer</label><p>' +
    esc(co.customer) +
    '</p></div><div class="q-field"><label>Change Order Date</label><p>' +
    esc(today) +
    '</p></div><div class="q-field"><label>Original Contract Date</label><p>' +
    esc(co.origDate) +
    '</p></div><div class="q-field"><label>Amendment To</label><p>Fabrication &amp; Supply Agreement</p></div></div>' +
    '<div class="q-price-box"><div class="q-price-box-top"><div class="q-price-label">Revised Contract Total</div>' +
    '<div class="q-price-val">' +
    money(newTotal) +
    '</div><div class="q-price-sf">Change Order #' +
    co.coNum +
    " &nbsp;·&nbsp; " +
    esc(today) +
    '</div></div><div class="q-price-row">' +
    '<div class="q-price-side"><div class="q-price-side-label">Original Contract</div><div class="q-price-side-val">' +
    money(baseOrigVal) +
    "</div></div>" +
    '<div class="q-price-side" style="border-left:1px solid rgba(255,255,255,.2);border-right:1px solid rgba(255,255,255,.2);padding:0 40px;"><div class="q-price-side-label">CO Adjustment</div><div class="q-price-side-val" style="color:' +
    (amount >= 0 ? "#86efac" : "#fca5a5") +
    ';">' +
    deltaSign +
    deltaAmtStr +
    "</div></div>" +
    '<div class="q-price-side"><div class="q-price-side-label">New Total</div><div class="q-price-side-val">' +
    money(newTotal) +
    "</div></div></div></div>" +
    '<div class="q-section-title">Description of Change</div><div class="desc-box">' +
    esc(co.desc) +
    "</div>" +
    '<div class="q-section-title">Price Adjustment</div><table class="price-table">' +
    '<tr class="sub"><td>Original Contract Value</td><td style="text-align:right;font-variant-numeric:tabular-nums;">' +
    money(baseOrigVal) +
    "</td></tr>" +
    priorRows +
    '<tr class="total-row"><td>Revised Contract Total</td><td style="text-align:right;font-variant-numeric:tabular-nums;">' +
    money(newTotal) +
    "</td></tr></table>" +
    '<p class="q-note">* Payment terms per original Fabrication &amp; Supply Agreement. Additional deposit may be required on the change order amount. Sales tax will be added where applicable.</p>' +
    '<div class="q-section-title">Terms</div><p style="font-size:11px;color:#374151;line-height:1.7;">This Change Order amends the original Fabrication &amp; Supply Agreement between <strong>' +
    esc(info.legalName) +
    "</strong> and <strong>" +
    esc(co.customer) +
    "</strong>. All other terms, conditions, warranties, and obligations of the original Agreement remain unchanged and in full force and effect. This Change Order is not binding until executed by authorized representatives of both parties.</p>" +
    '<div class="q-sign"><div class="q-sign-block"><strong>' +
    esc(String(info.legalName).toUpperCase()) +
    '</strong><div class="q-sign-line"></div><div class="q-sign-sub">Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div><div class="q-sign-detail">Name: ' +
    esc(info.signerName) +
    "<br>Title: " +
    esc(info.signerTitle) +
    '</div></div><div class="q-sign-block"><strong>' +
    esc(String(co.customer || "").toUpperCase()) +
    '</strong><div class="q-sign-line"></div><div class="q-sign-sub">Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div><div class="q-sign-detail">Name: ____________________________<br>Title: ____________________________</div></div></div>' +
    "</body></html>"
  );
};

module.exports = { generateChangeOrderHtml };
