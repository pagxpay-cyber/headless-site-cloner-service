import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promises as fsp } from "fs";

import { renderAndZip } from "./src/render.js";
import { isUrlAllowed, requireApiKey } from "./src/security.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const API_KEY = process.env.API_KEY || "";
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();


// Railway (and similar) may probe "/" to determine readiness.
app.get("/", (req, res) => res.status(200).send("ok"));
app.head("/health", (req, res) => res.status(200).end());

app.use(express.json({ limit: "2mb" }));

// In-memory job store (ephemeral). Persist by downloading ZIP from WordPress.
const jobs = new Map();

function now() {
  return Date.now();
}

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, ts: now() });
});

app.post("/api/jobs", requireApiKey(API_KEY), async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const options = req.body?.options || {};

    if (!url) return res.status(400).json({ error: "Missing url" });

    const allow = await isUrlAllowed(url, ALLOWED_HOSTS);
    if (!allow.ok) return res.status(400).json({ error: allow.reason || "URL not allowed" });

    const jobId = crypto.randomBytes(10).toString("hex");
    const workDir = path.join("/tmp", "wpsc-jobs", jobId);
    await fsp.mkdir(workDir, { recursive: true });

    const job = {
      id: jobId,
      status: "queued",
      createdAt: now(),
      updatedAt: now(),
      url,
      options,
      progress: { stage: "queued", message: "Queued" },
      zipPath: null,
      error: null,
    };
    jobs.set(jobId, job);

    // Fire and forget
    (async () => {
      job.status = "running";
      job.updatedAt = now();
      job.progress = { stage: "running", message: "Launching browser" };

      try {
        const zipPath = await renderAndZip({
          jobId,
          url,
          workDir,
          options,
          onProgress: (p) => {
            job.progress = p;
            job.updatedAt = now();
          },
        });

        job.status = "done";
        job.updatedAt = now();
        job.zipPath = zipPath;
        job.progress = { stage: "done", message: "ZIP ready" };
      } catch (e) {
        job.status = "error";
        job.updatedAt = now();
        job.error = (e && e.message) ? e.message : String(e);
        job.progress = { stage: "error", message: job.error };
      }
    })();

    return res.status(200).json({ jobId });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) ? e.message : String(e) });
  }
});

app.get("/api/jobs/:id", requireApiKey(API_KEY), (req, res) => {
  const id = req.params.id;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ error: "Not found" });

  const base = `${req.protocol}://${req.get("host")}`;
  const downloadUrl = job.status === "done" ? `${base}/api/jobs/${encodeURIComponent(id)}/download` : null;

  res.status(200).json({
    jobId: id,
    status: job.status,
    url: job.url,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    downloadUrl,
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

// IMPORTANT for Railway: listen on 0.0.0.0

process.on("SIGTERM", () => {
  console.log("[SIGTERM] Received. Closing server...");
  // Let Railway drain connections
  setTimeout(() => process.exit(0), 1000).unref();
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`Headless Site Cloner listening on 0.0.0.0:${PORT}`);
});
