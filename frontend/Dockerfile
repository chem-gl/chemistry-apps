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
# Las fuentes KaTeX salen del build bajo `media/`, pero en produccion Nginx
# proxya `/media/` al backend Django (archivos de usuario) y daria 404.
# Se reubican a `fonts/` (mismo origen del frontend) y se reescribe el CSS.
# El CSS se renombra con el id de build: el nombre con hash de Angular no
# cambia al editarlo en caliente y los navegadores servirian el CSS viejo
# cacheado (con urls a /media/).
RUN sed -i "s|http://localhost:8000|${API_BASE_URL}|g" src/environments/environment.production.ts \
    && sed -i "s|appVersion: '[^']*'|appVersion: '${BUILD_TIMESTAMP}'|" src/environments/environment.production.ts \
    && printf '{\n  "version": "%s"\n}\n' "${BUILD_TIMESTAMP}" > public/version.json \
    && npm run build \
    && mkdir -p /tmp/frontend-dist \
    && if [ -d dist/frontend/browser ]; \
    then cp -r dist/frontend/browser/. /tmp/frontend-dist/; else cp -r dist/frontend/. /tmp/frontend-dist/; fi \
    && mkdir -p /tmp/frontend-dist/fonts \
    && mv /tmp/frontend-dist/media/KaTeX_* /tmp/frontend-dist/fonts/ 2>/dev/null || true \
    && sed -i 's|\./media/KaTeX_|./fonts/KaTeX_|g' /tmp/frontend-dist/styles-*.css \
    && CSS_BUNDLE=$(ls /tmp/frontend-dist/styles-*.css | head -n 1) \
    && CSS_VERSIONED="/tmp/frontend-dist/styles-${BUILD_TIMESTAMP}.css" \
    && mv "$CSS_BUNDLE" "$CSS_VERSIONED" \
    && sed -i "s|styles-[A-Za-z0-9]*\.css|styles-${BUILD_TIMESTAMP}.css|g" /tmp/frontend-dist/index.html

FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /tmp/frontend-dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
