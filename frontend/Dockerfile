# frontend/Dockerfile: Imagenes Docker para desarrollo (watch) y produccion (build + nginx).

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
COPY package*.json ./
RUN npm ci
COPY . .
RUN sed -i "s|http://localhost:8000|${API_BASE_URL}|g" src/environments/environment.production.ts \
    && npm run build \
    && mkdir -p /tmp/frontend-dist \
    && if [ -d dist/frontend/browser ]; \
    then cp -r dist/frontend/browser/. /tmp/frontend-dist/; else cp -r dist/frontend/. /tmp/frontend-dist/; fi

FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /tmp/frontend-dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
