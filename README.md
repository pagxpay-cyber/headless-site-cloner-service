# Headless Site Cloner Service (Chromium)

Endpoints:
- GET /health -> 200
- POST /api/jobs -> { jobId }
- GET /api/jobs/:id -> job status + downloadUrl when done
- GET /api/jobs/:id/download -> ZIP stream

Env:
- API_KEY (recommended)
- ALLOWED_HOSTS (comma-separated, optional)
- PORT (provided by Railway)

Notes:
- Must listen on 0.0.0.0:$PORT (already configured).
