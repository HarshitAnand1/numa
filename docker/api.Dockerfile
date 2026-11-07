# numa API (runs TypeScript directly with tsx; workspace packages are consumed from source)
FROM node:22-slim
ENV NODE_ENV=production
RUN npm install -g pnpm@10.34.9 && useradd --create-home numa
WORKDIR /app

# Manifests first so dependency installation is cached until package.json / lockfile change
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/arkiv/package.json packages/arkiv/
COPY packages/sdk-server/package.json packages/sdk-server/
COPY packages/sdk-react/package.json packages/sdk-react/
RUN pnpm install --frozen-lockfile --filter "@numa/api..." --prod=false

COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/arkiv packages/arkiv
COPY packages/sdk-server packages/sdk-server
COPY packages/sdk-react packages/sdk-react
COPY apps/api apps/api

USER numa
WORKDIR /app/apps/api
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "start"]
