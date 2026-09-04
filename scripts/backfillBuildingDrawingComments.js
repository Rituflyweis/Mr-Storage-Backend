// One-time backfill: adds comments: [] to every Building.drawings subdocument that predates the
// comments field (added for Plant<->Customer drawing comment parity). Additive only — never
// touches existing comments/status/other fields.
require('dotenv').config()
const mongoose = require('mongoose')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const result = await mongoose.connection.db.collection('buildings').updateMany(
    {},
    { $set: { 'drawings.$[elem].comments': [] } },
    { arrayFilters: [{ 'elem.comments': { $exists: false } }] }
  )
  console.log('Buildings matched:', result.matchedCount, '| modified:', result.modifiedCount)
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
