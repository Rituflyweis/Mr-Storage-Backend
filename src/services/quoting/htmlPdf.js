/**
 * Shared HTML → PDF renderer for quoting documents
 * (Change Orders, deposit receipts, milestone schedules, custom quotes,
 * assembled packages). Reuses the project's puppeteer launcher.
 */

const { launchBrowser } = require("../../utils/puppeteerLaunch");

/**
 * Render a full HTML string to a Letter-size PDF Buffer.
 * @param {string} html Complete <!DOCTYPE html>… document
 * @returns {Promise<Buffer>}
 */
const renderHtmlToPdf = async (html) => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "24px", right: "24px", bottom: "24px", left: "24px" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
};

module.exports = { renderHtmlToPdf };
