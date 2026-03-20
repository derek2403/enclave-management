FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5173
# We use --host to allow the Docker network to see the Vite dev server
CMD ["npm", "run", "dev", "--", "--host"]