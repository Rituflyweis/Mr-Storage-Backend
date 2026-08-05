const Lead = require('../models/Lead')
const FollowUp = require('../models/FollowUp')
const ProjectBudget = require('../models/ProjectBudget')
const { enrichLeadDocument, withProjectIdFields } = require('../utils/leadProjectId')
const { mapLeadByScoreRow } = require('../utils/leadQueryFilter')

const getIo = () => global.io?.of('/admin')

const getLeadForAdminList = async (leadId, { includeDeleted = false } = {}) => {
  const lead = await Lead.findById(leadId)
    .populate('customerId')
    .populate('assignedSales')
    .setOptions({ includeDeleted })
    .lean()
  if (!lead) return null

  const budget = await ProjectBudget.findOne({ leadId })
    .select('totalBudget')
    .lean()

  return enrichLeadDocument({
    ...lead,
    budget: budget
      ? {
        totalBudget: budget.totalBudget,
        expectedProfit: (lead.quoteValue || 0) - (budget.totalBudget || 0),
      }
      : null,
  })
}

const getLeadForSalesList = async (leadId, { includeDeleted = false } = {}) => {
  const lead = await Lead.findById(leadId)
    .select('_id jobId projectName customerId lifecycleStatus quoteValue leadScoring buildingType location isRaisedToPO assignedSales isOnline onlineAt lastSeenAt isDeleted')
    .populate({ path: 'customerId', select: 'firstName email isOnline onlineAt lastSeenAt' })
    .setOptions({ includeDeleted })
    .lean()
  if (!lead) return null

  const nextFollowUp = await FollowUp.findOne({ leadId, status: 'pending' })
    .select('_id leadId followUpDate notes priority')
    .sort({ followUpDate: 1 })
    .lean()

  return withProjectIdFields({
    _id: lead._id,
    projectName: lead.projectName || '',
    customerId: lead.customerId
      ? {
        _id: lead.customerId._id,
        firstName: lead.customerId.firstName || '',
        email: lead.customerId.email || '',
        isOnline: lead.customerId.isOnline === true,
        onlineAt: lead.customerId.onlineAt || null,
        lastSeenAt: lead.customerId.lastSeenAt || null,
      }
      : null,
    isOnline: lead.isOnline === true,
    onlineAt: lead.onlineAt || null,
    lastSeenAt: lead.lastSeenAt || null,
    lifecycleStatus: lead.lifecycleStatus,
    quoteValue: lead.quoteValue || 0,
    leadScoring: { score: lead.leadScoring?.score || 0 },
    buildingType: lead.buildingType || '',
    location: lead.location || '',
    isRaisedToPO: lead.isRaisedToPO === true,
    nextFollowUp: nextFollowUp
      ? {
        _id: nextFollowUp._id,
        followUpDate: nextFollowUp.followUpDate,
        notes: nextFollowUp.notes,
        priority: nextFollowUp.priority,
      }
      : null,
  }, lead.jobId)
}

const getScoreRow = async (leadId) => {
  const lead = await Lead.findById(leadId)
    .populate({ path: 'customerId', select: 'firstName email customerId' })
    .select('_id jobId projectName location lifecycleStatus lifecycleHistory quoteValue leadScoring updatedAt')
    .lean()
  if (!lead) return null
  return mapLeadByScoreRow(lead)
}

const emitLeadListCreated = async (leadId, options = {}) => {
  const io = getIo()
  if (!io) return

  const { trigger = 'created', includeScoreRow = false } = options
  const adminLead = await getLeadForAdminList(leadId)
  if (!adminLead) return

  const payload = {
    leadId,
    lead: adminLead,
    meta: { action: 'created', trigger },
  }
  if (includeScoreRow) payload.scoreRow = await getScoreRow(leadId)

  io.to('admin_room').emit('lead_list_created', payload)

  if (adminLead.assignedSales?._id) {
    const salesLead = await getLeadForSalesList(leadId)
    if (salesLead) {
      io.to(`user:${adminLead.assignedSales._id}`).emit('lead_list_created', {
        leadId,
        lead: salesLead,
        scoreRow: payload.scoreRow || null,
        meta: { action: 'created', trigger },
      })
    }
  }
}

// const emitLeadListUpdated = async (leadId, options = {}) => {
//   const io = getIo()
//   if (!io) return

//   const { trigger = 'updated', includeScoreRow = false } = options
//   const adminLead = await getLeadForAdminList(leadId)
//   if (!adminLead) return

//   const payload = {
//     leadId,
//     lead: adminLead,
//     meta: { action: 'updated', trigger },
//   }
//   if (includeScoreRow) payload.scoreRow = await getScoreRow(leadId)

//   io.to('admin_room').emit('lead_list_updated', payload)

//   if (adminLead.assignedSales?._id) {
//     const salesLead = await getLeadForSalesList(leadId)
//     if (salesLead) {
//       io.to(`user:${adminLead.assignedSales._id}`).emit('lead_list_updated', {
//         leadId,
//         lead: salesLead,
//         scoreRow: payload.scoreRow || null,
//         meta: { action: 'updated', trigger },
//       })
//     }
//   }
// }

const emitLeadListUpdated = async (leadId, options = {}) => {
  const io = getIo()
  if (!io) return

  const {
    trigger = 'updated',
    includeScoreRow = false,
    notifySales = true,
  } = options

  // Soft-deleted leads are hidden by default; include them so clients can remove the row
  const includeDeleted = trigger === 'deleted'
  const adminLead = await getLeadForAdminList(leadId, { includeDeleted })
  if (!adminLead) return

  const payload = {
    leadId,
    lead: adminLead,
    meta: {
      action: includeDeleted ? 'deleted' : 'updated',
      trigger,
    },
  }

  if (includeScoreRow && !includeDeleted) {
    payload.scoreRow = await getScoreRow(leadId)
  }

  // Always notify admin panel
  io.to('admin_room').emit('lead_list_updated', payload)

  // Notify assigned sales only when required
  if (notifySales && adminLead.assignedSales?._id) {
    const salesLead = await getLeadForSalesList(leadId, { includeDeleted })

    if (salesLead) {
      io.to(`user:${adminLead.assignedSales._id}`).emit(
        'lead_list_updated',
        {
          leadId,
          lead: salesLead,
          scoreRow: payload.scoreRow || null,
          meta: {
            action: includeDeleted ? 'deleted' : 'updated',
            trigger,
          },
        }
      )
    }
  }
}
module.exports = {
  emitLeadListCreated,
  emitLeadListUpdated,
}
