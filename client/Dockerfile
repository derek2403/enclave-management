FROM node:20-slim AS build
ARG VITE_API_DOMAIN
ARG VITE_DASHBOARD_DOMAIN
ENV VITE_API_DOMAIN=$VITE_API_DOMAIN
ENV VITE_DASHBOARD_DOMAIN=$VITE_DASHBOARD_DOMAIN
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim
RUN npm install -g serve
COPY --from=build /app/dist /app
EXPOSE 5173
CMD ["serve", "-s", "/app", "-l", "5173"]