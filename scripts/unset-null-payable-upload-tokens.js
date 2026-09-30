/**
 * Sparse unique indexes treat explicit null as a value — only one row could have
 * payableUploadToken: null. Safe to re-run.
 *
 * Run: node scripts/unset-null-payable-upload-tokens.js
 */

require('../src/config/env')
const connectDB = require('../src/config/db')
const mongoose = require('mongoose')
const ShipperRequest = require('../src/models/ShipperRequest')
const FreightBid = require('../src/models/FreightBid')

const run = async () => {
  await connectDB()

  const shipper = await ShipperRequest.updateMany(
    { payableUploadToken: null },
    { $unset: { payableUploadToken: '' } }
  )
  console.log(
    `[migrate] ShipperRequest payableUploadToken null → unset — matched: ${shipper.matchedCount}, modified: ${shipper.modifiedCount}`
  )

  const bids = await FreightBid.updateMany(
    { payableUploadToken: null },
    { $unset: { payableUploadToken: '' } }
  )
  console.log(
    `[migrate] FreightBid payableUploadToken null → unset — matched: ${bids.matchedCount}, modified: ${bids.modifiedCount}`
  )

  await mongoose.disconnect()
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
