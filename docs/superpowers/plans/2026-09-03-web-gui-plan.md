# Web GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight, self-contained Web Dashboard for WhatsAPI to scan QR and send messages.

**Architecture:** Update `server.js` to store the latest QR string and expose it in `GET /status`, serve static files from `public/`, and create `public/index.html`.

**Tech Stack:** Express, HTML5, Vanilla JS, CSS.

---

### Task 1: Update Server with QR in /status and Static File Serving

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Update server.js**
Add `let currentQR = null;`, update `currentQR` on `connection.update`, clear it on `connection === 'open'`, return `{ connected: isConnected, qr: currentQR }` in `/status`, and add `app.use(express.static('public'))`.

- [ ] **Step 2: Verify syntax**
Run `node --check server.js`.

- [ ] **Step 3: Commit**
`git commit -am "feat: serve static files and expose qr in /status"`

---

### Task 2: Create Web GUI (public/index.html)

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Build public/index.html**
Include QR rendering, status polling, and message sending form.

- [ ] **Step 2: Commit**
`git add public/index.html && git commit -m "feat: add web dashboard UI"`
