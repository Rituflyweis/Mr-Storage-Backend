/**
 * Seeds the remaining Customer Panel mock data that the other seed scripts don't cover:
 *   - Bundles (for the QR Bundle Scan feature — these were being created ad-hoc and
 *     deleted during manual testing, so nothing persisted for customer1 to try against)
 *   - Notifications across every filter category (drawings/finance/meetings/system)
 *   - Chat messages across all 3 department channels (project/finance/construction)
 *   - Tasks + Milestones (for the "Project Tracking" tab)
 *   - Project Steps detail (PRO-001 only) — matches the Figma "Track Project lifecycle"
 *     screen exactly: Design/Fabrication/Dispatch completed with named approvers, Install
 *     in progress at 80% ("Wall Panel Installation"), Complete pending.
 *
 * Safe to re-run: each section skips a lead once it already has enough of that data type.
 * Usage: node scripts/seedCustomerMiscMock.js
 */
const mongoose = require('mongoose')
require('dotenv').config()

const Lead = require('../src/models/Lead')
const Customer = require('../src/models/Customer')
const Task = require('../src/models/Task')
const Milestone = require('../src/models/Milestone')
const User = require('../src/models/User')
const Bundle = require('../src/models/Bundle')
const ProjectStepDetail = require('../src/models/ProjectStepDetail')
const Delivery = require('../src/models/Delivery')
const Notification = require('../src/models/Notification')
const Message = require('../src/models/Message')

async function seedBundles(lead) {
  const existing = await Bundle.countDocuments({ leadId: lead._id })
  if (existing > 0) {
    console.log(`  [bundles] skip ${lead.jobId} — already has ${existing}`)
    return
  }

  const bundlePlanId = new mongoose.Types.ObjectId()
  const shipperRequestId = new mongoose.Types.ObjectId()
  const bundles = [
    { bundleNo: `${lead.jobId}-BND-001`, bundleType: 'panels', title: 'Roof Panels Bundle', status: 'assigned_to_truck', totalQty: 30, totalWeight: 3600, maxLengthFeet: 20 },
    { bundleNo: `${lead.jobId}-BND-002`, bundleType: 'trim', title: 'Trim & Flashing Bundle', status: 'staged', totalQty: 18, totalWeight: 1200, maxLengthFeet: 12 },
  ]

  for (const b of bundles) {
    await Bundle.create({
      bundlePlanId,
      leadId: lead._id,
      shipperRequestId,
      bundleNo: b.bundleNo,
      bundleType: b.bundleType,
      title: b.title,
      totalQty: b.totalQty,
      totalWeight: b.totalWeight,
      maxLengthFeet: b.maxLengthFeet,
      status: b.status,
      items: [{
        vendorQuoteLineId: new mongoose.Types.ObjectId(),
        partCode: 'STL-B12',
        description: b.title,
        qty: b.totalQty,
        weight: b.totalWeight,
      }],
    })
  }

  console.log(`  [bundles] seeded ${bundles.length} for ${lead.jobId} (scan IDs: ${bundles.map((b) => b.bundleNo).join(', ')})`)
}

async function seedNotifications(lead, customerId) {
  const existing = await Notification.countDocuments({ customerId, leadId: lead._id })
  if (existing >= 4) {
    console.log(`  [notifications] skip ${lead.jobId} — already has ${existing}`)
    return
  }

  const rows = [
    { title: 'New Drawing Updated', body: `A drawing was updated on ${lead.jobId}`, type: 'drawing', priority: 'medium' },
    { title: 'Invoice Sent', body: `A new invoice is ready for ${lead.jobId}`, type: 'payment', priority: 'high' },
    { title: 'Meeting Scheduled', body: `A project review meeting was scheduled for ${lead.jobId}`, type: 'meeting', priority: 'medium' },
    { title: 'Project Status Updated', body: `${lead.jobId} moved to the next stage`, type: 'system', priority: 'low' },
  ]

  await Notification.insertMany(rows.map((r) => ({ ...r, customerId, leadId: lead._id })))
  console.log(`  [notifications] seeded ${rows.length} (types: drawing/payment/meeting/system) for ${lead.jobId}`)
}

async function seedChat(lead, customerId, staffUser) {
  const existing = await Message.countDocuments({ leadId: lead._id })
  const channels = await Message.distinct('channel', { leadId: lead._id })
  if (existing >= 6 && channels.length >= 3) {
    console.log(`  [chat] skip ${lead.jobId} — already has ${existing} messages across ${channels.length} channels`)
    return
  }

  const rows = [
    { channel: 'project', senderType: 'customer', content: 'Hi team, any update on the drawing revisions?', customerId },
    { channel: 'project', senderType: 'sales', senderId: staffUser._id, senderName: staffUser.name, content: 'Revised drawings will be uploaded by tomorrow.', customerId },
    { channel: 'finance', senderType: 'customer', content: 'Can you resend the last invoice PDF?', customerId },
    { channel: 'finance', senderType: 'admin', senderId: staffUser._id, senderName: staffUser.name, content: 'Sent to your registered email just now.', customerId },
    { channel: 'construction', senderType: 'customer', content: 'When is the next delivery scheduled?', customerId },
    { channel: 'construction', senderType: 'admin', senderId: staffUser._id, senderName: staffUser.name, content: 'Next delivery is scheduled for next week, will confirm the exact date shortly.', customerId },
  ]

  await Message.insertMany(rows.map((r) => ({ ...r, leadId: lead._id })))
  console.log(`  [chat] seeded ${rows.length} messages across project/finance/construction for ${lead.jobId}`)
}

async function seedTracking(lead, staffUser) {
  const existingTasks = await Task.countDocuments({ leadId: lead._id })
  const existingMilestones = await Milestone.countDocuments({ leadId: lead._id })
  if (existingTasks >= 3 && existingMilestones >= 3) {
    console.log(`  [tracking] skip ${lead.jobId} — already has ${existingTasks} tasks / ${existingMilestones} milestones`)
    return
  }

  if (existingTasks < 3) {
    const tasks = [
      { title: 'Finalize structural drawings', status: 'done', priority: 'high' },
      { title: 'Order raw material for panels', status: 'in_progress', priority: 'medium' },
      { title: 'Schedule fabrication slot', status: 'todo', priority: 'medium' },
    ]
    await Task.insertMany(tasks.map((t) => ({ ...t, leadId: lead._id, createdBy: staffUser._id, completedAt: t.status === 'done' ? new Date() : null })))
  }

  if (existingMilestones < 3) {
    const milestones = [
      { title: 'Design approved', status: 'completed', order: 1, targetDate: new Date(Date.now() - 30 * 86400000), completedAt: new Date(Date.now() - 28 * 86400000) },
      { title: 'Fabrication complete', status: 'in_progress', order: 2, targetDate: new Date(Date.now() + 15 * 86400000) },
      { title: 'Site delivery', status: 'pending', order: 3, targetDate: new Date(Date.now() + 40 * 86400000) },
    ]
    await Milestone.insertMany(milestones.map((m) => ({ ...m, leadId: lead._id, createdBy: staffUser._id })))
  }

  console.log(`  [tracking] seeded tasks/milestones for ${lead.jobId}`)
}

// PRO-001 only — pushes the lead all the way to 'delivered' (Install bucket) with a
// realistic lifecycleHistory, then seeds ProjectStepDetail overlays matching the Figma
// "Track Project lifecycle" screen exactly: Design/Fabrication/Dispatch completed with
// named approvers, Install in progress at 80% ("Wall Panel Installation"), Complete pending.
const may12 = new Date('2025-05-12T10:00:00.000Z')
const may28 = new Date('2025-05-28T10:30:00.000Z')
const jun08 = new Date('2025-06-08T00:00:00.000Z')
const jul01 = new Date('2026-07-01T09:00:00.000Z')
const jul10 = new Date('2026-07-10T09:00:00.000Z')
const jul28 = new Date('2026-07-28T00:00:00.000Z')

// Different projects land on different steps so the frontend has variety to test against —
// not every project should look like the fully-progressed Figma demo.
const PROJECT_STEP_PLANS = {
  // PRO-001: pushed all the way to Install in progress @ 80% — matches the Figma screen exactly.
  'PRO-001': {
    lifecycleStatus: 'delivered',
    lifecycleHistory: [
      { stage: 'initial_contact', changedAt: new Date('2025-04-20T09:00:00.000Z') },
      { stage: 'bom_review', changedAt: may12 },
      { stage: 'quality_inspection', changedAt: may12 },
      { stage: 'dispatched', changedAt: may12 },
      { stage: 'delivered', changedAt: may28 },
    ],
    details: [
      { stepKey: 'design', completedBy: 'Sarah Lee', completedAt: may12 },
      { stepKey: 'fabrication', completedBy: 'Michael Smith', completedAt: may12 },
      { stepKey: 'dispatch', completedBy: 'David Brown', completedAt: may12 },
      {
        stepKey: 'install',
        startedBy: 'Installation Team', startedAt: may28,
        currentStage: 'Wall Panel Installation', completionPct: 80,
        expectedCompletion: jun08,
        notes: 'Installation is proceeding as per schedule.',
        attachments: [
          { name: 'Installation.pdf', url: 'https://example-bucket.s3.amazonaws.com/installation.pdf' },
          { name: 'Safety.pdf', url: 'https://example-bucket.s3.amazonaws.com/safety.pdf' },
        ],
      },
    ],
  },
  // PRO-002: mid-way — Design done, Fabrication in progress. Doesn't touch lifecycleStatus
  // (already 'quality_inspection', which is already in the Fabrication bucket) or history
  // beyond adding a design-stage entry so the "Completed on" date isn't null.
  'PRO-002': {
    lifecycleHistoryAppend: [{ stage: 'bom_review', changedAt: jul01 }],
    details: [
      { stepKey: 'design', completedBy: 'Priya Nair', completedAt: jul01 },
      {
        stepKey: 'fabrication',
        startedBy: 'Fabrication Team', startedAt: jul10,
        currentStage: 'Frame Assembly', completionPct: 45,
        expectedCompletion: jul28,
        notes: 'Frame assembly underway, on track for planned completion.',
        attachments: [{ name: 'Fabrication Plan.pdf', url: 'https://example-bucket.s3.amazonaws.com/fabrication-plan.pdf' }],
      },
    ],
  },
  // PRO-011: just started — Design in progress, nothing else touched yet.
  'PRO-011': {
    lead: { projectName: 'warehouse - Austin', location: 'Austin' },
    lifecycleHistoryAppend: [{ stage: 'initial_contact', changedAt: jul10 }],
    details: [
      {
        stepKey: 'design',
        startedBy: 'Design Team', startedAt: jul10,
        currentStage: 'Concept Drawings', completionPct: 20,
        expectedCompletion: jul28,
        notes: 'Initial concept drawings shared with customer for review.',
      },
    ],
  },
}

async function seedProjectSteps(lead) {
  const plan = PROJECT_STEP_PLANS[lead.jobId]
  if (!plan) return

  const existing = await ProjectStepDetail.countDocuments({ leadId: lead._id })
  if (existing >= plan.details.length) {
    console.log(`  [steps] skip ${lead.jobId} — already has ${existing} step details`)
    return
  }

  const leadUpdate = { ...(plan.lead || {}) }
  if (plan.lifecycleStatus) leadUpdate.lifecycleStatus = plan.lifecycleStatus
  if (plan.lifecycleHistory) leadUpdate.lifecycleHistory = plan.lifecycleHistory
  if (plan.lifecycleHistoryAppend) {
    const current = await Lead.findById(lead._id).select('lifecycleHistory').lean()
    leadUpdate.lifecycleHistory = [...(current.lifecycleHistory || []), ...plan.lifecycleHistoryAppend]
  }
  if (Object.keys(leadUpdate).length) await Lead.findByIdAndUpdate(lead._id, leadUpdate)

  for (const d of plan.details) {
    await ProjectStepDetail.findOneAndUpdate({ leadId: lead._id, stepKey: d.stepKey }, { $set: d }, { upsert: true })
  }

  console.log(`  [steps] seeded Project Steps detail for ${lead.jobId} (${plan.details.length} step records)`)
}

// Delivery Schedule extras: one unacknowledged reschedule (matches the "Delivery Rescheduled /
// Acknowledge" banner), one confirmation-email-sent delivery, one site+equipment-ready delivery.
async function seedDeliveryExtras(lead) {
  const deliveries = await Delivery.find({ leadId: lead._id }).select('_id deliveryNumber deliveryDate rescheduleHistory confirmationEmailSent status').lean()
  if (!deliveries.length) {
    console.log(`  [delivery-extras] skip ${lead.jobId} — no deliveries`)
    return
  }

  const alreadyRescheduled = deliveries.find((d) => d.rescheduleHistory?.length)
  if (alreadyRescheduled) {
    console.log(`  [delivery-extras] skip ${lead.jobId} — already has a rescheduled delivery`)
    return
  }

  const [rescheduleTarget, emailTarget, readinessTarget] = deliveries

  const previousDate = rescheduleTarget.deliveryDate || new Date()
  const newDate = new Date(new Date(previousDate).getTime() + 86400000)
  await Delivery.findByIdAndUpdate(rescheduleTarget._id, {
    status: 'rescheduled',
    deliveryDate: newDate,
    $push: {
      rescheduleHistory: {
        previousDate,
        date: newDate,
        timeWindowStart: '08:00',
        timeWindowEnd: '12:00',
        reason: 'Weather',
        acknowledged: false,
      },
    },
  })

  if (emailTarget && String(emailTarget._id) !== String(rescheduleTarget._id)) {
    await Delivery.findByIdAndUpdate(emailTarget._id, { confirmationEmailSent: true, confirmationEmailSentAt: new Date() })
  }

  if (readinessTarget && String(readinessTarget._id) !== String(rescheduleTarget._id)) {
    await Delivery.findByIdAndUpdate(readinessTarget._id, {
      'siteReadyConfirmation.confirmed': true,
      'siteReadyConfirmation.confirmedAt': new Date(),
      'siteReadyConfirmation.confirmedBy': 'Customer',
      'equipmentConfirmation.confirmed': true,
      'equipmentConfirmation.confirmedAt': new Date(),
    })
  }

  console.log(`  [delivery-extras] seeded reschedule (${rescheduleTarget.deliveryNumber}, unacknowledged)${emailTarget ? `, email-sent (${emailTarget.deliveryNumber})` : ''}${readinessTarget ? `, readiness-confirmed (${readinessTarget.deliveryNumber})` : ''} for ${lead.jobId}`)
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const customer = await Customer.findOne({ email: 'customer1@example.com' }).select('_id email').lean()
  if (!customer) throw new Error('customer1@example.com not found')

  const staffUser = await User.findOne({ email: 'admin@flyweis.test' }).select('_id name').lean()
  if (!staffUser) throw new Error('admin@flyweis.test not found')

  const leads = await Lead.find({ customerId: customer._id }).select('_id projectName jobId').lean()
  console.log(`Seeding bundles/notifications/chat for ${leads.length} project(s) owned by ${customer.email}`)

  for (const lead of leads) {
    await seedBundles(lead)
    await seedNotifications(lead, customer._id)
    await seedChat(lead, customer._id, staffUser)
    await seedTracking(lead, staffUser)
    await seedProjectSteps(lead)
    await seedDeliveryExtras(lead)
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
