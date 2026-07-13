const Invoice = require('../../models/Invoice')
const PaymentSchedule = require('../../models/PaymentSchedule')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const { buildDateFilter } = require('../../utils/dateRange')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getPaymentOverview = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')

  const [invoices, schedules] = await Promise.all([
    Invoice.find(dateFilter)
      .select('status totalAmount leadId paymentScheduleStageId date daysToPay paidAt')
      .populate('leadId', 'projectName jobId location customerId')
      .lean(),
    PaymentSchedule.find({}).lean(),
  ])

  const totalOrderValue = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalReceived = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
  const outstanding = invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.totalAmount, 0)

  const depositInvs = invoices.filter((i) => i.paymentScheduleStageId)
  const allStages = schedules.flatMap((s) => s.stages || [])
  const stageMap = {}
  for (const st of allStages) stageMap[String(st._id)] = st.stageName?.toLowerCase() || ''

  const deposit = { total: 0, received: 0 }
  const progress = { total: 0, received: 0 }
  const final = { total: 0, received: 0 }

  for (const inv of invoices) {
    const stageName = inv.paymentScheduleStageId
      ? stageMap[String(inv.paymentScheduleStageId)] || ''
      : ''

    const bucket = stageName.includes('deposit') || stageName.includes('advance')
      ? deposit
      : stageName.includes('progress') || stageName.includes('milestone')
      ? progress
      : final

    bucket.total += inv.totalAmount
    if (inv.status === 'paid') bucket.received += inv.totalAmount
  }

  const pct = (rec, tot) => (tot > 0 ? Math.round((rec / tot) * 100 * 10) / 10 : 0)

  const now = new Date()
  const clientMap = {}
  for (const inv of invoices) {
    const key = String(inv.leadId?._id || inv.leadId)
    if (!clientMap[key]) {
      clientMap[key] = {
        leadId: inv.leadId?._id,
        projectName: inv.leadId?.projectName || '',
        jobId: inv.leadId?.jobId || '',
        totalInvoiced: 0,
        received: 0,
        outstanding: 0,
      }
    }
    clientMap[key].totalInvoiced += inv.totalAmount
    if (inv.status === 'paid') clientMap[key].received += inv.totalAmount
    else clientMap[key].outstanding += inv.totalAmount
  }

  return success(res, {
    summary: { totalOrderValue, totalReceived, outstanding },
    depositPayments: {
      percentage: pct(deposit.received, deposit.total),
      totalAmount: deposit.total,
      received: deposit.received,
      pending: deposit.total - deposit.received,
    },
    progressPayments: {
      percentage: pct(progress.received, progress.total),
      totalAmount: progress.total,
      received: progress.received,
      pending: progress.total - progress.received,
    },
    finalPayments: {
      percentage: pct(final.received, final.total),
      totalAmount: final.total,
      received: final.received,
      pending: final.total - final.received,
    },
    clientBreakdown: Object.values(clientMap),
    invoices: invoices.map((inv) => ({
      invoiceId: inv._id,
      invoiceNumber: inv.invoiceNumber || '',
      amount: inv.totalAmount,
      paymentDate: inv.paidAt,
      status: inv.status,
      project: {
        leadId: inv.leadId?._id,
        projectName: inv.leadId?.projectName,
        jobId: inv.leadId?.jobId,
      },
    })),
  })
})

exports.getOrdersAndPayments = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const scheduleFilter = {}

  const [schedules, total] = await Promise.all([
    PaymentSchedule.find(scheduleFilter)
      .populate({
        path: 'leadId',
        select: 'projectName jobId location lifecycleStatus customerId',
        populate: { path: 'customerId', select: 'firstName lastName email' },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PaymentSchedule.countDocuments(scheduleFilter),
  ])

  const leadIds = schedules.map((s) => s.leadId?._id).filter(Boolean)
  const invoices = await Invoice.find({ leadId: { $in: leadIds } })
    .select('leadId totalAmount status paymentScheduleStageId')
    .lean()

  const invByLead = {}
  for (const inv of invoices) {
    const key = String(inv.leadId)
    if (!invByLead[key]) invByLead[key] = []
    invByLead[key].push(inv)
  }

  const rows = schedules.map((sched) => {
    const key = String(sched.leadId?._id)
    const leadInvs = invByLead[key] || []
    const totalReceived = leadInvs.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
    const totalInvoiced = leadInvs.reduce((s, i) => s + i.totalAmount, 0)
    const outstanding = totalInvoiced - totalReceived

    const stages = sched.stages || []
    const deposit = stages.find((s) => s.stageName?.toLowerCase().includes('deposit'))
    const progressStages = stages.filter((s) => s.stageName?.toLowerCase().includes('progress'))
    const finalStage = stages.find((s) => s.stageName?.toLowerCase().includes('final'))

    const customer = sched.leadId?.customerId
    const customerName = customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : ''

    return {
      scheduleId: sched._id,
      leadId: sched.leadId?._id,
      projectName: sched.leadId?.projectName,
      jobId: sched.leadId?.jobId,
      location: sched.leadId?.location,
      customerName,
      orderValue: sched.totalAmount,
      currentCost: totalInvoiced,
      outstanding,
      totalReceived,
      wipProfit: totalReceived - (totalInvoiced - outstanding),
      lifecycleStatus: sched.leadId?.lifecycleStatus,
      paymentBreakdown: {
        deposit: deposit ? { amount: deposit.amount, status: deposit.status } : null,
        progress: progressStages.map((s) => ({ stageName: s.stageName, amount: s.amount, status: s.status })),
        final: finalStage ? { amount: finalStage.amount, status: finalStage.status } : null,
      },
    }
  })

  const allSchedules = await PaymentSchedule.find({}).lean()
  const totalOrderValue = allSchedules.reduce((s, p) => s + (p.totalAmount || 0), 0)
  const totalLeadInvs = await Invoice.find({}).select('status totalAmount').lean()
  const totalReceived = totalLeadInvs.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
  const totalOutstanding = totalLeadInvs.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.totalAmount, 0)

  return success(res, {
    summary: {
      totalOrderValue,
      totalReceived,
      outstanding: totalOutstanding,
      totalWipProfit: totalReceived,
    },
    orders: rows,
    total,
  })
})
