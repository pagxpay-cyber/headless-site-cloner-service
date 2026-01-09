# Dockerfile for Railway/VPS (Puppeteer + Chromium)
FROM ghcr.io/puppeteer/puppeteer:23.6.0

WORKDIR /app

# Install deps first (better cache)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy app
COPY . .

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
