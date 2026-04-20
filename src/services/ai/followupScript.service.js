const Anthropic = require('@anthropic-ai/sdk')
const env = require('../../config/env')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

/**
 * Generates a follow-up call script for a sales employee.
 * Called by GET /api/admin/followups/ai-script
 * Returns array of { followUpId, leadId, customerName, script }
 */
const generateScripts = async (followUpsWithContext) => {
  const results = []

  for (const item of followUpsWithContext) {
    try {
      const { followUp, customer, lead } = item

      const context = [
        `Customer: ${customer.firstName}`,
        `Building type: ${lead.buildingType || 'not specified'}`,
        `Location: ${lead.location || 'not specified'}`,
        `Lifecycle stage: ${lead.lifecycleStatus}`,
        lead.leadScoring?.requirements ? `Project summary: ${lead.leadScoring.requirements}` : '',
        lead.aiContextSummary ? `Last conversation summary: ${lead.aiContextSummary}` : '',
        followUp.notes ? `Follow-up notes: ${followUp.notes}` : '',
        `Priority: ${followUp.priority}`,
      ].filter(Boolean).join('\n')

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: 'You write concise outbound call scripts for construction sales reps. Professional, warm, and direct. Plain text only. 5–8 sentences max.',
        messages: [{
          role: 'user',
          content: `Write a follow-up call script for this lead:\n\n${context}\n\nThe script should: greet by name, reference their project, ask a specific relevant question, and end with a clear next step.`,
        }],
      })

      results.push({
        followUpId: followUp._id,
        leadId: lead._id,
        customerName: customer.firstName,
        script: response.content[0]?.text?.trim() || '',
      })
    } catch (err) {
      console.error('[FollowupScript] Failed for followUp:', item?.followUp?._id, err.message)
      results.push({
        followUpId: item?.followUp?._id,
        leadId: item?.lead?._id,
        customerName: item?.customer?.firstName || 'Unknown',
        script: '',
        error: 'Script generation failed',
      })
    }
  }

  return results
}

module.exports = { generateScripts }
