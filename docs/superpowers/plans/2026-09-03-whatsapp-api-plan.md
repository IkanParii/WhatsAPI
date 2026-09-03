# WhatsApp API & Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight Dockerized WhatsApp API with an Express server to send messages and a Baileys bot to listen for "nad," commands.

**Architecture:** Node.js app using `@whiskeysockets/baileys` for WhatsApp WebSocket connection and Express for the HTTP API. State is saved to disk and mounted via Docker volume.

**Tech Stack:** Node.js, Express, `@whiskeysockets/baileys`, `qrcode-terminal`, Docker.

**Spec:** docs/superpowers/specs/2026-09-03-whatsapp-api-design.md

## Global Constraints

- Must use `@whiskeysockets/baileys` (no headless browser).
- Must use Docker (`node:18-alpine` or `20-alpine`).
- Minimal boilerplate, rely on native Node.js features where possible (Ponytail rules active).

---

### Task 1: Project Scaffolding & Dependencies

**Files:**
- Create: `package.json`

**Interfaces:**
- Consumes: N/A
- Produces: Base project structure and dependencies.

- [ ] **Step 1: Initialize project and write package.json**

```json
{
  "name": "whatsapi",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.5",
    "express": "^4.19.2",
    "pino": "^9.1.0",
    "qrcode-terminal": "^0.12.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules` and `package-lock.json` are created successfully.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: project setup and dependencies"
```

---

### Task 2: Core Server & WhatsApp Connection Manager

**Files:**
- Create: `server.js`

**Interfaces:**
- Consumes: Dependencies from Task 1.
- Produces: `sock` object (Baileys socket) available for API endpoints.

- [ ] **Step 1: Write core server logic**

Create `server.js` with the minimal Express and Baileys setup.

```javascript
import express from 'express';
import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

let sock;

async function connectToWhatsApp () {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }) // Minimal logging
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) {
            qrcode.generate(qr, {small: true});
        }
        if(connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            if(shouldReconnect) {
                connectToWhatsApp();
            }
        } else if(connection === 'open') {
            console.log('opened connection');
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    connectToWhatsApp();
});
```

- [ ] **Step 2: Run server to verify QR generation**

Run: `node server.js`
Expected: Prints a QR code to the terminal, Express listens on 3000. Stop it after verification (Ctrl+C).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: core server and whatsapp connection manager"
```

---

### Task 3: HTTP API Endpoint (Send Message)

**Files:**
- Modify: `server.js:40-42` (insert before `app.listen`)

**Interfaces:**
- Consumes: `sock` from Task 2.
- Produces: `POST /send` endpoint.

- [ ] **Step 1: Write the endpoint logic**

Add the `/send` endpoint to `server.js` before `app.listen`.

```javascript
app.post('/send', async (req, res) => {
    try {
        const { to, message } = req.body;
        if (!to || !message) return res.status(400).json({ error: 'Missing "to" or "message"' });
        if (!sock) return res.status(503).json({ error: 'WhatsApp not connected yet' });

        // Ensure proper WhatsApp ID format (basic validation)
        const id = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        
        await sock.sendMessage(id, { text: message });
        res.json({ status: 'sent' });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});
```

- [ ] **Step 2: Start server and test with curl**

Run in terminal 1: `node server.js`
Run in terminal 2: `curl -X POST -H "Content-Type: application/json" -d "{\"to\":\"12345\", \"message\":\"test\"}" http://localhost:3000/send`
Expected: `{"error":"WhatsApp not connected yet"}` (or if connected, `{"status":"sent"}`).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add /send HTTP endpoint"
```

---

### Task 4: Incoming Message Listener (Prefix "nad,")

**Files:**
- Modify: `server.js:37-39` (inside `connectToWhatsApp`, below connection event)

**Interfaces:**
- Consumes: `sock` from Task 2.
- Produces: Auto-responder for messages starting with `nad,`.

- [ ] **Step 1: Write message listener logic**

Add the `messages.upsert` listener inside `connectToWhatsApp` function.

```javascript
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        if (text.toLowerCase().startsWith('nad,')) {
            const replyText = "Command diterima. (Menunggu integrasi sistem lebih lanjut)";
            await sock.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
        }
    });
```

- [ ] **Step 2: Validate syntax**

Run: `node --check server.js`
Expected: No syntax errors. (Manual testing requires scanning QR with a real WA account).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add message listener for prefix nad,"
```

---

### Task 5: Dockerization

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: Full working Node.js application.
- Produces: Docker container setup with persistent volume for WhatsApp auth.

- [ ] **Step 1: Write .dockerignore**

```text
node_modules
auth_info_baileys
.git
```

- [ ] **Step 2: Write Dockerfile**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 3: Write docker-compose.yml**

```yaml
version: '3.8'
services:
  whatsapi:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./auth_info_baileys:/app/auth_info_baileys
    restart: unless-stopped
```

- [ ] **Step 4: Verify Docker configuration**

Run: `docker-compose config`
Expected: Parses successfully, displaying the compiled configuration.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "chore: add docker configuration for deployment"
```
