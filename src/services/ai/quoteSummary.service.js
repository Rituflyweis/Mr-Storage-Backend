const Anthropic = require('@anthropic-ai/sdk')
const QuoteSummary = require('../../models/QuoteSummary')
const env = require('../../config/env')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

/**
 * Generates a plain-text AI summary of a quotation and saves it to QuoteSummary.
 * Call fire-and-forget after sending a quotation via email.
 */
const generateAndSave = async (quotation, leadId, customerId) => {
  try {
    const details = [
      `Building type: ${quotation.buildingType || 'N/A'}`,
      `Price range: ${quotation.currency || 'USD'} ${quotation.basePrice?.toLocaleString()} – ${quotation.maxPrice?.toLocaleString()}`,
      `Location: ${quotation.location || 'N/A'}`,
      `Size: ${quotation.sqft ? quotation.sqft + ' sqft' : [quotation.width, quotation.length, quotation.height].filter(Boolean).join(' x ') + ' ft' || 'N/A'}`,
      `Roof style: ${quotation.roofStyle || 'N/A'}`,
      `Valid until: ${quotation.validTill ? new Date(quotation.validTill).toDateString() : 'N/A'}`,
      `Payment terms: ${quotation.paymentTerms || 'N/A'}`,
      `Estimated delivery: ${quotation.estimatedDelivery || 'N/A'}`,
      quotation.includedMaterials?.length ? `Materials: ${quotation.includedMaterials.map(m => m.name).join(', ')}` : '',
      quotation.optionalAddOns?.length ? `Add-ons: ${quotation.optionalAddOns.map(a => a.name).join(', ')}` : '',
      quotation.specialNote ? `Special note: ${quotation.specialNote}` : '',
    ].filter(Boolean).join('\n')

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: 'You write brief plain-text summaries of construction quotations for a CRM. Be factual, concise, and clear. No markdown. Anyone reading this should understand the quote in 30 seconds.',
      messages: [{
        role: 'user',
        content: `Write a 3–5 sentence plain-text summary of this construction quotation:\n\n${details}`,
      }],
    })

    const summary = response.content[0]?.text?.trim()
    if (!summary) return

    await QuoteSummary.create({
      leadId,
      quotationId: quotation._id,
      customerId,
      summary,
      generatedAt: new Date(),
    })
  } catch (err) {
    console.error('[QuoteSummary] Generation failed:', err.message)
    // Fail silently
  }
}

module.exports = { generateAndSave }
