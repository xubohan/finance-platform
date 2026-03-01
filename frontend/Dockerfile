FROM node:20-alpine

WORKDIR /app

COPY package*.json /app/
RUN npm ci

COPY . /app
RUN npm run build

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
