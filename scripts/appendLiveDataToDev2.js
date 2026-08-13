// Copies every collection from the live Render "test" DB into the local "dev2" DB in APPEND mode:
// existing dev2 documents are left untouched; documents from "test" are inserted only if their
// _id doesn't already exist in dev2 (duplicate-key errors are caught and skipped, not overwritten).
const mongoose = require('mongoose')

const SOURCE_URI = 'mongodb+srv://aadith:aadith1234@cluster0.t0dus6t.mongodb.net/test?appName=Cluster0'
const TARGET_URI = 'mongodb+srv://node6_db_user:Uh4JOehFYfWrNkGH@cluster0.o1rkwxa.mongodb.net/dev2?appName=Cluster0'

async function run() {
  const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise()
  const targetConn = await mongoose.createConnection(TARGET_URI).asPromise()
  console.log('Source DB:', sourceConn.db.databaseName)
  console.log('Target DB:', targetConn.db.databaseName)

  const collections = await sourceConn.db.listCollections().toArray()
  const summary = []

  for (const { name } of collections) {
    if (name.startsWith('system.')) continue

    const sourceCol = sourceConn.db.collection(name)
    const targetCol = targetConn.db.collection(name)

    const docs = await sourceCol.find({}).toArray()
    if (!docs.length) {
      summary.push({ collection: name, source: 0, inserted: 0, skipped: 0 })
      continue
    }

    let inserted = 0
    let skipped = 0
    try {
      const result = await targetCol.insertMany(docs, { ordered: false })
      inserted = result.insertedCount
    } catch (err) {
      // BulkWriteError — some inserted, some failed on duplicate _id (E11000)
      inserted = err.result?.insertedCount ?? err.insertedDocs?.length ?? 0
      skipped = docs.length - inserted
    }

    summary.push({ collection: name, source: docs.length, inserted, skipped })
    console.log(`${name}: source=${docs.length} inserted=${inserted} skipped(existing)=${docs.length - inserted}`)
  }

  console.log('\n=== Summary ===')
  console.table(summary)

  await sourceConn.close()
  await targetConn.close()
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1) })
