const mongoose = require('mongoose')
const { MONGO_URI } = require('./env')

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI)
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
