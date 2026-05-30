const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const { computeInvoiceDueDate } = require('./invoiceDueDate')

const getEffectiveDueDate = (inv) => {
  if (inv.dueDate) return new Date(inv.dueDate)
  return computeInvoiceDueDate(inv.date, inv.daysToPay)
}

const isInvoiceOverdue = (inv, now = new Date()) => {
  if (!['sent', 'overdue'].includes(inv.status)) return false
  const due = getEffectiveDueDate(inv)
  if (!due) return false
  return due < now
}

/** null = all leads (admin); ObjectId[] = sales-scoped leads */
const getScopedLeadIds = async (user) => {
  if (user.role === 'admin') return null
  return Lead.find({ assignedSales: user._id }).distinct('_id')
}

const leadMatchesSearch = async (leadId, search) => {
  const regex = new RegExp(search.trim(), 'i')
  const matchingCustomerIds = await Customer.find({
    $or: [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { customerId: regex },
    ],
  }).distinct('_id')

  const lead = await Lead.findOne({
    _id: leadId,
    $or: [
      { projectName: regex },
      { customerId: { $in: matchingCustomerIds } },
    ],
  }).select('_id').lean()

  return Boolean(lead)
}

/**
 * Resolves which leadIds invoices may belong to (search + leadId + role scope).
 * Returns { leadIds: null | ObjectId[] } — null means no lead restriction (admin, no search/leadId).
 */
const resolveInvoiceLeadIds = async (user, { search, leadId } = {}) => {
  const scoped = await getScopedLeadIds(user)

  if (leadId) {
    if (scoped !== null && !scoped.some(id => String(id) === String(leadId))) {
      return { leadIds: [] }
    }
    if (search && search.trim()) {
      const matches = await leadMatchesSearch(leadId, search)
      return { leadIds: matches ? [leadId] : [] }
    }
    return { leadIds: [leadId] }
  }

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const matchingCustomerIds = await Customer.find({
      $or: [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { customerId: regex },
      ],
    }).distinct('_id')

    const leadFilter = {
      $or: [
        { projectName: regex },
        { customerId: { $in: matchingCustomerIds } },
      ],
    }
    if (scoped !== null) {
      leadFilter._id = { $in: scoped }
    }

    const matched = await Lead.find(leadFilter).distinct('_id')
    return { leadIds: matched }
  }

  return { leadIds: scoped }
}

module.exports = {
  getEffectiveDueDate,
  isInvoiceOverdue,
  getScopedLeadIds,
  resolveInvoiceLeadIds,
}
