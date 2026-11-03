# OPNduck Server. Build from the repository root:
#   docker build -f server/Dockerfile -t opnduck-server .            (the default image)
#   docker build -f server/Dockerfile --target full -t opnduck-server:full .   (adds LibreOffice for document conversion)
# GPU: AMD/Intel with `--device /dev/dri`; NVIDIA with the NVIDIA Container Toolkit and NVIDIA_DRIVER_CAPABILITIES=all
# (Vulkan and NVENC both need it). See server/docker-compose.yml.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY electron ./electron
COPY engine-api ./engine-api
COPY server ./server
COPY scripts/build-server.mjs ./scripts/build-server.mjs
RUN node scripts/build-server.mjs

FROM node:22-bookworm-slim AS latest
ARG REALESRGAN_URL=https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/download/v0.2.0/realesrgan-ncnn-vulkan-v0.2.0-ubuntu.zip
ARG RIFE_URL=https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-ubuntu.zip
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl unzip libvulkan1 mesa-vulkan-drivers vulkan-tools tini \
 && rm -rf /var/lib/apt/lists/*
# The two upscalers sit next to their model folders; a symlink on PATH keeps the models findable (the tools look beside their own file).
RUN set -eux; mkdir -p /opt/ncnn; \
    curl -fsSL "$REALESRGAN_URL" -o /tmp/re.zip; echo "d0e8e1cf954f5cde11be4745dd912cc3774bef36f71c5b1cb8f74c4112b6e919  /tmp/re.zip" | sha256sum -c -; unzip -q /tmp/re.zip -d /opt/ncnn/realesrgan; \
    curl -fsSL "$RIFE_URL" -o /tmp/rife.zip; echo "1e2c7ee7fa7daa326542d50622f0afedc80cf6f1858bda411d16385ffa5cdf68  /tmp/rife.zip" | sha256sum -c -; unzip -q /tmp/rife.zip -d /opt/ncnn/rife; rm /tmp/*.zip; \
    for d in realesrgan rife; do inner="$(find /opt/ncnn/$d -maxdepth 1 -mindepth 1 -type d | head -1)"; if [ -n "$inner" ]; then mv "$inner"/* /opt/ncnn/$d/; fi; done; \
    chmod +x /opt/ncnn/realesrgan/realesrgan-ncnn-vulkan /opt/ncnn/rife/rife-ncnn-vulkan; \
    ln -s /opt/ncnn/realesrgan/realesrgan-ncnn-vulkan /usr/local/bin/realesrgan-ncnn-vulkan; \
    ln -s /opt/ncnn/rife/rife-ncnn-vulkan /usr/local/bin/rife-ncnn-vulkan
# yt-dlp lives where the server user may replace it, so it can update itself on start.
# Checked against the release's own SHA2-256SUMS file (the newest release; it updates itself later).
RUN mkdir -p /opt/yt-dlp && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /opt/yt-dlp/yt-dlp \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS -o /tmp/ytsums \
 && (cd /opt/yt-dlp && grep ' yt-dlp_linux$' /tmp/ytsums | sed 's/yt-dlp_linux$/yt-dlp/' | sha256sum -c -) && rm /tmp/ytsums \
 && chmod 0755 /opt/yt-dlp/yt-dlp && ln -s /opt/yt-dlp/yt-dlp /usr/local/bin/yt-dlp
RUN useradd --create-home --uid 1001 opnduck && mkdir -p /data && chown opnduck:opnduck /data /opt/yt-dlp /opt/yt-dlp/yt-dlp
COPY --from=build /src/dist-server /opt/opnduck-server
COPY server/docker-entrypoint.sh /usr/local/bin/opnduck-entrypoint
RUN chmod +x /usr/local/bin/opnduck-entrypoint && printf '#!/bin/sh\nexec node /opt/opnduck-server/opnduck-server.cjs "$@"\n' > /usr/local/bin/opnduck-server && chmod +x /usr/local/bin/opnduck-server
ENV OPNDUCK_DATA=/data OPNDUCK_BIND=0.0.0.0 OPNDUCK_PORT=47821 NVIDIA_DRIVER_CAPABILITIES=all
USER opnduck
VOLUME /data
EXPOSE 47821
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.OPNDUCK_PORT||47821)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/opnduck-entrypoint"]
CMD ["serve"]

FROM latest AS full
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress libreoffice-calc && rm -rf /var/lib/apt/lists/*
USER opnduck
