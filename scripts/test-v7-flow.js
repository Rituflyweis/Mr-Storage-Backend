/* eslint-disable no-console */
/**
 * v7 end-to-end FLOW test (no live DB).
 * Stubs the Mongoose models with an in-memory store and puppeteer with a no-op,
 * then drives the real controllers with fake req/res to validate the full
 * request → controller → engine → response contract and capture payloads.
 *   node scripts/test-v7-flow.js
 */
const path = require('path')
const Module = require('module')

/* ---- stub puppeteer so document/pdf modules load ---- */
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'puppeteer') {
    return {
      launch: async () => ({
        newPage: async () => ({ setContent: async () => {}, pdf: async () => Buffer.from('%PDF-stub') }),
        close: async () => {},
      }),
    }
  }
  return origLoad.apply(this, arguments)
}

/* ---- in-memory fake Mongoose model ---- */
let _id = 1
const nextId = () => 'id_' + _id++
const clone = (o) => JSON.parse(JSON.stringify(o))

function makeModel() {
  const store = []
  const matches = (doc, filter) =>
    Object.entries(filter || {}).every(([k, v]) => {
      if (v && typeof v === 'object' && v.$lte !== undefined) return doc[k] <= v.$lte
      return String(doc[k]) === String(v)
    })
  const wrap = (raw) => {
    if (!raw) return null
    const doc = clone(raw)
    doc.toObject = () => clone(raw)
    doc.save = async function () {
      const i = store.findIndex((d) => String(d._id) === String(raw._id))
      const plain = {}
      Object.keys(this).forEach((k) => { if (typeof this[k] !== 'function') plain[k] = this[k] })
      if (i >= 0) store[i] = clone(plain)
      else store.push(clone(plain))
      return this
    }
    return doc
  }
  const arrQuery = (getter) => ({
    sort() { return this }, select() { return this }, lean() { this._l = true; return this },
    then(res, rej) { try { res(getter().map(clone)) } catch (e) { rej(e) } },
  })
  const oneQuery = (getter) => ({
    _l: false,
    lean() { this._l = true; return this }, select() { return this },
    then(res, rej) { try { const r = getter(); res(this._l ? (r ? clone(r) : null) : wrap(r)) } catch (e) { rej(e) } },
  })
  const M = {
    __store: store,
    async create(obj) { const rec = clone(obj); rec._id = rec._id || nextId(); store.push(rec); return wrap(rec) },
    find(filter) { return arrQuery(() => store.filter((d) => matches(d, filter))) },
    findOne(filter) { return oneQuery(() => store.find((d) => matches(d, filter)) || null) },
    findById(id) { return oneQuery(() => store.find((d) => String(d._id) === String(id)) || null) },
    async findOneAndUpdate(filter, update, opts) {
      let rec = store.find((d) => matches(d, filter))
      if (!rec) { if (!(opts && opts.upsert)) return null; rec = {}; rec._id = nextId(); store.push(rec) }
      Object.assign(rec, clone(update))
      return wrap(rec)
    },
    async findOneAndDelete(filter) {
      const i = store.findIndex((d) => matches(d, filter)); if (i < 0) return null
      const [r] = store.splice(i, 1); return wrap(r)
    },
    async deleteOne(filter) { const i = store.findIndex((d) => matches(d, filter)); if (i >= 0) store.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 } },
  }
  return M
}

/* ---- seed fakes into require.cache BEFORE requiring controllers ---- */
const stub = (relFromSrc, exportsObj) => {
  const abs = path.join(__dirname, '..', 'src', relFromSrc)
  require.cache[require.resolve(abs)] = { id: abs, filename: abs, loaded: true, exports: exportsObj }
}
// models resolve to real files; replace their exports with fakes
const ChangeOrder = makeModel()
const CustomQuote = makeModel()
const SavedQuote = makeModel()
const EstimateQuote = makeModel()
const User = makeModel()
stub('models/ChangeOrder.js', ChangeOrder)
stub('models/CustomQuote.js', CustomQuote)
stub('models/SavedQuote.js', SavedQuote)
stub('models/EstimateQuote.js', EstimateQuote)
stub('models/User.js', User)

/* seed an estimate + a couple of users */
EstimateQuote.__store.push({
  _id: 'EST1', createdBy: 'U1', leadCompanyName: 'Acme Steel Co',
  cityStateZip: 'Omaha, NE 68102', buildingSize: '60x120x16', jobNumber: 'J-1001',
  totalSell: 500000, fullQuoteResult: { grandTotal: 512500 }, companyBrand: 'SM',
})
User.__store.push({ _id: 'U1', name: 'Travis', role: 'admin', email: 'travis@sm.com', isActive: true })
User.__store.push({ _id: 'U2', name: 'Casey', role: 'sales', email: 'casey@sm.com', isActive: true })

/* ---- fake req/res ---- */
const run = async (handler, req) => {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(body) { resolve({ status: this.statusCode, body }); return this },
    }
    Promise.resolve(handler({ user: { _id: 'U1', name: 'Travis', role: 'admin' }, params: req.params || {}, query: req.query || {}, body: req.body || {} }, res, reject)).catch(reject)
  })
}

const coCtrl = require('../src/controllers/sales/changeOrder.controller')
const cqCtrl = require('../src/controllers/sales/customQuote.controller')
const exCtrl = require('../src/controllers/sales/quotingExtras.controller')
const qsCtrl = require('../src/controllers/sales/quotesStore.controller')

const log = (title, obj) => {
  console.log('\n### ' + title)
  console.log(JSON.stringify(obj, null, 2))
}

;(async () => {
  let r

  // 1) Change order: preview → create → list → pdf(html)
  r = await run(coCtrl.previewChangeOrder, { body: { origVal: 512500, amount: 15000, cost: 11000 } })
  log('POST /change-orders/preview', r)

  r = await run(coCtrl.createChangeOrder, { body: { estimateId: 'EST1', customer: 'Acme Steel Co', origDate: 'June 1, 2026', amount: 15000, cost: 11000, description: 'Added one 30x50 bay + upgraded roof panel' } })
  log('POST /change-orders (create)', r)
  const coId = r.body.data._id

  r = await run(coCtrl.listChangeOrders, { query: { estimateId: 'EST1' } })
  log('GET /change-orders?estimateId=EST1', r)

  r = await run(coCtrl.generateChangeOrderPdf, { params: { coId }, body: { format: 'html' } })
  log('POST /change-orders/:coId/pdf (format=html → htmlLength)', { status: r.status, htmlLength: r.body.data.html.length })

  // 2) Custom quote: preview → create → list
  r = await run(cqCtrl.previewCustomQuote, { body: { matCost: 100000, freight: 5000, laborCost: 20000, marginPct: 20 } })
  log('POST /custom-quotes/preview', r)

  r = await run(cqCtrl.createCustomQuote, { body: { customer: 'Bluebird LLC', location: 'Lincoln, NE', size: '40x60x14', scope: 'both', expDays: 15, matCost: 100000, freight: 5000, laborCost: 20000, marginPct: 20, inclusions: ['PEMB kit', 'Delivery'], exclusions: ['Concrete', 'Permits'], sow: { overview: 'Supply + erect', delivery: '8-10 weeks', terms: 'Net 30' } } })
  log('POST /custom-quotes (create)', { status: r.status, id: r.body.data._id, sell: r.body.data.sell, profit: r.body.data.profit, profPct: r.body.data.profPct })

  // 3) Deposit + milestones previews
  r = await run(exCtrl.previewDeposit, { body: { grand: 512500, pct: 30 } })
  log('POST /estimates/deposit/preview', r)
  r = await run(exCtrl.previewMilestones, { body: { grand: 500000, rows: [{ label: 'Deposit', amount: 150000 }, { label: 'Fabrication', amount: 200000 }, { label: 'Delivery', amount: 150000 }] } })
  log('POST /estimates/milestones/preview', r)
  r = await run(exCtrl.previewStaircase, { body: { count: 2, unitCost: 35000, stories: 2 } })
  log('POST /estimates/staircase/preview', r)

  // 4) Persist deposit + milestones on estimate
  r = await run(exCtrl.updateEstimateDeposit, { params: { estimateId: 'EST1' }, body: { pct: 40, note: 'Wire to acct 1234' } })
  log('PUT /estimates/:id/deposit', r)
  r = await run(exCtrl.updateEstimateMilestones, { params: { estimateId: 'EST1' }, body: { rows: [{ label: 'Deposit', amount: 200000 }, { label: 'Balance', amount: 312500 }] } })
  log('PUT /estimates/:id/milestones', r)

  // 5) Users roster
  r = await run(exCtrl.listQuotingUsers, {})
  log('GET /estimates/users', r)

  // 6) Quotes store (history) write → read
  await run(qsCtrl.putQuote, { params: { id: '1730000000001' }, body: { id: '1730000000001', employee_name: 'Travis', customer: 'Acme Steel Co', grand_total: 512500, profit: 120000, sf: 7200, status: 'Draft', updated_at: '2026-10-27T12:00:00Z', state_data: { jobType: 'PEMB', customer: 'Acme Steel Co', grandTotal: 512500 } } })
  r = await run(qsCtrl.getQuotes, {})
  log('GET /quotes-store/quotes (after PUT)', { status: r.status, keys: Object.keys(r.body), sample: r.body[Object.keys(r.body)[0]] })

  console.log('\nFLOW TEST COMPLETE — all handlers returned responses.')
})().catch((e) => { console.error('FLOW ERROR:', e); process.exit(1) })
