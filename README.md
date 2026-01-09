# Headless Site Cloner Service (Chromium + Puppeteer)

Renders SPA pages in a real Chromium browser and exports a static ZIP with:
- rendered HTML after JS (`page.content()`)
- all captured network responses (best-effort)
- URL rewriting to local assets (best-effort)

Auth: `X-API-Key: <API_KEY>`

## Run
### Docker
```bash
docker build -t headless-site-cloner .
docker run -p 3000:3000 -e API_KEY=change-me headless-site-cloner
```

### Node
```bash
npm install
cp .env.example .env
npm start
```

## API
### Create job
`POST /api/jobs`
```json
{
  "url":"https://example.com/",
  "options":{
    "routes":["/"],
    "waitUntil":"networkidle0",
    "extraWaitMs":1500,
    "downloadExternal":false,
    "maxWaitMs":45000
  }
}
```

### Poll
`GET /api/jobs/:id`

### Download ZIP
`GET /api/jobs/:id/download`

> Use only for websites you own or have permission to archive.
