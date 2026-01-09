import fs from "fs";
import path from "path";
import { promises as fsp } from "fs";
import archiver from "archiver";
import puppeteer from "puppeteer";

const CT_EXT = new Map([
  ["text/css", ".css"],
  ["text/javascript", ".js"],
  ["application/javascript", ".js"],
  ["application/json", ".json"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"],
  ["font/woff2", ".woff2"],
  ["font/woff", ".woff"],
  ["text/plain", ".txt"],
  ["text/html", ".html"],
]);

function sanitizePath(p) {
  p = p.replace(/\?.*$/, "").replace(/#.*$/, "");
  if (!p || p === "/") return "index";
  p = p.replace(/^\//, "");
  p = p.split("/").filter(seg => seg && seg !== "." && seg !== "..").join("/");
  return p || "index";
}

function ensureExt(filePath, contentType) {
  if (path.extname(filePath)) return filePath;
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const guess = CT_EXT.get(ct) || "";
  return filePath + guess;
}

function sameOrigin(urlA, baseOrigin) {
  try {
    return new URL(urlA).origin === baseOrigin;
  } catch { return false; }
}

function makeRel(fromFile, toFile) {
  const rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : "./" + rel;
}

function rewriteHtml(html, urlToLocal, htmlOutPath) {
  for (const [u, localPath] of urlToLocal.entries()) {
    const rel = makeRel(htmlOutPath, localPath);
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(esc, "g"), rel);
  }
  // remove <base> tag which often breaks offline
  html = html.replace(/<base\b[^>]*>/gi, "");
  return html;
}

async function zipDir(dirPath, zipPath) {
  await fsp.mkdir(path.dirname(zipPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", err => reject(err));
    archive.pipe(output);
    archive.directory(dirPath, false);
    archive.finalize();
  });
}

export async function renderAndZip({ jobId, url, options, workDir }) {
  const baseUrl = new URL(url);
  const origin = baseUrl.origin;

  const outDir = path.join(workDir, "site");
  await fsp.mkdir(outDir, { recursive: true });

  const urlToLocal = new Map();
  const captured = new Set();

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    page.on("response", async (resp) => {
      try {
        const respUrl = resp.url();
        if (!respUrl.startsWith("http")) return;
        if (!options.downloadExternal && !sameOrigin(respUrl, origin)) return;
        if (captured.has(respUrl)) return;

        const ct = resp.headers()["content-type"] || "";
        const buf = await resp.buffer().catch(() => null);
        if (!buf || !buf.length) return;

        const u = new URL(respUrl);
        let rel = path.join("assets", sanitizePath(u.pathname));
        rel = ensureExt(rel, ct);

        const abs = path.join(outDir, rel);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buf);

        captured.add(respUrl);
        urlToLocal.set(respUrl, abs);
      } catch {}
    });

    const routes = Array.isArray(options.routes) && options.routes.length ? options.routes : ["/"];

    for (const route of routes) {
      const routeUrl = new URL(route, origin).toString();
      await page.goto(routeUrl, { waitUntil: options.waitUntil, timeout: options.maxWaitMs });
      if (options.extraWaitMs) await page.waitForTimeout(options.extraWaitMs);

      let html = await page.content();

      let outHtml;
      if (route === "/" || route === "" || route === "/index.html") {
        outHtml = path.join(outDir, "index.html");
      } else {
        const clean = sanitizePath(route);
        outHtml = path.join(outDir, clean, "index.html");
        await fsp.mkdir(path.dirname(outHtml), { recursive: true });
      }

      html = rewriteHtml(html, urlToLocal, outHtml);
      await fsp.writeFile(outHtml, html, "utf-8");
    }

    const zipPath = path.join(workDir, `site-clone-${jobId}.zip`);
    await zipDir(outDir, zipPath);
    return zipPath;
  } finally {
    await browser.close();
  }
}
