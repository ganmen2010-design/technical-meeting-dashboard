FROM node:20-alpine

# 安裝 Python 3 與 pip 以支援後台 Excel 掃描與雙向寫入
RUN apk add --no-cache python3 py3-pip bash

WORKDIR /app

# 複製依賴描述
COPY package*.json ./
COPY requirements.txt ./

# 安裝 Node.js 與 Python 依賴
RUN npm install --omit=dev && \
    python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

ENV PATH="/opt/venv/bin:$PATH"
ENV NODE_ENV=production
ENV PORT=8090

# 複製應用程式原始碼
COPY . .

EXPOSE 8090

CMD ["node", "server.js"]
