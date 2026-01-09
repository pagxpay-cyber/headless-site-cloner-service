import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promises as fsp } from "fs";

import { renderAndZip } from "./src/render.js";
import { isUrlAllowed, requireApiKey } from "./src/security.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const API_KEY = process.env.API_KEY || "";
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean);
const MAX_WAIT_MS = process.env.MAX_WAIT_MS ? Number(process.env.MAX_WAIT_MS) : 45000;

const app = express();
app.use(express.json({ limit: "1mb" }));

const jobs = new Map(); // id -> {status, createdAt, zipPath?, error?, meta?}

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/api/jobs", requireApiKey(API_KEY), async (req, res) => {
  const { url, options } = req.body || {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url" });

  const allowed = await isUrlAllowed(url, ALLOWED_HOSTS);
  if (!allowed.ok) return res.status(400).json({ error: allowed.reason });

  const id = crypto.randomBytes(12).toString("hex");
  jobs.set(id, { status: "queued", createdAt: Date.now(), meta: { url } });

  (async () => {
    const workDir = path.join("/tmp", "clone-jobs", id);
    try {
      await fsp.mkdir(workDir, { recursive: true });
      jobs.set(id, { status: "running", createdAt: Date.now(), meta: { url } });

      const finalZipPath = await renderAndZip({
        jobId: id,
        url,
        options: {
          routes: Array.isArray(options?.routes) ? options.routes : ["/"],
          waitUntil: ["domcontentloaded","load","networkidle0","networkidle2"].includes(options?.waitUntil) ? options.waitUntil : "networkidle0",
          extraWaitMs: Number.isFinite(options?.extraWaitMs) ? Number(options.extraWaitMs) : 1500,
          downloadExternal: !!options?.downloadExternal,
          maxWaitMs: Number.isFinite(options?.maxWaitMs) ? Math.min(Number(options.maxWaitMs), MAX_WAIT_MS) : MAX_WAIT_MS,
        },
        workDir
      });

      jobs.set(id, { status: "done", createdAt: Date.now(), zipPath: finalZipPath, meta: { url } });
    } catch (err) {
      jobs.set(id, { status: "error", createdAt: Date.now(), error: err?.message ? err.message : String(err), meta: { url } });
      try { await fsp.rm(workDir, { recursive: true, force: true }); } catch {}
    }
  })();

  res.json({ jobId: id });
});

app.get("/api/jobs/:id", requireApiKey(API_KEY), (req, res) => {
  const id = req.params.id;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: "Not found" });

  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    jobId: id,
    status: job.status,
    createdAt: job.createdAt,
    error: job.error || null,
    url: job.meta?.url || null,
    downloadUrl: job.status === "done" ? `${base}/api/jobs/${id}/download` : null
  });
});

app.get("/api/jobs/:id/download", requireApiKey(API_KEY), (req, res) => {
  const id = req.params.id;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: "Not found" });
  if (job.status !== "done" || !job.zipPath) return res.status(400).json({ error: "Job not done" });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="site-clone-${id}.zip"`);
  fs.createReadStream(job.zipPath).pipe(res);
});

app.listen(PORT, () => console.log(`Headless Site Cloner listening on :${PORT}`));
