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

EXPOSE 3000
CMD ["npm", "start"]
