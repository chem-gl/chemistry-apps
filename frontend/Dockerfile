# frontend/Dockerfile: Imagenes Docker para desarrollo (watch) y produccion (build + nginx).
# Build timestamp: 2026-09-24T16:00:00Z - force fresh build

FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4200
CMD ["npm", "run", "start"]

FROM node:20-alpine AS build
WORKDIR /app
ARG API_BASE_URL=/api
ARG BUILD_TIMESTAMP=unknown
COPY package*.json ./
RUN npm ci
COPY . .
# El bundle compilado lleva el id de build en appVersion y el mismo id se
# publica en version.json. Al desplegar, app.ts detecta el cambio de
# version.json y recarga: sin esto ambos quedaban fijos en "1.0.0" y los
# clientes viejos seguían pidiendo chunks que ya no existen.
RUN sed -i "s|http://localhost:8000|${API_BASE_URL}|g" src/environments/environment.production.ts \
    && sed -i "s|appVersion: '[^']*'|appVersion: '${BUILD_TIMESTAMP}'|" src/environments/environment.production.ts \
    && printf '{\n  "version": "%s"\n}\n' "${BUILD_TIMESTAMP}" > public/version.json \
    && npm run build \
    && mkdir -p /tmp/frontend-dist \
    && if [ -d dist/frontend/browser ]; \
    then cp -r dist/frontend/browser/. /tmp/frontend-dist/; else cp -r dist/frontend/. /tmp/frontend-dist/; fi

FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /tmp/frontend-dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
