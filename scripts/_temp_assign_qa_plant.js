require('dotenv').config()
const mongoose = require('mongoose')
async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  const POOrder = require('../src/models/POOrder')
  const User = require('../src/models/User')
  const qaPlant = await User.findOne({ email: 'claude.qa.plant@internal-test.mrstorage.dev' })
  const po = await POOrder.findOne({ status: 'approved' }).sort({ createdAt: -1 })
  console.log('ORIGINAL_ASSIGNED_TO=' + po.assignedTo)
  console.log('PO_ID=' + po._id)
  po.assignedTo = qaPlant._id
  await po.save()
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
