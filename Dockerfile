FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3741 DATA_DIR=/data
ENV ZNOTE_YTDLP=/opt/media/bin/yt-dlp ZNOTE_FFMPEG=/usr/bin/ffmpeg FFMPEG_BIN=/usr/bin/ffmpeg
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3-venv ca-certificates && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/media && /opt/media/bin/pip install --no-cache-dir yt-dlp==2026.8.19
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY extensions ./extensions
USER node
VOLUME /data
EXPOSE 3741
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3741/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
