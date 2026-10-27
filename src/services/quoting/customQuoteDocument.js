/**
 * Custom Quote document generator — faithful port of SM-QuotingTool v7
 * renderCustomQuote (attachment L8746-8840). Reuses the shared quote styles.
 */

const { QUOTE_STYLES } = require("./quoteDocumentGenerator");
const { getCompanyInfo, getLogoHtml } = require("./companyInfo");
const { computeCustomQuote } = require("./customQuoteEngine");

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();

const scopeDescOf = (scope) =>
  scope === "supply"
    ? "Supply & Delivery Only"
    : scope === "install"
      ? "Installation Only"
      : "Supply, Delivery & Installation";

const asLines = (v) =>
  Array.isArray(v)
    ? v.filter((l) => String(l).trim())
    : String(v || "")
        .split("\n")
        .filter((l) => l.trim());

/**
 * @param {object} cq Custom quote fields (customer, location, size, scope, expDays,
 *        matCost, freight, laborCost, marginPct, sellOverride, inclusions, exclusions,
 *        sow:{overview,delivery,terms}, additional)
 * @param {object} [opts] { company }
 */
const generateCustomQuoteHtml = (cq = {}, opts = {}) => {
  const info = getCompanyInfo(opts.company || cq.company);
  const logoHtml = getLogoHtml(info);
  const c = computeCustomQuote(cq);
  const mat = c.matCost;
  const freight = c.freight;
  const labor = c.laborCost;
  const sell = c.sell;
  const profPct = c.profPct;

  const cust = cq.customer || "Customer";
  const loc = cq.location || "TBD";
  const size = cq.size || "TBD";
  const scopeDesc = scopeDescOf(cq.scope);
  const expDays = parseInt(cq.expDays, 10) || 15;
  const inclusions = asLines(cq.inclusions);
  const exclusions = asLines(cq.exclusions);
  const sow = cq.sow || {};
  const sowOverview = sow.overview || cq.sow_overview || "";
  const sowDelivery = sow.delivery || cq.sow_delivery || "";
  const sowTerms = sow.terms || cq.sow_terms || "";
  const additional = cq.additional || "";

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const exp = new Date(Date.now() + expDays * 864e5).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = `
  <div class="quote-output">
    <div class="q-logo-bar">
      <div><div>${logoHtml}</div>
        <div class="q-logo-sub">${esc(info.tagline)} &middot; ${esc(info.address)}<br>${esc(info.phone)} &middot; ${esc(info.email)} &middot; ${esc(info.website)}</div></div>
      <div class="q-header-right"><div class="q-co-name">ESTIMATE</div>
        <div class="q-co-detail">Date: ${today}<br>Expiration: ${exp}<br>Business/Tax #: ${esc(info.taxId)}</div></div>
    </div>
    <div class="q-doc-info">
      <div class="q-field"><label>Prepared For</label><p>${esc(cust)}</p></div>
      <div class="q-field"><label>Location</label><p>${esc(loc)}</p></div>
      <div class="q-field"><label>Building</label><p>${esc(size)}</p></div>
      <div class="q-field"><label>Scope</label><p>${esc(scopeDesc)}</p></div>
    </div>
    <div class="q-price-box">
      <div class="q-price-label">Total Project Investment</div>
      <div class="q-price-val">${money(sell)}</div>
      <div class="q-price-sf">Freight included · ${profPct}% margin</div>
    </div>
    <div class="q-two-col">
      <div class="q-section">
        <div class="q-section-title">Pricing Summary</div>
        <div class="q-breakdown"><table>
          ${mat > 0 ? `<tr class="q-sub-row"><td>Material</td><td style="text-align:right">${money(mat)}</td></tr>` : ""}
          ${freight > 0 ? `<tr class="q-sub-row"><td>Freight</td><td style="text-align:right">${money(freight)}</td></tr>` : ""}
          ${labor > 0 ? `<tr class="q-sub-row"><td>Installation</td><td style="text-align:right">${money(labor)}</td></tr>` : ""}
          <tr class="q-total-row"><td>Total</td><td style="text-align:right">${money(sell)}</td></tr>
        </table></div>
        <p style="font-size:11px;color:#64748b;margin-top:8px;">Sales tax will be added where applicable.</p>
      </div>
      <div class="q-section">
        ${inclusions.length ? `<div class="q-section-title">Scope Included</div><ul class="q-list">${inclusions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
        ${exclusions.length ? `<div class="q-section-title" style="margin-top:12px;">Exclusions</div><ul class="q-list q-exc">${exclusions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>
    ${
      sowOverview || sowDelivery || sowTerms
        ? `<div class="q-section" style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;">
      <div class="q-section-title">Statement of Work</div>
      ${sowOverview ? `<p style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:8px;">${esc(sowOverview)}</p>` : ""}
      ${sowDelivery ? `<p style="font-size:12px;font-weight:600;color:#374151;margin-bottom:2px;">Delivery &amp; Lead Time</p><p style="font-size:12px;color:#374151;line-height:1.7;margin-bottom:8px;">${esc(sowDelivery)}</p>` : ""}
      ${sowTerms ? `<p style="font-size:12px;font-weight:600;color:#374151;margin-bottom:2px;">Terms &amp; Conditions</p><p style="font-size:12px;color:#374151;line-height:1.7;">${esc(sowTerms)}</p>` : ""}
    </div>`
        : ""
    }
    ${additional ? `<div class="q-section" style="margin-top:14px;padding:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;"><div class="q-section-title" style="color:#92400e;">Additional Notes</div><p style="font-size:12px;color:#374151;line-height:1.7;white-space:pre-wrap;">${esc(additional)}</p></div>` : ""}
    <div class="q-sign" style="margin-top:20px;">
      <div class="q-sign-block"><strong>${esc(info.legalName)}</strong><div class="q-sign-line"></div><p>Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</p></div>
      <div class="q-sign-block"><strong>${esc(cust)}</strong><div class="q-sign-line"></div><p>Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</p></div>
    </div>
    <p style="font-size:10px;color:#94a3b8;margin-top:12px;text-align:center;">Thanks for your Business! Reach out with any questions · ${esc(info.phone)} &middot; ${esc(info.email)}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${QUOTE_STYLES}</style></head><body>${body}</body></html>`;
};

module.exports = { generateCustomQuoteHtml };
