/** Quote / SOW / contract HTML + PDF generation — port of HTML renderQuote / renderSOW / renderAssembled */

const CONTRACT_TEXT = require('./contractText')

const QUOTE_STYLES = `
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
`

const getLogoHtml = () =>
  '<span class="q-logo-sm">STORAGE</span><span class="q-logo-mat">MATERIALS</span>'

const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString()
const fmtDate = (d = new Date()) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

const scopeDesc = (scope) => {
  const s = String(scope || 'both').toLowerCase()
  if (s === 'supply') return 'Pre-Engineered Metal Building Supply & Delivery Only'
  if (s === 'install') return 'Installation Only'
  return 'Pre-Engineered Metal Building Supply, Delivery & Installation'
}

const buildQuoteContext = (payload = {}) => {
  const customer = payload.customer || {}
  const full = payload.fullQuote || {}
  const res = full.pricing || payload.pricingResult || payload.pricing || {}
  const concrete = full.concrete || payload.concrete || {}
  const insulation = full.insulation || payload.insulation || {}
  const salesTax = full.salesTax || payload.salesTax || {}
  const grandTotal = full.grandTotal ?? payload.grandTotal ?? res.totSell ?? 0
  const sf = res.sf || payload.squareFootage || 0
  const grandSF = sf > 0 ? (grandTotal / sf).toFixed(2) : res.sfPrice

  return {
    cust: customer.name || payload.leadCompanyName || 'Customer',
    addr: customer.address || payload.streetAddress || '',
    loc: customer.location || payload.cityStateZip || 'TBD',
    email: customer.email || payload.customerEmail || '',
    size: payload.buildingSize || `${Number(sf).toLocaleString()} SF`,
    today: fmtDate(payload.quoteDate ? new Date(payload.quoteDate) : new Date()),
    exp: fmtDate(new Date(Date.now() + 15 * 864e5)),
    res,
    concrete,
    insulation,
    salesTax,
    grandTotal,
    grandSF,
    sf,
    additionalInfo: payload.additionalInfo || '',
  }
}

const generateQuoteHtml = (payload = {}) => {
  const ctx = buildQuoteContext(payload)
  const { res, concrete, insulation, salesTax, grandTotal, grandSF, sf } = ctx
  const concInclude = concrete.include && concrete.appliedSell > 0
  const insulInclude = insulation.include && insulation.appliedSell > 0
  const scope = scopeDesc(res.scope)
  const custFull = ctx.addr
    ? `${ctx.cust}<br><span style="font-weight:400;font-size:11px;color:#64748b;">${ctx.addr}<br>${ctx.loc}</span>`
    : ctx.cust

  return `<div class="quote-output" id="quote-printable">
    <div class="q-logo-bar">
      <div>
        ${getLogoHtml()}
        <div class="q-logo-sub">METAL AND DOORS · 1851 Madison Ave Suite 300, Council Bluffs, IA 51503<br>(888) 968-1222 · travis@storagematerials.com · www.storagematerials.com</div>
      </div>
      <div class="q-header-right">
        <div class="q-co-name">ESTIMATE</div>
        <div class="q-co-detail">Date: ${ctx.today}<br>Expiration: ${ctx.exp}<br>Business/Tax #: 99-4515145</div>
      </div>
    </div>
    <div class="q-doc-info">
      <div class="q-field"><label>Prepared For</label><p>${custFull}</p></div>
      <div class="q-field"><label>Location</label><p>${ctx.loc}</p></div>
      <div class="q-field"><label>Building</label><p>${ctx.size} ${res.jobType || 'PEMB'}</p></div>
      <div class="q-field"><label>Scope</label><p>${scope}${concInclude ? ' + Concrete' : ''}${insulInclude ? ' + Insulation' : ''}</p></div>
      <div class="q-field"><label>Roof System</label><p>${res.isSS ? 'Standing Seam Metal Roof' : '26 GA Galvalume (R-Panel, screw-down)'}</p></div>
      <div class="q-field"><label>Total Weight</label><p>${Math.round(res.totWt || 0).toLocaleString()} lbs · ${res.trucks || 0} truck${res.trucks !== 1 ? 's' : ''}</p></div>
    </div>
    <div class="q-price-box">
      <div class="q-price-label">Total Project Investment</div>
      <div class="q-price-val">${fmtMoney(grandTotal)}</div>
      <div class="q-price-sf">$${grandSF}/SF · ${Number(sf).toLocaleString()} SF · Freight included${concInclude ? ' · Concrete included' : ''}${insulInclude ? ' · Insulation included' : ''}</div>
    </div>
    <div class="q-two-col">
      <div class="q-section">
        <div class="q-section-title">Pricing Summary</div>
        <div class="q-breakdown"><table>
          <tr class="q-sub-row"><td>Material</td><td style="text-align:right">${fmtMoney(res.matCost)}</td></tr>
          <tr class="q-sub-row"><td>Freight (${res.trucks || 0} truck${res.trucks !== 1 ? 's' : ''})</td><td style="text-align:right">${fmtMoney(res.freight)}</td></tr>
          ${String(res.scope || '').toLowerCase() !== 'supply' ? `<tr class="q-sub-row"><td>Installation</td><td style="text-align:right">${fmtMoney(res.instSell)}</td></tr>` : ''}
          <tr class="q-sub-row" style="font-weight:600;"><td>Building Subtotal</td><td style="text-align:right">${fmtMoney(res.totSell)}</td></tr>
          ${concInclude ? `<tr class="q-sub-row"><td>Concrete (${concrete.thickness}" · ${concrete.psi} PSI · ${Number(sf).toLocaleString()} SF)</td><td style="text-align:right">${fmtMoney(concrete.appliedSell)}</td></tr>` : ''}
          ${insulInclude ? `<tr class="q-sub-row"><td>Insulation (${insulation.rRoof} roof / ${insulation.rWall} wall · ${Number(sf).toLocaleString()} SF)</td><td style="text-align:right">${fmtMoney(insulation.appliedSell)}</td></tr>` : ''}
          ${salesTax.amount > 0 ? `<tr class="q-sub-row" style="color:#b45309;"><td>Sales Tax (${salesTax.rate}% on materials &amp; insulation — labor not taxed)</td><td style="text-align:right">${fmtMoney(salesTax.amount)}</td></tr>` : ''}
          <tr class="q-total-row"><td>Total</td><td style="text-align:right">${fmtMoney(grandTotal)}</td></tr>
        </table></div>
      </div>
      <div class="q-section">
        <div class="q-section-title">Scope Included</div>
        <ul class="q-list">
          <li>Full ${res.jobType || 'PEMB'} structural system</li>
          <li>${res.isSS ? 'Standing seam roof system' : 'Screw-down metal roof panels'}</li>
          <li>Wall panels, trim &amp; accessories</li>
          <li>All fasteners, sealants &amp; closures</li>
          <li>Freight to jobsite</li>
          ${String(res.scope || '').toLowerCase() !== 'supply' ? '<li>Labor &amp; installation</li><li>Equipment &amp; supervision</li>' : ''}
          ${concInclude ? `<li>Concrete foundation &amp; ${concrete.thickness}" ${concrete.psi} PSI slab</li>` : ''}
          ${insulInclude ? `<li>Insulation — ${insulation.rRoof} roof / ${insulation.rWall} walls</li>` : ''}
        </ul>
      </div>
    </div>
    <div class="q-sign">
      <div class="q-sign-block"><strong>Steel Investments DBA Storage Materials</strong><div class="q-sign-line"></div><p>Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</p></div>
      <div class="q-sign-block"><strong>${ctx.cust}</strong><div class="q-sign-line"></div><p>Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</p></div>
    </div>
    ${ctx.additionalInfo ? `<div style="margin-top:14px;padding:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;"><div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Additional Information</div><p style="font-size:12px;color:#374151;line-height:1.7;white-space:pre-wrap;">${ctx.additionalInfo}</p></div>` : ''}
    <p style="font-size:10px;color:#94a3b8;margin-top:12px;text-align:center;">Thanks for your Business! Reach out with any questions · (888) 968-1222 · travis@storagematerials.com</p>
  </div>`
}

const generateSowHtml = (payload = {}) => {
  const ctx = buildQuoteContext(payload)
  const { res, concrete, insulation, grandTotal } = ctx
  const isSupply = String(res.scope || '').toLowerCase() === 'supply'
  const scopeTitle = scopeDesc(res.scope)
  const concInclude = concrete.include && concrete.appliedSell > 0
  const insulInclude = insulation.include && insulation.appliedSell > 0

  const concreteSow = concInclude
    ? `<div class="q-section" style="margin-top:16px;">
        <div class="q-section-title">Concrete &amp; Foundation</div>
        <p style="font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600;">${concrete.thickness}" · ${concrete.psi} PSI · $${concrete.sellSF?.toFixed(2) || '0'}/SF · ${Number(res.sf || 0).toLocaleString()} SF · Total: ${fmtMoney(concrete.appliedSell)}</p>
        <ul class="q-list">${(concrete.sowItems || []).map((i) => `<li>${i}</li>`).join('')}${concrete.sowNotes ? `<li>${concrete.sowNotes}</li>` : ''}</ul>
      </div>`
    : ''

  const insulationSow = insulInclude
    ? `<div class="q-section" style="margin-top:16px;">
        <div class="q-section-title">Insulation System</div>
        <p style="font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600;">${insulation.systemLabel} · Roof ${insulation.rRoof} / Wall ${insulation.rWall} · Total: ${fmtMoney(insulation.appliedSell)}</p>
      </div>`
    : ''

  return `<div class="quote-output" id="sow-printable">
    <div class="q-logo-bar">
      <div>${getLogoHtml()}<div class="q-logo-sub">METAL AND DOORS · 1851 Madison Ave Suite 300, Council Bluffs, IA 51503 · (888) 968-1222</div></div>
      <div class="q-header-right"><div class="q-co-name">STATEMENT OF WORK</div><div class="q-co-detail">Date: ${ctx.today}</div></div>
    </div>
    <div style="text-align:center;margin-bottom:16px;"><div style="font-size:15px;font-weight:700;color:#111;">${scopeTitle}</div></div>
    <div class="q-doc-info">
      <div class="q-field"><label>Project Name</label><p>${ctx.cust} Project</p></div>
      <div class="q-field"><label>Customer</label><p>${ctx.cust}</p></div>
      <div class="q-field"><label>Location</label><p>${ctx.loc}</p></div>
      <div class="q-field"><label>Building Size</label><p>${ctx.size} ${res.jobType || 'PEMB'}</p></div>
    </div>
    <div class="q-section"><div class="q-section-title">1. Project Overview</div>
      <p style="font-size:12px;color:#374151;line-height:1.7;">Storage Materials will furnish${isSupply ? ' and deliver' : ' and install'} a complete Pre-Engineered Metal Building (PEMB) package based on preliminary drawings.</p>
      <ul class="q-list" style="margin-top:8px;">
        <li>Approx. ${ctx.size} eave height</li>
        <li>Clear span rigid frame structure</li>
        <li>Roof system: ${res.isSS ? 'Standing Seam Metal Roof' : '26 GA Galvalume (R-Panel, screw-down)'}</li>
        <li>Wall system: 26 GA panel (color TBD / SMP system)</li>
      </ul>
    </div>
    <div class="q-section"><div class="q-section-title">2. Scope of Work — Inclusions</div>
      <ul class="q-list">
        <li>Rigid frames, purlins, girts, eave struts, bracing</li>
        <li>Roof &amp; wall panels, trim, fasteners, sealants</li>
        <li>Freight to jobsite</li>
        ${!isSupply ? '<li>Full erection crew, lifts, and supervision</li>' : ''}
      </ul>
    </div>
    <div class="q-section"><div class="q-section-title">3. Exclusions (By Others)</div>
      <ul class="q-list q-exc">
        ${!concInclude ? '<li>Concrete foundation, slab, and anchor bolts</li>' : ''}
        ${!insulInclude ? '<li>Insulation system</li>' : ''}
        ${isSupply ? '<li>Building erection / installation</li>' : ''}
        <li>Doors, windows, permits, electrical, plumbing, HVAC</li>
        <li>Sales tax (unless noted)</li>
      </ul>
    </div>
    ${concreteSow}${insulationSow}
    <div class="q-price-box" style="margin-top:20px;">
      <div class="q-price-label">Total Project Investment</div>
      <div class="q-price-val">${fmtMoney(grandTotal)}</div>
      <div class="q-price-sf">$${ctx.grandSF}/SF building · ${scopeTitle}${concInclude ? ' + Concrete' : ''}</div>
    </div>
    <div class="q-sign">
      <div class="q-sign-block"><strong>Steel Investments DBA Storage Materials</strong><div class="q-sign-line"></div><p>Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</p></div>
      <div class="q-sign-block"><strong>${ctx.cust}</strong><div class="q-sign-line"></div><p>Authorized Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</p></div>
    </div>
  </div>`
}

const generateContractHtml = (payload = {}) => {
  const contract = payload.contract || {}
  const ctx = buildQuoteContext(payload)
  const cust = contract.customer || ctx.cust || '[CUSTOMER LEGAL ENTITY NAME]'
  const addr = contract.address || ctx.addr || ''
  const city = contract.city || ctx.loc || ''
  const email = contract.email || ctx.email || '[E-MAIL ADDRESS]'
  const date = contract.date || ctx.today || '[DATE]'
  const deposit = contract.deposit || 'forty-percent (40%)'
  const type = contract.type || (String(ctx.res.scope || '').toLowerCase() === 'supply' ? 'supply' : 'both')
  const scope = type === 'both' ? 'fabrication, supply, delivery, and installation' : 'fabrication and supply'
  const value = contract.value || fmtMoney(ctx.grandTotal)

  const text = CONTRACT_TEXT
    .replace(/\[DATE\]/g, date)
    .replace(/\[CUSTOMER\]/g, cust)
    .replace(/\[DEPOSIT%\]/g, deposit)
    .replace(
      '[TO BE UPDATED BY STEEL — see attached quote for pricing and specifications]',
      `Total Contract Value: ${value}\nScope: ${scope.charAt(0).toUpperCase() + scope.slice(1)} of pre-engineered metal building materials and systems.`
    )

  const body = text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return '<br>'
      if (/^[A-Z][A-Z\s&]+\.$/.test(line.trim()) || /^[A-Z][A-Z\s]+$/.test(line.trim())) {
        return `<p style="font-weight:700;margin:12px 0 4px;">${line}</p>`
      }
      return `<p style="margin:4px 0;">${line}</p>`
    })
    .join('')

  const sigBlock = `<div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px;">
    <div><div style="font-weight:700;margin-bottom:20px;">STEEL INVESTMENTS, LLC</div>
    <div style="border-bottom:1px solid #333;margin-bottom:4px;height:24px;"></div><div style="font-size:10px;">Authorized Signature &nbsp;&nbsp; Date</div>
    <div style="margin-top:12px;">Name: Travis Overhue</div><div>Title: Owner</div></div>
    <div><div style="font-weight:700;margin-bottom:20px;">${cust}</div>
    <div style="border-bottom:1px solid #333;margin-bottom:4px;height:24px;"></div><div style="font-size:10px;">Authorized Signature &nbsp;&nbsp; Date</div>
    ${addr ? `<div style="margin-top:12px;">${addr}</div>` : ''}
    ${city ? `<div>${city}</div>` : ''}
    ${email ? `<div>${email}</div>` : ''}</div></div>`

  return `<div class="quote-output" style="font-family:Georgia,serif;font-size:11px;line-height:1.8;color:#111;">
    <div style="text-align:center;font-size:16px;font-weight:700;margin-bottom:16px;border-bottom:2px solid #1e3a8a;padding-bottom:12px;">Fabrication &amp; Supply Agreement</div>
    ${body}${sigBlock}
  </div>`
}

const generateDrawingsHtml = (drawings = []) => {
  const included = (drawings || []).filter((d) => d.includeInQuote !== false && d.fileBase64)
  if (!included.length) return ''

  return `<div class="quote-output" style="margin-bottom:32px;">
    <div class="q-logo-bar"><div>${getLogoHtml()}<div class="q-logo-sub">1851 Madison Ave Suite 300, Council Bluffs, IA 51503 · (888) 968-1222</div></div></div>
    <div style="font-size:16px;font-weight:700;text-align:center;margin:16px 0;color:#1e3a8a;">Building Drawings &amp; Plans</div>
    ${included
      .map(
        (img, i) =>
          `<div class="drawing-page" style="${i === 0 ? 'page-break-before:avoid;' : ''}">
            <img src="${img.fileBase64.startsWith('data:') ? img.fileBase64 : `data:image/png;base64,${img.fileBase64}`}" alt="${img.name || 'Drawing'}">
            <div style="font-size:11px;color:#64748b;margin-top:8px;text-align:center;font-weight:600;">${img.name || 'Drawing'}</div>
          </div>`
      )
      .join('')}
  </div>`
}

const generateAssembledHtml = (payload = {}) => {
  const sections = payload.sections || ['quote', 'sow', 'contract', 'drawings']
  const parts = []

  if (sections.includes('quote')) parts.push(`<div class="page-break">${generateQuoteHtml(payload)}</div>`)
  if (sections.includes('sow')) parts.push(`<div class="page-break">${generateSowHtml(payload)}</div>`)
  if (sections.includes('contract')) parts.push(`<div class="page-break">${generateContractHtml(payload)}</div>`)
  if (sections.includes('drawings')) {
    const drawingsHtml = generateDrawingsHtml(payload.drawingAttachments || payload.drawings)
    if (drawingsHtml) parts.push(drawingsHtml)
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${QUOTE_STYLES}</style></head><body>${parts.join('')}</body></html>`
}

const generateQuotePdf = async (payload = {}) => {
  const html = generateAssembledHtml(payload)
  const puppeteer = require('puppeteer')
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  }

  const browser = await puppeteer.launch(launchOptions)
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 })
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
    })
    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}

module.exports = {
  QUOTE_STYLES,
  generateQuoteHtml,
  generateSowHtml,
  generateContractHtml,
  generateDrawingsHtml,
  generateAssembledHtml,
  generateQuotePdf,
}
