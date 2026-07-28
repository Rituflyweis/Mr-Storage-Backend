const TeamMessage = require('../../models/TeamMessage')
const { buildDirectKey } = require('../../models/TeamMessage')

const roomFor = (channelType, channelId, myId) =>
  channelType === 'department' ? `team_dept:${channelId}` : `team_direct:${buildDirectKey(myId, channelId)}`

const teamChatHandler = (socket, adminNS) => {
  const myId = socket.user._id

  socket.on('join_team_channel', ({ channelType, channelId }) => {
    if (!['department', 'direct'].includes(channelType) || !channelId) return
    socket.join(roomFor(channelType, channelId, myId))
  })

  socket.on('leave_team_channel', ({ channelType, channelId }) => {
    if (!['department', 'direct'].includes(channelType) || !channelId) return
    socket.leave(roomFor(channelType, channelId, myId))
  })

  socket.on('team_typing_start', ({ channelType, channelId }) => {
    if (!channelType || !channelId) return
    socket.to(roomFor(channelType, channelId, myId)).emit('team_typing', { isTyping: true, name: socket.user.name })
  })

  socket.on('team_typing_stop', ({ channelType, channelId }) => {
    if (!channelType || !channelId) return
    socket.to(roomFor(channelType, channelId, myId)).emit('team_typing', { isTyping: false })
  })

  socket.on('team_message', async ({ channelType, channelId, content }) => {
    if (!['department', 'direct'].includes(channelType) || !channelId || !content?.trim()) return

    try {
      const doc = {
        channelType,
        senderId: myId,
        senderName: socket.user.name || '',
        senderRole: socket.user.role || '',
        content: content.trim(),
        readBy: [myId],
      }

      if (channelType === 'department') {
        doc.department = channelId
      } else {
        doc.directKey = buildDirectKey(myId, channelId)
        doc.participants = [myId, channelId]
      }

      const message = await TeamMessage.create(doc)
      adminNS.to(roomFor(channelType, channelId, myId)).emit('new_team_message', message)

      if (channelType === 'direct') {
        adminNS.to(`user:${channelId}`).emit('new_team_dm_notice', { fromUserId: myId, fromName: socket.user.name, content: content.trim() })
      }
    } catch (err) {
      console.error('[TeamChatHandler] team_message error:', err.message)
      socket.emit('team_chat_error', { message: 'Something went wrong. Please try again.' })
    }
  })
}

module.exports = teamChatHandler
