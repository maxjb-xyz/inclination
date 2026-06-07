import { chromium } from "@playwright/test";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const BASE = "https://localhost:8443";
const MAILPIT = "http://localhost:8025";
const out = process.argv[2] ?? ".";
const stamp = Date.now();
const account = {
  email: `shot-${stamp}@example.com`,
  password: "shotpassword1",
  displayName: "Ada Lovelace",
};

const j = (r) => r.json();
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res;
}

async function verifyToken(email) {
  const pat = /verify-email\?token=([^&\s]+)/;
  for (let i = 0; i < 40; i++) {
    const { messages } = await j(await fetch(`${MAILPIT}/api/v1/messages?limit=100`));
    for (const m of messages) {
      if (!m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase())) continue;
      const d = await j(await fetch(`${MAILPIT}/api/v1/message/${m.ID}`));
      const match = d.Text.match(pat);
      if (match) return decodeURIComponent(match[1]);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no verify mail");
}

// 1. register → verify → login
await api("/auth/register", { method: "POST", body: JSON.stringify(account) });
const token = await verifyToken(account.email);
await api("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
const { user, tokens } = await j(
  await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: account.email, password: account.password }),
  }),
);
const auth = { headers: { authorization: `Bearer ${tokens.accessToken}` } };

// 2. seed a workspace + a few pages
const ws = await j(await api("/workspaces", { method: "POST", body: JSON.stringify({ name: "Ada's Workspace" }), ...auth }));
async function page(title, parentId) {
  return j(await api(`/workspaces/${ws.id}/pages`, {
    method: "POST",
    body: JSON.stringify({ title, ...(parentId ? { parentId } : {}) }),
    ...auth,
  }));
}
const home = await page("Product spec");
await page("Research notes", home.id);
await page("Meeting log", home.id);
await page("Roadmap");

// 3. browser session
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

async function seedAndOpen(theme) {
  const p = await ctx.newPage();
  await p.addInitScript(
    ({ user, tokens, theme }) => {
      localStorage.setItem("inclination-auth", JSON.stringify({ state: { user, tokens }, version: 0 }));
      localStorage.setItem("inclination-theme", JSON.stringify({ state: { preference: theme }, version: 0 }));
    },
    { user, tokens, theme },
  );
  await p.goto(BASE, { waitUntil: "networkidle" });
  // open the first page via its title link (not the twisty/grip)
  await p.locator(".page-link").first().click().catch(() => {});
  await p.locator(".ProseMirror").waitFor({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return p;
}

// Type content once (light), then it persists via Yjs for the dark shot too.
const light = await seedAndOpen("light");
try {
  const ed = light.locator(".ProseMirror");
  await ed.click();
  await light.keyboard.type("## Overview\n");
  await light.keyboard.type("A calm, content-first workspace for writing and planning.\n\n");
  await light.keyboard.type("- Real-time collaborative editor\n");
  await light.keyboard.type("Databases, comments, and publishing\n");
  await light.waitForTimeout(1500);
} catch (e) {
  console.log("typing skipped:", e.message);
}
await light.screenshot({ path: `${out}/app-light.png` });
await light.close();

const dark = await seedAndOpen("dark");
await dark.screenshot({ path: `${out}/app-dark.png` });
await dark.close();

await browser.close();
console.log("done");
