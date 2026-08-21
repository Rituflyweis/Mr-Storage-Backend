/** Launch headless Chrome for HTML→PDF (local dev + Render/production). */

const fs = require('fs')

const BASE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
]

const resolveExecutablePath = async () => {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (envPath && fs.existsSync(envPath)) return envPath

  try {
    const puppeteer = require('puppeteer')
    const bundled = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : null
    if (bundled && fs.existsSync(bundled)) return bundled
  } catch {
    /* ignore */
  }

  const chromium = require('@sparticuz/chromium')
  return chromium.executablePath()
}

const launchBrowser = async () => {
  const executablePath = await resolveExecutablePath()
  const puppeteer = require('puppeteer-core')
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: BASE_ARGS,
  })
}

module.exports = {
  launchBrowser,
  resolveExecutablePath,
}
