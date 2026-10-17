/** Customer AR invoice — document links for account UI (payments / invoices tables). */

const resolvePaymentProofUrl = (invoice) => {
  const files = invoice?.paymentProof?.files
  if (!Array.isArray(files) || !files.length) return ''
  return files[0]?.url || ''
}

exports.buildCustomerInvoicePdfPath = (invoiceId) =>
  `/api/account/invoices/${invoiceId}/pdf`

/**
 * @returns {{ documentUrl: string, pdfUrl: string, documentType: 'payment_proof'|'generated_pdf'|null }}
 */
exports.resolveCustomerInvoiceDocuments = (invoice) => {
  const invoiceId = invoice._id || invoice.invoiceId
  const proofUrl = resolvePaymentProofUrl(invoice)
  const pdfPath = invoiceId ? exports.buildCustomerInvoicePdfPath(invoiceId) : ''

  if (proofUrl) {
    return {
      documentUrl: proofUrl,
      pdfUrl: pdfPath,
      documentType: 'payment_proof',
    }
  }

  if (invoiceId && ['sent', 'paid', 'overdue'].includes(invoice.status)) {
    return {
      documentUrl: pdfPath,
      pdfUrl: pdfPath,
      documentType: 'generated_pdf',
    }
  }

  return {
    documentUrl: pdfPath || '',
    pdfUrl: pdfPath || '',
    documentType: pdfPath ? 'generated_pdf' : null,
  }
}
