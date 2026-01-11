import express from "express";
import crypto from "crypto";
import path from "path";
import { promises as fsp } from "fs";
import { renderAndZip } from "./src/render.js";
import { isUrlAllowed, requireApiKey } from "./src/security.js";

const app = express();
const PORT = process.env.PORT || 8090;
const API_KEY = process.env.API_KEY || "";

// Armazenamento temporário dos jobs
const jobs = new Map();

app.use(express.json({ limit: "2mb" }));

// Health Check para o CloudPanel/Railway
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

app.post("/api/jobs", requireApiKey(API_KEY), async (req, res) => {
    try {
        const { url, options } = req.body;
        if (!url) return res.status(400).json({ error: "URL é obrigatória" });

        const jobId = crypto.randomBytes(8).toString("hex");
        const workDir = path.join("/tmp", "cloner", jobId);
        await fsp.mkdir(workDir, { recursive: true });

        // Inicializa o objeto do job
        const job = { 
            id: jobId, 
            status: "running", 
            url, 
            zipPath: null, 
            createdAt: Date.now() 
        };
        jobs.set(jobId, job);

        // Execução em background
        // O renderAndZip agora aguarda o evento 'close' do ZIP antes de resolver 
        renderAndZip({ jobId, url, workDir, options })
            .then(zipPath => {
                job.status = "done";
                job.zipPath = zipPath;
                job.updatedAt = Date.now();
                console.log(`[Job ${jobId}] Concluído com sucesso.`);
            })
            .catch(err => {
                job.status = "error";
                job.error = err.message;
                job.updatedAt = Date.now();
                console.error(`[Job ${jobId}] Erro:`, err.message);
            });

        // Retorna o ID imediatamente para o WordPress começar o polling
        res.json({ jobId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/jobs/:id", requireApiKey(API_KEY), (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job não encontrado" });

    const base = `${req.protocol}://${req.get("host")}`;
    const downloadUrl = job.status === "done" ? `${base}/api/jobs/${job.id}/download` : null;

    res.json({
        jobId: job.id,
        status: job.status,
        error: job.error,
        downloadUrl
    });
});

app.get("/api/jobs/:id/download", requireApiKey(API_KEY), (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.status !== "done" || !job.zipPath) {
        return res.status(400).json({ error: "Download não disponível ou job incompleto" });
    }

    // Envia o arquivo e define o nome do download
    res.download(job.zipPath, `site-clone-${job.id}.zip`);
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});
