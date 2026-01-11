import fs from "fs";
import path from "path";
import { promises as fsp } from "fs";
import archiver from "archiver";
import puppeteer from "puppeteer";
import { setTimeout as sleep } from "node:timers/promises";
import { URL } from "url";

// Mapeamento de extensões para garantir que arquivos sem extensão na URL sejam salvos corretamente
const CT_EXT = new Map([
  ["text/css", ".css"],
  ["text/javascript", ".js"],
  ["application/javascript", ".js"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"],
  ["font/woff2", ".woff2"]
]);

function safePath(p) {
  return p.replace(/\0/g, "").replace(/\.\.(\/|\\)/g, "");
}

function urlToLocalPath(u, baseUrl) {
  try {
    const url = new URL(u, baseUrl);
    let out = url.pathname || "/";
    if (out.endsWith("/")) out += "index.html";
    return safePath(out.replace(/^\//, ""));
  } catch (e) { return u; }
}

// NOVO: Corrige links dentro de arquivos CSS (fontes e backgrounds)
function rewriteCss(css, pageUrl) {
  return css.replace(/url\(['"]?([^'")]*)['"]?\)/gi, (match, val) => {
    if (!val || val.startsWith("data:") || val.startsWith("http")) return match;
    const local = urlToLocalPath(val, pageUrl);
    return `url("./${local}")`;
  });
}

function rewriteHtml(html, pageUrl) {
  return html.replace(/\b(src|href)=["']([^"']+)["']/gi, (m, attr, val) => {
    if (!val || val.startsWith("data:") || val.startsWith("#") || val.includes("mailto:")) return m;
    return `${attr}="./${urlToLocalPath(val, pageUrl)}"`;
  });
}

async function zipDir(inputDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve); // Garante que o ZIP só termine após o fechamento do stream
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(inputDir, false);
    archive.finalize();
  });
}

export async function renderAndZip({ jobId, url, workDir, options = {}, onProgress }) {
  const outDir = path.join(workDir, "static");
  await fsp.mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage();
    const saved = new Set();
    const base = new URL(url);

    page.on("response", async (resp) => {
      try {
        const rUrl = resp.url();
        const u = new URL(rUrl);
        if (!options.downloadExternal && u.host !== base.host) return;

        const ct = resp.headers()["content-type"] || "";
        if (ct.includes("text/html")) return;

        let rel = urlToLocalPath(rUrl, url);
        const out = path.join(outDir, rel);
        if (saved.has(out)) return;
        saved.add(out);

        let buf = await resp.buffer();
        if (ct.includes("text/css")) {
            buf = Buffer.from(rewriteCss(buf.toString(), rUrl));
        }

        await fsp.mkdir(path.dirname(out), { recursive: true });
        await fsp.writeFile(out, buf);
        onProgress?.({ stage: "assets", message: rel, assetsSaved: saved.size });
      } catch (e) {}
    });

    async function visit(target, outRel) {
      await page.goto(target, { 
        waitUntil: options.waitUntil || "networkidle0", 
        timeout: options.maxWaitMs || 45000 
      });
      if (options.extraWaitMs) await sleep(Number(options.extraWaitMs));
      
      let html = await page.content();
      html = rewriteHtml(html, target);
      
      const fullOut = path.join(outDir, outRel);
      await fsp.mkdir(path.dirname(fullOut), { recursive: true });
      await fsp.writeFile(fullOut, html);
    }

    await visit(url, "index.html");
    for (const r of (options.routes || [])) {
        if (r === "/") continue;
        const t = new URL(r, base).toString();
        await visit(t, path.join(r.replace(/^\//, ""), "index.html"));
    }

    const zipPath = path.join(workDir, `site-clone-${jobId}.zip`);
    await zipDir(outDir, zipPath);
    return zipPath;
  } finally {
    await browser.close();
  }
}
