const messageSource = (origin) => {
  if (origin === 'messenger') return { source: 'facebook', sourceLabel: 'Facebook' }
  if (origin === 'meta_lead') return { source: 'facebook_lead_ad', sourceLabel: 'Meta lead ad' }
  if (origin === 'call') return { source: 'phone', sourceLabel: 'Phone' }
  return { source: 'website', sourceLabel: 'Website' }
}

const withMessageSource = (message) => {
  if (!message) return message
  const origin = message.origin || 'chat'
  return { ...message, origin, ...messageSource(origin) }
}

module.exports = { messageSource, withMessageSource }
