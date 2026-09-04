const sgMail = require("@sendgrid/mail");
const nodemailer = require("nodemailer");
const {
  SENDGRID_API_KEY,
  SENDGRID_FROM,
  MAIL_FROM,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_MAIL_FROM,
  ADMIN_LOGIN_URL,
  SALES_LOGIN_URL,
  PLANT_LOGIN_URL,
} = require("../../config/env");
const { getInvoiceCompany } = require("../../config/invoiceCompany");
const { computeInvoiceDueDate } = require("../../utils/invoiceDueDate");
const path = require("path");
const fs = require("fs");
const { generateInvoicePdf } = require("./generateInvoiceHelper");
const {
  formatExceptionsForEmailHtml,
  formatExceptionsForEmailText,
} = require("../../utils/vendorUpload.util");
const {
  formatFreightLoadDetailsHtml,
  formatFreightLoadDetailsText,
} = require("../plant/freightLoadDetails.service");

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

const resolvedMailFrom = SENDGRID_FROM || MAIL_FROM;
// Temporary ops mode: keep delivery on SMTP only and skip SendGrid attempts.
const SENDGRID_ENABLED = false;

const isSmtpConfigured = () => Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const isEmailConfigured = () =>
  Boolean(isSmtpConfigured() && (SMTP_MAIL_FROM || MAIL_FROM));
const isEnquiryNotificationConfigured = () =>
  Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_MAIL_FROM);

const buildSmtpTransporter = ({ port, secure }) =>
  nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    family: 4,
    connectionTimeout: 15000,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

const smtpTransporter = isSmtpConfigured()
  ? buildSmtpTransporter({ port: SMTP_PORT, secure: SMTP_PORT === 465 })
  : null;

const smtpAltPort = SMTP_PORT === 465 ? 587 : 465;
const smtpAltTransporter = isSmtpConfigured()
  ? buildSmtpTransporter({
      port: smtpAltPort,
      secure: smtpAltPort === 465,
    })
  : null;

const enquiryTransporter = isEnquiryNotificationConfigured()
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      family: 4,
      connectionTimeout: 15000,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    })
  : null;

const normalizeAttachmentsForSendGrid = (attachments = []) =>
  attachments.map((attachment) => {
    const normalized = { ...attachment };
    if (Buffer.isBuffer(normalized.content)) {
      normalized.content = normalized.content.toString("base64");
    }
    if (!normalized.disposition) {
      normalized.disposition = "attachment";
    }
    return normalized;
  });

const transporter = {
  sendMail: async (mailOptions = {}) => {
    const payload = {
      ...mailOptions,
      from: mailOptions.from || resolvedMailFrom || SMTP_MAIL_FROM || MAIL_FROM,
    };

    const hasSendGrid = SENDGRID_ENABLED && Boolean(SENDGRID_API_KEY);
    const hasSmtp = Boolean(smtpTransporter);
    if (!hasSendGrid && !hasSmtp) {
      throw new Error(
        "Email service is not configured. Set SENDGRID_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS.",
      );
    }

    if (hasSendGrid) {
      try {
        const sgPayload = { ...payload };
        if (
          Array.isArray(sgPayload.attachments) &&
          sgPayload.attachments.length > 0
        ) {
          sgPayload.attachments = normalizeAttachmentsForSendGrid(
            sgPayload.attachments,
          );
        }
        await sgMail.send(sgPayload);
        return { provider: "sendgrid" };
      } catch (sendgridErr) {
        console.error(
          `[Mailer] SendGrid send failed, trying SMTP fallback: ${
            sendgridErr?.message || "unknown_sendgrid_error"
          }`,
        );
        if (!hasSmtp) {
          throw sendgridErr;
        }
      }
    }

    // Fallback path (or primary when SendGrid is unavailable).
    try {
      const smtpPayload = {
        ...payload,
        // SMTP providers (notably Gmail) may reject spoofed From addresses.
        // Prefer authenticated mailbox identity on SMTP sends.
        from: SMTP_MAIL_FROM || payload.from || MAIL_FROM,
      };
      await smtpTransporter.sendMail(smtpPayload);
      return { provider: "smtp_fallback" };
    } catch (smtpErr) {
      if (smtpAltTransporter) {
        try {
          console.warn(
            `[Mailer] SMTP primary failed on port ${SMTP_PORT}, trying alternate port ${smtpAltPort}: ${
              smtpErr?.message || "unknown_smtp_error"
            }`,
          );
          const altPayload = {
            ...payload,
            from: SMTP_MAIL_FROM || payload.from || MAIL_FROM,
          };
          await smtpAltTransporter.sendMail(altPayload);
          return { provider: "smtp_fallback_alt_port" };
        } catch (smtpAltErr) {
          throw new Error(
            `[Mailer] Email delivery failed on SMTP fallback: ${
              smtpAltErr?.message || smtpErr?.message || "unknown_smtp_error"
            }`,
          );
        }
      }
      throw new Error(
        `[Mailer] Email delivery failed on SMTP fallback: ${
          smtpErr?.message || "unknown_smtp_error"
        }`,
      );
    }
  },
};

const loadTemplate = (templateName) => {
  const filePath = path.join(__dirname, "templates", `${templateName}.html`);
  return fs.readFileSync(filePath, "utf-8");
};

/**
 * Replace {{KEY}} placeholders in template with values object
 */
const fillTemplate = (template, values = {}) => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
};

const escapeHtml = (str) => {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const formatMultilineAddressHtml = (lines = []) =>
  lines
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join("<br />");

const buildInvoiceCompanyTemplateFields = () => {
  const company = getInvoiceCompany();
  const detailLines = [
    formatMultilineAddressHtml(company.addressLines),
    company.email ? escapeHtml(company.email) : "",
    company.website ? escapeHtml(company.website) : "",
  ].filter(Boolean);

  const logoBlock = company.logoUrl
    ? `<img src="${escapeHtml(company.logoUrl)}" alt="${escapeHtml(company.name)}" class="logo" />`
    : `<div style="font-size:18px;font-weight:800;color:#111827;letter-spacing:0.5px;line-height:1.3;">${escapeHtml(company.name)}</div>`;

  return {
    LOGO_BLOCK: logoBlock,
    COMPANY_NAME: escapeHtml(company.name),
    COMPANY_DETAILS_HTML: detailLines.join("<br />"),
  };
};

const buildCustomerBillToAddressHtml = ({
  company = "",
  location = "",
} = {}) => {
  const lines = [
    String(company || "").trim(),
    String(location || "").trim(),
  ].filter(Boolean);
  if (!lines.length) return "";
  return formatMultilineAddressHtml(lines);
};

const buildCustomerAddressBlock = (customerAddressHtml) => {
  if (!customerAddressHtml) return "";
  return `<div class="customer-copy">${customerAddressHtml}</div>`;
};

const formatInvoiceMoney = (value) => {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const formatted = Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `$${formatted}`;
};

const formatInvoiceDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toDateString();
};

const normalizeInvoiceValueType = (type) =>
  String(type || "amount")
    .trim()
    .toLowerCase() === "percentage"
    ? "percentage"
    : "amount";

const formatInvoiceRateCell = (li) => {
  const effectiveRate = li.effectiveRate != null ? li.effectiveRate : li.rate;
  return formatInvoiceMoney(effectiveRate);
};

const formatInvoiceTaxCell = (li) => {
  const taxType = normalizeInvoiceValueType(li.taxType);
  const taxInput = li.tax;
  const taxAmount =
    li.taxAmount != null
      ? li.taxAmount
      : taxType === "amount"
        ? taxInput
        : null;

  if (taxType === "percentage" && taxInput != null && taxInput !== "") {
    const amountLine = taxAmount != null ? formatInvoiceMoney(taxAmount) : "—";
    return amountLine;
  }

  return formatInvoiceMoney(taxAmount != null ? taxAmount : taxInput);
};

const buildInvoiceLineItemsRows = (lineItems = []) => {
  if (!lineItems.length) {
    return '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px">No line items on this invoice</td></tr>';
  }

  return lineItems
    .map((li, index) => {
      const description =
        li.description && String(li.description).trim()
          ? escapeHtml(li.description)
          : (li.items || []).filter(Boolean).map(escapeHtml).join("<br/>") ||
            "—";
      const images = (li.images || []).filter(Boolean);
      const imagesHtml = images.length
        ? `<div style="margin-top:6px;font-size:11px">${images
            .map(
              (url, i) =>
                `<a href="${escapeHtml(url)}" style="color:#1a2e4a" target="_blank" rel="noopener">Image ${i + 1}</a>`,
            )
            .join(" · ")}</div>`
        : "";

      return `<tr>
        <td style="padding:10px 6px;border-bottom:1px solid #eee;vertical-align:top;color:#666">${index + 1}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${description}${imagesHtml}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatInvoiceRateCell(li)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;vertical-align:top">${li.quantity ?? "—"}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatInvoiceTaxCell(li)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;vertical-align:top">${formatInvoiceMoney(li.total)}</td>
      </tr>`;
    })
    .join("");
};

const buildInvoiceTotalsRows = (invoice) => {
  const rows = [
    ["Subtotal", invoice.subtotal, false],
    ["Discount", invoice.discount, true],
    ["Tax", invoice.tax, false],
    ["Deposit", invoice.depositAmount, false],
    ["Total due", invoice.totalAmount, false],
  ];

  return rows
    .map(([label, amount, isDiscount], i) => {
      const isGrand = i === rows.length - 1;
      const rowClass = isGrand ? ' class="grand"' : "";
      const labelStyle = isGrand
        ? "text-align:right;color:#1a2e4a;font-weight:700;padding:10px 8px 6px"
        : "text-align:right;color:#666;padding:6px 8px";
      const valueStyle = isGrand
        ? "text-align:right;font-weight:700;font-size:18px;color:#1a2e4a;width:120px;padding:10px 8px 6px"
        : "text-align:right;font-weight:600;width:120px;padding:6px 8px";
      const displayAmount =
        isDiscount && amount != null && Number(amount) !== 0
          ? `−${formatInvoiceMoney(amount)}`
          : formatInvoiceMoney(amount);
      return `<tr${rowClass}>
          <td style="${labelStyle}">${label}</td>
          <td style="${valueStyle}">${displayAmount}</td>
        </tr>`;
    })
    .join("");
};

const buildInvoicePaymentTerms = (invoice) => {
  if (invoice.daysToPay != null && invoice.daysToPay !== "") {
    return `${invoice.daysToPay} days from invoice date`;
  }
  if (invoice.dueDate) {
    return `Payment due by ${formatInvoiceDate(invoice.dueDate)}`;
  }
  return "As agreed";
};

const resolveInvoiceDueDate = (invoice) =>
  invoice.dueDate || computeInvoiceDueDate(invoice.date, invoice.daysToPay);

const buildInvoiceDueDate = (invoice) =>
  formatInvoiceDate(resolveInvoiceDueDate(invoice));

const formatPaymentStageAmount = (stage, scheduleTotal) => {
  if (stage.amountType === "percentage") {
    const pct = Number(stage.amount);
    const dollar =
      scheduleTotal != null && Number.isFinite(pct)
        ? (Number(scheduleTotal) * pct) / 100
        : null;
    const pctLabel = Number.isFinite(pct) ? `${pct}%` : "—";
    return dollar != null
      ? `${pctLabel} (${formatInvoiceMoney(dollar)})`
      : pctLabel;
  }
  return formatInvoiceMoney(stage.amount);
};

const formatPaymentStageStatus = (status) => {
  const labels = {
    pending: "Pending",
    invoiced: "Invoiced",
    paid: "Paid",
    overdue: "Overdue",
  };
  return labels[status] || status || "—";
};

const buildPaymentScheduleSection = (paymentSchedule, invoice) => {
  const stages = Array.isArray(paymentSchedule?.stages)
    ? paymentSchedule.stages
    : [];

  if (!stages.length) {
    return `
      <div class="section-title">Payment schedule</div>
      <p class="line-items-note" style="margin-top:0">
        No payment schedule stages are configured for this project yet.
      </p>
    `;
  }

  const scheduleTotal = paymentSchedule.totalAmount;
  const currentStageId = invoice?.paymentScheduleStageId
    ? String(invoice.paymentScheduleStageId)
    : null;

  const rows = stages
    .map((stage) => {
      const isCurrent = currentStageId && String(stage._id) === currentStageId;
      const rowStyle = isCurrent ? "background:#f0f7ff;font-weight:600" : "";
      const currentBadge = isCurrent
        ? ' <span style="font-size:10px;color:#1a2e4a;background:#d8e8f8;padding:2px 6px;border-radius:4px;margin-left:6px">This invoice</span>'
        : "";

      return `<tr style="${rowStyle}">
        <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${escapeHtml(stage.stageName || "—")}${currentBadge}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatPaymentStageAmount(stage, scheduleTotal)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${formatInvoiceDate(stage.dueDate)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${formatPaymentStageStatus(stage.status)}</td>
      </tr>`;
    })
    .join("");

  const totalLabel =
    scheduleTotal != null
      ? `<p style="font-size:12px;color:#666;margin:8px 0 0">Schedule total: <strong>${formatInvoiceMoney(scheduleTotal)}</strong></p>`
      : "";

  return `
      <div class="section-title">Payment schedule</div>
      <table class="line-items">
        <thead>
          <tr>
            <th>Stage</th>
            <th class="num">Amount</th>
            <th>Due date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${totalLabel}
    `;
};

const buildInvoiceLineItemDescription = (li) => {
  if (li.description && String(li.description).trim())
    return String(li.description).trim();
  return (li.items || []).filter(Boolean).join(", ") || "—";
};

const buildInvoicePdfDocument = (inv, customerName, paymentSchedule) => {
  const stages = Array.isArray(paymentSchedule?.stages)
    ? paymentSchedule.stages
    : [];
  const scheduleTotal = paymentSchedule?.totalAmount;
  const currentStageId = inv?.paymentScheduleStageId
    ? String(inv.paymentScheduleStageId)
    : null;

  const totals = [
    ["Subtotal", inv.subtotal, false],
    ["Discount", inv.discount, true],
    ["Tax", inv.tax, false],
    ["Deposit", inv.depositAmount, false],
    ["Total due", inv.totalAmount, false],
  ].map(([label, amount, isDiscount]) => ({
    label,
    amount:
      isDiscount && amount != null && Number(amount) !== 0
        ? `−${formatInvoiceMoney(amount)}`
        : formatInvoiceMoney(amount),
  }));

  return {
    customerName,
    invoiceNumber: inv.invoiceNumber || "—",
    date: formatInvoiceDate(inv.date),
    dueDate: buildInvoiceDueDate(inv),
    paymentTerms: buildInvoicePaymentTerms(inv),
    daysToPay:
      inv.daysToPay != null && inv.daysToPay !== ""
        ? String(inv.daysToPay)
        : "—",
    poNumber: inv.poNumber || "—",
    totalAmount: formatInvoiceMoney(inv.totalAmount),
    lineItems: (inv.lineItems || []).map((li, index) => ({
      index: index + 1,
      description: buildInvoiceLineItemDescription(li),
      rate: formatInvoiceRateCell(li),
      quantity: li.quantity ?? "—",
      tax: formatInvoiceTaxCell(li),
      total: formatInvoiceMoney(li.total),
    })),
    totals,
    paymentStages: stages.map((stage) => ({
      stageName: stage.stageName || "—",
      amount: formatPaymentStageAmount(stage, scheduleTotal),
      dueDate: formatInvoiceDate(stage.dueDate),
      status: formatPaymentStageStatus(stage.status),
      isCurrent: Boolean(
        currentStageId && String(stage._id) === currentStageId,
      ),
    })),
    scheduleTotal:
      scheduleTotal != null ? formatInvoiceMoney(scheduleTotal) : null,
  };
};

const sendQuotation = async ({
  toEmail,
  customerName,
  quotation,
  message = "",
  pdfAttachment = null,
}) => {
  const template = loadTemplate("quotation");
  const html = fillTemplate(template, {
    CUSTOMER_NAME: customerName,
    BUILDING_TYPE: quotation.buildingType,
    QUOTE_NUMBER: quotation.quoteNumber || "",
    BASE_PRICE: quotation.basePrice?.toLocaleString() || "",
    FINAL_PRICE: quotation.finalPrice?.toLocaleString() || "",
    TOTAL_COGS: quotation.totalCOGS?.toLocaleString() || "",
    MARKUP_PERCENT: quotation.markupPercent || "",
    MARKUP_VALUE: quotation.markupValue?.toLocaleString() || "",
    PSF: quotation.psf?.toFixed(2) || "",
    CURRENCY: quotation.currency || "USD",
    LOCATION: quotation.location || "",
    VALID_TILL: quotation.validTill
      ? new Date(quotation.validTill).toDateString()
      : "N/A",
    COMPANY_NAME: quotation.companyName || "",
    ESTIMATED_DELIVERY: quotation.estimatedDelivery || "",
    SPECIAL_NOTE: quotation.specialNote || "",
    CLIENT_NOTES: quotation.clientNotes || "",
    PAYMENT_TERMS: quotation.paymentTerms || "",
    PROPOSAL_DATE: quotation.proposalDate
      ? new Date(quotation.proposalDate).toDateString()
      : "",
    PREPARED_BY: quotation.preparedBy || "",
    WIDTH: quotation.width || "",
    LENGTH: quotation.length || "",
    HEIGHT: quotation.height || "",
    ROOF_STYLE: quotation.roofStyle || "",
  });

  const safeMessage = escapeHtml(String(message || "").trim()).replace(/\n/g, "<br/>");
  const htmlWithMessage = safeMessage
    ? `${html}
      <div style="margin-top:16px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;">
        <div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:6px;">Message from our team</div>
        <div style="font-size:13px;">${safeMessage}</div>
      </div>`
    : html;

  const mailOptions = {
    from: MAIL_FROM,
    to: toEmail,
    subject: `Your Quotation for ${quotation.buildingType || "Construction Project"}`,
    html: htmlWithMessage,
  };

  if (pdfAttachment?.content) {
    mailOptions.attachments = [
      {
        filename: pdfAttachment.filename || "Quotation.pdf",
        content: pdfAttachment.content,
        contentType: pdfAttachment.contentType || "application/pdf",
      },
    ];
  }

  const result = await transporter.sendMail(mailOptions);
  return { provider: result?.provider || "unknown" };
};

const sendInvoice = async ({
  toEmail,
  customerName,
  customerAddressHtml = "",
  invoice,
  paymentSchedule = null,
}) => {
  const inv = invoice?.toObject ? invoice.toObject() : invoice;
  const template = loadTemplate("invoice");
  const hasDeposit =
    inv.depositAmount != null && Number(inv.depositAmount) !== 0;
  const paymentScheduleSection = buildPaymentScheduleSection(
    paymentSchedule,
    inv,
  );
  const html = fillTemplate(template, {
    ...buildInvoiceCompanyTemplateFields(),
    CUSTOMER_NAME: escapeHtml(customerName),
    CUSTOMER_ADDRESS_BLOCK: buildCustomerAddressBlock(customerAddressHtml),
    INVOICE_NUMBER: escapeHtml(inv.invoiceNumber || "—"),
    DATE: formatInvoiceDate(inv.date),
    DUE_DATE: buildInvoiceDueDate(inv),
    PAYMENT_TERMS: buildInvoicePaymentTerms(inv),
    DAYS_TO_PAY:
      inv.daysToPay != null && inv.daysToPay !== ""
        ? String(inv.daysToPay)
        : "—",
    PO_NUMBER: escapeHtml(inv.poNumber || "—"),
    SUBTOTAL: formatInvoiceMoney(inv.subtotal),
    MARKUP_TOTAL: formatInvoiceMoney(inv.markupTotal),
    TAX: formatInvoiceMoney(inv.tax),
    DISCOUNT: formatInvoiceMoney(inv.discount),
    DEPOSIT_AMOUNT: formatInvoiceMoney(inv.depositAmount),
    TOTAL_AMOUNT: formatInvoiceMoney(inv.totalAmount),
    LINE_ITEMS: buildInvoiceLineItemsRows(inv.lineItems),
    TOTALS_ROWS: buildInvoiceTotalsRows(inv),
    DEPOSIT_NOTE: hasDeposit ? " (deposit shown separately)" : "",
    PAYMENT_SCHEDULE_SECTION: paymentScheduleSection,
  });

  const pdfDocument = buildInvoicePdfDocument(
    inv,
    customerName,
    paymentSchedule,
  );
  const invoiceFilename = `Invoice-${inv.invoiceNumber || "document"}.pdf`;

  let pdfBuffer = null;
  let pdfError = null;
  try {
    pdfBuffer = await generateInvoicePdf(html, pdfDocument);
  } catch (err) {
    pdfError = err.message;
    console.warn(
      "[sendInvoice] PDF attachment skipped, sending HTML email only:",
      err.message,
    );
  }

  const mailOptions = {
    from: MAIL_FROM,
    to: toEmail,
    subject: `Invoice ${inv.invoiceNumber || ""}`,
    html,
  };

  if (pdfBuffer) {
    mailOptions.attachments = [
      {
        filename: invoiceFilename,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];
  }

  await transporter.sendMail(mailOptions);

  const stages = Array.isArray(paymentSchedule?.stages)
    ? paymentSchedule.stages
    : [];

  return {
    pdfAttached: Boolean(pdfBuffer),
    pdfError,
    paymentScheduleIncluded: stages.length > 0,
    paymentScheduleStageCount: stages.length,
  };
};

const sendOtp = async ({ toEmail, name, otp, expiresInMinutes = 10 }) => {
  const template = loadTemplate("otp");
  const html = fillTemplate(template, {
    NAME: name,
    OTP: otp,
    EXPIRES_IN: expiresInMinutes,
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: "Your Password Reset OTP",
    html,
  });
};

const sendFollowUpNudgeEmail = async ({
  toEmail,
  customerName = "there",
  subject = "Quick follow-up from our team",
  message = "",
}) => {
  const safeMessage = escapeHtml(message || "").replace(/\n/g, "<br/>");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Follow-up Reminder</h2>
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>${safeMessage || "Our team is following up with you regarding your project. Please reply when convenient."}</p>
      <p>Thank you,<br/>Storage Materials Team</p>
    </div>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject,
    html,
  });
};

const EMPLOYEE_LOGIN_URLS = {
  admin: ADMIN_LOGIN_URL,
  sales: SALES_LOGIN_URL,
  plant: PLANT_LOGIN_URL,
};

const sendEmployeeCredentials = async ({
  toEmail,
  name,
  role,
  tempPassword,
}) => {
  const normalizedRole = String(role || "").toLowerCase();
  const loginUrl =
    EMPLOYEE_LOGIN_URLS[normalizedRole] || EMPLOYEE_LOGIN_URLS.admin;
  const roleLabel =
    normalizedRole === "admin"
      ? "Admin"
      : normalizedRole === "sales"
        ? "Sales"
        : normalizedRole === "plant"
          ? "Plant"
          : "Employee";

  const template = loadTemplate("employee-credentials");
  const html = fillTemplate(template, {
    EMPLOYEE_NAME: name,
    ROLE: normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1),
    EMAIL: toEmail,
    TEMP_PASSWORD: tempPassword,
    LOGIN_URL: loginUrl,
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Your ${roleLabel} Login Credentials`,
    html,
  });
};

const sendNewCustomerEnquiryNotification = async ({
  toEmail = "info@steelbuildingdepot.com",
  customerName,
  customerEmail,
  customerPhone,
  countryCode,
  source = "ai_chat",
}) => {
  const safeName = escapeHtml(customerName || "N/A");
  const safeEmail = escapeHtml(customerEmail || "N/A");
  const safePhone = escapeHtml(customerPhone || "N/A");
  const safeCountryCode = escapeHtml(countryCode || "");

  const isAiChat = source === "ai_chat";
  const introText = isAiChat
    ? "A new customer enquiry was created from AI chat init."
    : "A new customer enquiry was submitted via form fill.";
  const subject = isAiChat
    ? "New customer enquiry - AI chat"
    : "New customer enquiry - Form filled";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">New Customer Enquiry</h2>
      <p>${introText}</p>
      <ul>
        <li><strong>Name:</strong> ${safeName}</li>
        <li><strong>Email:</strong> ${safeEmail}</li>
        <li><strong>Phone:</strong> ${safeCountryCode} ${safePhone}</li>
      </ul>
    </div>
  `;

  if (!enquiryTransporter) {
    throw new Error(
      "Enquiry email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.",
    );
  }

  const info = await enquiryTransporter.sendMail({
    from: SMTP_MAIL_FROM,
    to: toEmail,
    subject,
    html,
    text: [
      introText,
      "",
      `Name: ${customerName || "N/A"}`,
      `Email: ${customerEmail || "N/A"}`,
      `Phone: ${(countryCode || "").trim()} ${customerPhone || "N/A"}`.trim(),
    ].join("\n"),
  });

  console.log(
    `[Nodemailer] Email sent successfully | to=${toEmail} | subject=${subject} | source=${source} | messageId=${info.messageId || "-"} | response=${info.response || "-"} | customer=${customerName || "N/A"} <${customerEmail || "N/A"}>`,
  );
};

const sendConsolidatedBOMToVendor = async ({
  toEmail,
  vendorName,
  projectName,
  jobId,
  bomFileUrl,
  uploadUrl,
}) => {
  const template = loadTemplate("vendor-consolidated-bom");
  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || "Vendor",
    PROJECT_NAME: projectName || "",
    JOB_ID: jobId || "",
    BOM_FILE_URL: bomFileUrl || "",
    UPLOAD_URL: uploadUrl || "",
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Consolidated BOM for ${projectName || "Project"}`,
    html,
  });
};

const sendShipperApprovalEmail = async ({
  toEmail,
  vendorName,
  projectName,
  jobId,
}) => {
  const template = loadTemplate("vendor-shipper-approved");
  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || "Vendor",
    PROJECT_NAME: projectName || "",
    JOB_ID: jobId || "",
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Vendor Selection Update: ${projectName || "Project"}`,
    html,
  });
};

const sendShipperRejectionEmail = async ({
  toEmail,
  vendorName,
  projectName,
  jobId,
}) => {
  const template = loadTemplate("vendor-shipper-rejected");
  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || "Vendor",
    PROJECT_NAME: projectName || "",
    JOB_ID: jobId || "",
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Vendor Selection Update: ${projectName || "Project"}`,
    html,
  });
};

// "Send Report to the Shippers" — plant panel Order Verification screen. Recipient is typed in
// freely (may not be the vendor's own email), so this builds inline HTML rather than pulling
// vendor context from a template.
const sendComparisonReportEmail = async ({ toEmail, projectName, jobId, summary, excelBuffer }) => {
  const rows = [
    ['Matched Items', summary?.matchedItems ?? 0],
    ['Missing Items', summary?.missingItems ?? 0],
    ['Extra Items', summary?.extraItems ?? 0],
  ]
  const html = `
    <p>Order verification comparison report for <strong>${projectName || 'Project'}</strong> (${jobId || ''}).</p>
    <table cellpadding="6" style="border-collapse:collapse">
      ${rows.map(([label, val]) => `<tr><td style="border:1px solid #ddd">${label}</td><td style="border:1px solid #ddd">${val}</td></tr>`).join('')}
    </table>
    <p>See the attached Excel report for full line-item detail.</p>
  `

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Order Verification Report: ${projectName || 'Project'}`,
    html,
    attachments: excelBuffer
      ? [{ filename: `comparison-report-${jobId || 'report'}.xlsx`, content: excelBuffer }]
      : [],
  })
}

const sendShipperResubmitRequestEmail = async ({
  toEmail,
  vendorName,
  projectName,
  jobId,
  note,
  uploadUrl,
  exceptionSummary = null,
}) => {
  const template = loadTemplate("vendor-shipper-resubmit");
  const summary = exceptionSummary?.comparisonSummary;
  const exceptionLines = [];
  if (summary) {
    if (summary.missingItems)
      exceptionLines.push(`${summary.missingItems} missing item(s)`);
    if (summary.extraItems)
      exceptionLines.push(`${summary.extraItems} extra item(s)`);
    if (summary.qtyMismatches)
      exceptionLines.push(`${summary.qtyMismatches} quantity mismatch(es)`);
    if (summary.lengthMismatches)
      exceptionLines.push(`${summary.lengthMismatches} length mismatch(es)`);
    if (summary.ambiguousMatches)
      exceptionLines.push(`${summary.ambiguousMatches} ambiguous match(es)`);
    if (summary.partMismatches)
      exceptionLines.push(`${summary.partMismatches} part mismatch(es)`);
  }
  const exceptionSummaryText = exceptionLines.length
    ? exceptionLines.join("; ")
    : "See upload page for comparison details.";
  const exceptionDetailsHtml = formatExceptionsForEmailHtml(exceptionSummary);
  const exceptionDetailsText = formatExceptionsForEmailText(exceptionSummary);

  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || "Vendor",
    PROJECT_NAME: projectName || "",
    JOB_ID: jobId || "",
    NOTE: note || "",
    UPLOAD_URL: uploadUrl || "",
    EXCEPTION_SUMMARY: exceptionSummaryText,
    EXCEPTION_DETAILS_HTML: exceptionDetailsHtml,
    PRIOR_QUOTE_VALUE:
      exceptionSummary?.priorQuoteValue != null
        ? String(exceptionSummary.priorQuoteValue)
        : "N/A",
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Action Required: Updated Quote Needed for ${projectName || "Project"}`,
    html,
    text: [
      `Hello ${vendorName || "Vendor"},`,
      "",
      `Project: ${projectName || ""}`,
      `Job ID: ${jobId || ""}`,
      "",
      `Plant note: ${note || ""}`,
      `Previous quote amount: ${exceptionSummary?.priorQuoteValue ?? "N/A"}`,
      "",
      exceptionSummaryText,
      "",
      exceptionDetailsText,
      "",
      `Upload revised quote: ${uploadUrl || ""}`,
    ].join("\n"),
  });
};

const sendFreightBidRequestEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
  bidDeadline,
  bidUrl,
  loadDescription,
  loadWeight,
  pickupLocation,
  deliveryLocation,
  bundles = [],
  packingLists = [],
}) => {
  const safeCarrier = escapeHtml(carrierName || "Carrier");
  const safeProject = escapeHtml(projectName || "");
  const safeJobId = escapeHtml(jobId || "");
  const safeDeliveryNumber = escapeHtml(deliveryNumber || "");
  const safeBidUrl = escapeHtml(bidUrl || "");
  const safeLoadDescription = escapeHtml(loadDescription || "");
  const safePickup = escapeHtml(pickupLocation || "");
  const safeDelivery = escapeHtml(deliveryLocation || "");
  const safeWeight =
    loadWeight != null
      ? `${Number(loadWeight).toLocaleString("en-US")} lbs`
      : "—";
  const safeDeadline = formatInvoiceDate(bidDeadline);
  const loadDetailsHtml = formatFreightLoadDetailsHtml({
    bundles,
    packingLists,
  });
  const loadDetailsText = formatFreightLoadDetailsText({
    bundles,
    packingLists,
  });

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Freight Bid Request</h2>
      <p>Hi ${safeCarrier},</p>
      <p>You have received a freight bid request for the below project:</p>
      <ul>
        <li><strong>Project:</strong> ${safeProject}</li>
        <li><strong>Job ID:</strong> ${safeJobId}</li>
        <li><strong>Freight Request #:</strong> ${safeDeliveryNumber}</li>
        <li><strong>Load description:</strong> ${safeLoadDescription}</li>
        <li><strong>Load weight:</strong> ${safeWeight}</li>
        <li><strong>Pickup location:</strong> ${safePickup}</li>
        <li><strong>Delivery location:</strong> ${safeDelivery}</li>
        <li><strong>Bid deadline:</strong> ${safeDeadline}</li>
      </ul>
      ${loadDetailsHtml}
      <p>
        Submit your bid here:<br/>
        <a href="${safeBidUrl}" target="_blank" rel="noopener">${safeBidUrl}</a>
      </p>
      <p>Please submit before deadline. Late bids are automatically blocked.</p>
    </div>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Freight Bid Request: ${projectName || "Project"}${deliveryNumber ? ` (${deliveryNumber})` : ""}`,
    html,
    text: [
      `Hi ${carrierName || "Carrier"},`,
      "",
      "You have received a freight bid request:",
      `Project: ${projectName || ""}`,
      `Job ID: ${jobId || ""}`,
      `Freight Request #: ${deliveryNumber || ""}`,
      `Load description: ${loadDescription || ""}`,
      `Load weight: ${loadWeight != null ? `${loadWeight} lbs` : "—"}`,
      `Pickup: ${pickupLocation || ""}`,
      `Delivery: ${deliveryLocation || ""}`,
      `Bid deadline: ${safeDeadline}`,
      "",
      loadDetailsText,
      "",
      `Submit bid: ${bidUrl || ""}`,
    ].join("\n"),
  });
};

const sendFreightBidAwardedEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
  quotedAmount,
}) => {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Freight Bid Awarded</h2>
      <p>Hi ${escapeHtml(carrierName || "Carrier")},</p>
      <p>Your freight bid has been selected for this request:</p>
      <ul>
        <li><strong>Project:</strong> ${escapeHtml(projectName || "")}</li>
        <li><strong>Job ID:</strong> ${escapeHtml(jobId || "")}</li>
        <li><strong>Freight Request #:</strong> ${escapeHtml(deliveryNumber || "")}</li>
        <li><strong>Awarded Amount:</strong> ${quotedAmount != null ? formatInvoiceMoney(quotedAmount) : "—"}</li>
      </ul>
      <p>Our team will coordinate next steps with you shortly.</p>
    </div>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Freight Bid Awarded: ${projectName || "Project"}${deliveryNumber ? ` (${deliveryNumber})` : ""}`,
    html,
  });
};

const sendFreightBidRejectedEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
}) => {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Freight Bid Update</h2>
      <p>Hi ${escapeHtml(carrierName || "Carrier")},</p>
      <p>Thanks for submitting your freight bid. Another carrier was selected for this request:</p>
      <ul>
        <li><strong>Project:</strong> ${escapeHtml(projectName || "")}</li>
        <li><strong>Job ID:</strong> ${escapeHtml(jobId || "")}</li>
        <li><strong>Freight Request #:</strong> ${escapeHtml(deliveryNumber || "")}</li>
      </ul>
      <p>We appreciate your response and look forward to future opportunities.</p>
    </div>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Freight Bid Update: ${projectName || "Project"}${deliveryNumber ? ` (${deliveryNumber})` : ""}`,
    html,
  });
};

const sendFreightBidResubmitRequestEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
  note,
  bidUrl,
  bidDeadline,
  priorQuotedAmount,
  requestedBidAmount,
}) => {
  const template = loadTemplate("carrier-freight-bid-resubmit");
  const priorAmountText =
    priorQuotedAmount != null && Number.isFinite(Number(priorQuotedAmount))
      ? formatInvoiceMoney(priorQuotedAmount)
      : "N/A";
  const requestedAmountText =
    requestedBidAmount != null && Number.isFinite(Number(requestedBidAmount))
      ? formatInvoiceMoney(requestedBidAmount)
      : "N/A";

  const html = fillTemplate(template, {
    CARRIER_NAME: carrierName || "Carrier",
    PROJECT_NAME: projectName || "",
    JOB_ID: jobId || "",
    DELIVERY_NUMBER: deliveryNumber || "",
    NOTE: note || "",
    BID_URL: bidUrl || "",
    BID_DEADLINE: formatInvoiceDate(bidDeadline),
    PRIOR_QUOTED_AMOUNT: priorAmountText,
    REQUESTED_BID_AMOUNT: requestedAmountText,
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Action Required: Revised Freight Bid for ${projectName || "Project"}`,
    html,
    text: [
      `Hello ${carrierName || "Carrier"},`,
      "",
      `Project: ${projectName || ""}`,
      `Job ID: ${jobId || ""}`,
      `Freight Request #: ${deliveryNumber || ""}`,
      "",
      `Plant note: ${note || ""}`,
      `Previous bid amount: ${priorAmountText}`,
      `Requested bid amount: ${requestedAmountText}`,
      "",
      `Submit revised bid: ${bidUrl || ""}`,
      `Bid deadline: ${formatInvoiceDate(bidDeadline)}`,
    ].join("\n"),
  });
};

const sendDeliveryConfirmationEmail = async ({
  toEmail,
  customerName,
  projectName,
  jobId,
  deliveryNumber,
  deliveryDate,
  timings,
  deliveryLocation,
}) => {
  const safeDeliveryDate = deliveryDate ? formatInvoiceDate(deliveryDate) : "—";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Delivery Confirmation</h2>
      <p>Hi ${escapeHtml(customerName || "there")},</p>
      <p>This confirms the scheduled delivery for your project:</p>
      <ul>
        <li><strong>Project:</strong> ${escapeHtml(projectName || "")}</li>
        <li><strong>Job ID:</strong> ${escapeHtml(jobId || "")}</li>
        <li><strong>Delivery #:</strong> ${escapeHtml(deliveryNumber || "")}</li>
        <li><strong>Delivery Date:</strong> ${safeDeliveryDate}</li>
        <li><strong>Time Window:</strong> ${escapeHtml(timings || "—")}</li>
        <li><strong>Delivery Location:</strong> ${escapeHtml(deliveryLocation || "—")}</li>
      </ul>
      <p>You'll be notified of any changes to this schedule.</p>
    </div>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Delivery Confirmed: ${projectName || "Project"}${deliveryNumber ? ` (${deliveryNumber})` : ""}`,
    html,
  });
};

const sendDeliveryCallbackRequestEmail = async ({
  toEmail,
  salesRepName,
  customerName,
  customerEmail,
  customerPhone,
  projectName,
  jobId,
  deliveryNumber,
  note,
}) => {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Customer Call Back Request</h2>
      <p>Hi ${escapeHtml(salesRepName || "there")},</p>
      <p>A customer has requested a call back regarding a delivery:</p>
      <ul>
        <li><strong>Customer:</strong> ${escapeHtml(customerName || "")} (${escapeHtml(customerEmail || "")}${customerPhone ? `, ${escapeHtml(customerPhone)}` : ""})</li>
        <li><strong>Project:</strong> ${escapeHtml(projectName || "")}</li>
        <li><strong>Job ID:</strong> ${escapeHtml(jobId || "")}</li>
        <li><strong>Delivery #:</strong> ${escapeHtml(deliveryNumber || "")}</li>
        ${note ? `<li><strong>Note:</strong> ${escapeHtml(note)}</li>` : ""}
      </ul>
      <p>Please reach out to the customer at your earliest convenience.</p>
    </div>
  `;

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Call Back Requested: ${projectName || "Project"}${deliveryNumber ? ` (${deliveryNumber})` : ""}`,
    html,
  });
};

module.exports = {
  isEmailConfigured,
  isSmtpConfigured,
  isEnquiryNotificationConfigured,
  buildCustomerBillToAddressHtml,
  sendQuotation,
  sendInvoice,
  sendOtp,
  sendFollowUpNudgeEmail,
  sendEmployeeCredentials,
  sendNewCustomerEnquiryNotification,
  sendConsolidatedBOMToVendor,
  sendShipperApprovalEmail,
  sendShipperRejectionEmail,
  sendShipperResubmitRequestEmail,
  sendComparisonReportEmail,
  sendFreightBidRequestEmail,
  sendFreightBidResubmitRequestEmail,
  sendFreightBidAwardedEmail,
  sendFreightBidRejectedEmail,
  sendDeliveryConfirmationEmail,
  sendDeliveryCallbackRequestEmail,
};
