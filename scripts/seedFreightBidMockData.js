const mongoose = require('mongoose')
const crypto = require('crypto')
require('dotenv').config()
const FreightBid = require('../src/models/FreightBid')
const FreightCarrier = require('../src/models/FreightCarrier')
const Delivery = require('../src/models/Delivery')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const carriers = await FreightCarrier.find().lean()
  if (carriers.length < 1) { console.log('No carriers found'); process.exit(1) }

  const deliveries = await Delivery.find().select('_id deliveryNumber').lean()
  const existingBidDeliveryIds = new Set((await FreightBid.distinct('deliveryId')).map(String))
  const freeDeliveries = deliveries.filter(d => !existingBidDeliveryIds.has(String(d._id)))

  if (freeDeliveries.length < 4) { console.log('Not enough free deliveries'); process.exit(1) }

  const mockBids = [
    { delivery: freeDeliveries[0], carrier: carriers[0], amount: 6500, monthsAgo: 0 },
    { delivery: freeDeliveries[1], carrier: carriers[carriers.length > 1 ? 1 : 0], amount: 9200, monthsAgo: 1 },
    { delivery: freeDeliveries[2], carrier: carriers[0], amount: 4750, monthsAgo: 2 },
    { delivery: freeDeliveries[3], carrier: carriers[carriers.length > 1 ? 1 : 0], amount: 11000, monthsAgo: 0 },
  ]

  for (const m of mockBids) {
    const now = new Date()
    const selectedAt = new Date(now.getFullYear(), now.getMonth() - m.monthsAgo, 15)
    const bid = await FreightBid.create({
      deliveryId: m.delivery._id,
      carrierId: m.carrier._id,
      token: crypto.randomBytes(32).toString('hex'),
      status: 'selected',
      quotedAmount: m.amount,
      submittedAt: selectedAt,
      sentAt: selectedAt,
      selectedAt,
      createdAt: selectedAt,
    })
    // createdAt is auto-managed by timestamps; force it to the intended mock month for trend testing
    await FreightBid.updateOne({ _id: bid._id }, { $set: { createdAt: selectedAt } })

    await Delivery.updateOne({ _id: m.delivery._id }, { $set: { selectedCarrierBidId: bid._id, status: 'confirmed' } })

    console.log(`Created bid for ${m.delivery.deliveryNumber} -> ${m.carrier.carrierName} | $${m.amount} | ${selectedAt.toISOString().slice(0, 7)}`)
  }

  console.log('\nDone.')
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1) })
