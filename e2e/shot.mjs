import { chromium } from "@playwright/test";

const BASE = "https://localhost:8443";
const out = process.argv[2] ?? ".";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

async function shot(name, theme) {
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("inclination-theme", JSON.stringify({ state: { preference: t }, version: 0 }));
  }, theme);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
}

await shot("auth-light", "light");
await shot("auth-dark", "dark");

await browser.close();
console.log("done");
