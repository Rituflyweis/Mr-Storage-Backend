const http = require('http')
const { Server } = require('socket.io')
const app = require('./app')
const connectDB = require('./src/config/db')
const initSocket = require('./src/services/socket/socket.server')
const { PORT, CLIENT_URL, NODE_ENV } = require('./src/config/env')

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: NODE_ENV === 'production' ? CLIENT_URL : '*',
    credentials: true,
  },
})

initSocket(io)

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT} (${NODE_ENV})`)
    console.log(`[Socket] /chat and /admin namespaces ready`)
  })
})
