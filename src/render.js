import fs from "fs";
import path from "path";
import { promises as fsp } from "fs";
import archiver from "archiver";
import puppeteer from "puppeteer";
import { URL } from "url";

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
  ["font/woff", ".woff"],
  ["font/woff2", ".woff2"],
  ["application/font-woff2", ".woff2"],
]);

function safePath(p) {
  // avoid weird traversal
  p = p.replace(/\0/g, "");
  p = p.replace(/\.\.(\/|\\)/g, "");
  return p;
}

function urlToLocalPath(u, baseUrl) {
  const url = new URL(u, baseUrl);
  const pathname = url.pathname || "/";
  let out = pathname;
  if (out.endsWith("/")) out += "index.html";
  out = out.replace(/^\//, "");
  out = safePath(out);
  return out;
}

function guessExt(contentType, urlStr) {
  if (!contentType) {
    const m = urlStr.match(/\.([a-zA-Z0-9]{1,6})(\?|#|$)/);
    if (m) return "." + m[1].toLowerCase();
    return "";
  }
  const ct = contentType.split(";")[0].trim().toLowerCase();
  return CT_EXT.get(ct) || "";
}

async function writeFileEnsuringDir(fullPath, buffer) {
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, buffer);
}

function rewriteHtml(html, mapFn, pageUrl) {
  // basic rewrite for src/href attributes
  return html.replace(/\b(src|href)=["']([^"']+)["']/gi, (m, attr, val) => {
    if (!val || val.startsWith("data:") || val.startsWith("mailto:") || val.startsWith("tel:") || val.startsWith("#")) return m;
    try {
      const local = mapFn(val, pageUrl);
      return `${attr}="${local}"`;
    } catch {
      return m;
    }
  });
}

async function zipDir(inputDir, zipPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(inputDir, false);
    archive.finalize();
  });
}

export async function renderAndZip({ jobId, url, workDir, options = {}, onProgress }) {
  const outDir = path.join(workDir, "static");
  await fsp.mkdir(outDir, { recursive: true });

  const routes = Array.isArray(options.routes) ? options.routes : [];
  const waitUntil = options.waitUntil || "networkidle0";
  const extraWaitMs = Number(options.extraWaitMs || 1500);
  const maxWaitMs = Number(options.maxWaitMs || 45000);
  const downloadExternal = !!options.downloadExternal;

  const base = new URL(url);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();

    // track & save responses
    const saved = new Set();

    page.on("response", async (resp) => {
      try {
        const respUrl = resp.url();
        const u = new URL(respUrl);

        if (!downloadExternal && u.host !== base.host) return;

        const ct = resp.headers()["content-type"] || "";
        const ext = guessExt(ct, respUrl);

        // Skip HTML documents here (we'll save via page.content)
        const ctMain = ct.split(";")[0].trim().toLowerCase();
        if (ctMain === "text/html") return;

        let rel = urlToLocalPath(respUrl, url);
        // ensure extension for assets if missing
        if (ext && !path.extname(rel)) rel += ext;

        const out = path.join(outDir, rel);

        if (saved.has(out)) return;
        saved.add(out);

        const buf = await resp.buffer();
        await writeFileEnsuringDir(out, buf);

        onProgress?.({ stage: "assets", message: respUrl, assetsSaved: saved.size });
      } catch {
        // ignore
      }
    });

    async function visit(targetUrl, outHtmlRel) {
      onProgress?.({ stage: "navigate", message: targetUrl });
      await page.goto(targetUrl, { waitUntil, timeout: maxWaitMs });
      if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);

      let html = await page.content();
      html = rewriteHtml(html, (val, pageUrl) => urlToLocalPath(val, pageUrl), targetUrl);

      const outHtml = path.join(outDir, outHtmlRel);
      await writeFileEnsuringDir(outHtml, Buffer.from(html, "utf-8"));
    }

    // root
    await visit(url, "index.html");

    // extra routes
    for (const r of routes) {
      const route = String(r || "").trim();
      if (!route) continue;
      const target = new URL(route.replace(/^\//, "/"), base).toString();
      const rel = safePath(route.replace(/^\//, "").replace(/\/$/, ""));
      const outHtmlRel = rel ? path.join(rel, "index.html") : "index.html";
      await visit(target, outHtmlRel);
    }

    onProgress?.({ stage: "zip", message: "Zipping files", assetsSaved: saved.size });
    const zipPath = path.join(workDir, `site-clone-${jobId}.zip`);
    await zipDir(outDir, zipPath);
    return zipPath;
  } finally {
    await browser.close();
  }
}
