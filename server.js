const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const connectDB = require("./src/config/db");
const initSocket = require("./src/services/socket/socket.server");
const { PORT, NODE_ENV } = require("./src/config/env");
const {
  initFollowUpScheduler,
} = require("./src/utils/scheduler/followUpScheduler");
const { startAutomationRunner } = require("./src/services/followup/followUpAutomation.service");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true, // allow all origins (reflects request Origin header)
    credentials: true,
  },
});

initSocket(io);

connectDB().then(async () => {
  await initFollowUpScheduler(); // pending followups schedule
  startAutomationRunner();

  const customerPresence = require("./src/services/socket/customerPresence.service");
  await customerPresence.resetAllPresenceOnStartup();

  server.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT} (${NODE_ENV})`);
    console.log(`[Socket] /chat and /admin namespaces ready`);
  });
});
