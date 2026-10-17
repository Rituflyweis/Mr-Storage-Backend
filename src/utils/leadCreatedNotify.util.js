const Customer = require('../models/Customer')
const notificationService = require('../services/notification.service')

/** Notify every active admin when an inbound lead is created (website, form, chat, etc.). */
exports.notifyAdminsOfNewLead = async (lead, { source, customerId, inbound } = {}) => {
  if (!lead?._id || inbound !== true) return
  const src = source || lead.source || 'inbound'

  let customerName = ''
  const cid = customerId || lead.customerId
  if (cid) {
    const customer = await Customer.findById(cid).select('firstName lastName company email').lean()
    if (customer) {
      customerName =
        [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
        customer.company ||
        customer.email ||
        ''
    }
  }

  const projectLabel = lead.projectName || lead.jobId || 'New project'
  const body = customerName
    ? `${customerName} — ${projectLabel} (${src || 'inbound'})`
    : `${projectLabel} (${src || 'inbound'})`

  await notificationService.notifyRole('admin', {
    leadId: lead._id,
    type: 'lead',
    title: 'New lead received',
    body,
    priority: 'high',
    refId: lead._id,
    refModel: 'Lead',
  })
}
