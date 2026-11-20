const mongoose = require('mongoose')
const { MONGO_URI } = require('./env')

/**
 * The old unique index treated an empty facebookPsid as a value, so the second
 * customer with no Facebook id failed with E11000. Drop that index, clear blank
 * values, then build the partial unique index from the Customer schema.
 */
const repairFacebookPsidIndex = async () => {
  const Customer = require('../models/Customer')
  const coll = Customer.collection
  try {
    const indexes = await coll.indexes()
    const current = indexes.find((index) => index.name === 'facebookPsid_1')
    const isPartial = current?.partialFilterExpression?.facebookPsid?.$type === 'string'
    if (current && !isPartial) {
      await coll.dropIndex('facebookPsid_1')
      console.log('[DB] dropped non-partial facebookPsid index')
    }
    const cleared = await coll.updateMany(
      { facebookPsid: { $in: [null, ''] } },
      { $unset: { facebookPsid: '' } },
    )
    if (cleared.modifiedCount) {
      console.log(`[DB] cleared blank facebookPsid on ${cleared.modifiedCount} customers`)
    }
    const emailIndex = indexes.find((index) => index.name === 'email_1')
    const emailPartial = emailIndex?.partialFilterExpression?.email?.$type === 'string'
    if (emailIndex && !emailPartial) {
      await coll.dropIndex('email_1')
      console.log('[DB] dropped non-partial email index')
    }
    const clearedEmails = await coll.updateMany(
      { email: { $in: [null, ''] } },
      { $unset: { email: '' } },
    )
    if (clearedEmails.modifiedCount) {
      console.log(`[DB] cleared blank email on ${clearedEmails.modifiedCount} customers`)
    }
  } catch (err) {
    if (err.code !== 26 && err.codeName !== 'NamespaceNotFound') {
      console.warn('[DB] facebookPsid index repair:', err.message)
    }
  }
  await Customer.init()
}

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI)
    await repairFacebookPsidIndex()
    console.log('[DB] MongoDB connected')
  } catch (err) {
    console.error('[DB] Connection failed:', err.message)
    process.exit(1)
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[DB] MongoDB disconnected')
})

module.exports = connectDB
