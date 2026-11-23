// Renders docs/sample.md through the real engine and preview frame, then captures the listing
// images and icon in assets/. Run with: npm run screenshots
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { buildShell, type ShellTheme } from "../client/shell";
import { FILLED_BOOK } from "../client/icons";
import { renderMarkdown } from "../server/generated/engine.js";
import { loadRuntime } from "../server/runtime";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "assets");
mkdirSync(out, { recursive: true });

const DARK: ShellTheme = {
  dark: true,
  background: "#1d1f24",
  foreground: "#e6e7ea",
  muted: "#9aa0a8",
  border: "#33363d",
  accent: "#5b9bff",
  surface: "#25282e",
  raised: "#2c2f36",
  success: "#3fb950",
  warning: "#d29922",
  danger: "#f85149",
};
const LIGHT: ShellTheme = {
  dark: false,
  background: "#ffffff",
  foreground: "#1f2328",
  muted: "#59636e",
  border: "#d8dee4",
  accent: "#0969da",
  surface: "#f6f8fa",
  raised: "#ffffff",
  success: "#1a7f37",
  warning: "#9a6700",
  danger: "#d1242f",
};

const docPath = path.join(root, "docs/sample.md");
const rendered = renderMarkdown(readFileSync(docPath, "utf8"), docPath);
const shell = buildShell(loadRuntime());

async function open(page: Page, theme: ShellTheme, settings: Record<string, unknown>) {
  await page.setContent(shell, { waitUntil: "load" });
  await page.evaluate(
    ({ html, theme, settings }) => {
      window.postMessage({ type: "settings", scale: 1, outline: false, wide: false, ...settings }, "*");
      window.postMessage({ type: "render", html, theme }, "*");
    },
    { html: rendered.html, theme, settings },
  );
  await page.waitForFunction(() => document.querySelectorAll("pre.mermaid").length === 0 && document.querySelectorAll(".diagram-svg").length > 0, null, { timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function scrollTo(page: Page, selector: string, offset = 24) {
  await page.evaluate(
    ({ selector, offset }) => {
      const el = document.querySelector(selector);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset);
    },
    { selector, offset },
  );
  await page.waitForTimeout(250);
}

const executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

await open(page, DARK, {});
await page.screenshot({ path: path.join(out, "preview-dark.png") });

await scrollTo(page, "#release-flow");
await page.screenshot({ path: path.join(out, "diagrams-dark.png") });

await page.click(".diagram-svg");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, "zoom-dark.png") });

await open(page, LIGHT, { outline: true });
await scrollTo(page, "#tasks");
await page.screenshot({ path: path.join(out, "outline-light.png") });

const iconPage = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
await iconPage.setContent(
  `<html><body style="margin:0;background:transparent">
     <div style="width:256px;height:256px;border-radius:56px;background:linear-gradient(160deg,#6aa6ff,#3b7bf0);display:flex;align-items:center;justify-content:center;color:#fff">
       <div style="width:150px;height:150px">${FILLED_BOOK.svg.replace("<svg ", '<svg width="150" height="150" ')}</div>
     </div></body></html>`,
);
await iconPage.screenshot({ path: path.join(out, "icon.png"), omitBackground: true });

await browser.close();
console.log("screenshots written to", out);
