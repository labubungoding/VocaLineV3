FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app

COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY templates ./templates

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/main.ts"]
