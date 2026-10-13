// Usage: node shot.mjs <route> <outDir> [steps.mjs]
// Opens http://localhost:$PORT<route> in a phone-sized dark headless Chromium,
// screenshots it, then runs the optional steps module:
//   export default async (page, shot) => { await page.getByTestId("x").click(); await shot("after-x") }
// testID props render as data-testid on web, so page.getByTestId works.
import { createRequire } from "module"
import { pathToFileURL } from "url"
import { resolve } from "path"

const require = createRequire("/opt/node-tools/node_modules/")
const { chromium } = require("playwright")
const [route = "/", out = ".", steps] = process.argv.slice(2)
const port = process.env.PORT || "8081"
const scheme = process.env.SCHEME || "dark"

const browser = await chromium.launch({ args: ["--no-sandbox"] })
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  colorScheme: scheme,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()
page.on("pageerror", (e) => console.log("pageerror:", e.message))
let n = 0
const shot = async (name) => {
  await page.waitForTimeout(800)
  const file = `${out}/${String(n++).padStart(2, "0")}-${name}.png`
  await page.screenshot({ path: file })
  console.log("shot:", file)
}
await page.goto(`http://localhost:${port}${route}`, { waitUntil: "networkidle", timeout: 120000 })
await page.waitForTimeout(2000)
await shot("initial")
if (steps) await (await import(pathToFileURL(resolve(steps)).href)).default(page, shot)
await browser.close()
