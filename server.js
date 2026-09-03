import express from 'express';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

let sock;
let isConnected = false;
let currentQR = null;

// Webhook & Activity Log Management
let currentWebhookUrl = null;
const activityLogs = [];
const MAX_LOGS = 25;
let logId = 0;

function addActivityLog(entry) {
    activityLogs.unshift({ id: logId++, timestamp: new Date().toISOString(), ...entry });
    if (activityLogs.length > MAX_LOGS) activityLogs.pop();
}

// Error Log Management
const errorLogs = [];
const MAX_ERROR_LOGS = 50;
let errorLogId = 0;

function addErrorLog(entry) {
    const item = {
        id: ++errorLogId,
        timestamp: new Date().toISOString(),
        type: entry.type || 'system',
        message: entry.message || '',
        details: entry.details ? (typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details)) : null
    };
    errorLogs.unshift(item);
    if (errorLogs.length > MAX_ERROR_LOGS) errorLogs.pop();
    console.error(`[ERROR] [${item.type}] ${item.message}`);
}

// Auto-cleanup logs & temporary sync files every 8 hours
const CLEANUP_INTERVAL_MS = 8 * 60 * 60 * 1000;
let lastCleanupTime = Date.now();

function performScheduledCleanup() {
    const actCount = activityLogs.length;
    const errCount = errorLogs.length;
    activityLogs.length = 0;
    errorLogs.length = 0;
    lastCleanupTime = Date.now();
    console.log(`[System] Auto-cleanup berkala (8 jam): ${actCount} log aktivitas & ${errCount} log error dibersihkan.`);

    // Bersihkan file pre-key / cache lama di auth_info_baileys agar disk tidak membengkak
    const dir = 'auth_info_baileys';
    if (fs.existsSync(dir)) {
        try {
            const files = fs.readdirSync(dir);
            const now = Date.now();
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;
            let cleanedFiles = 0;
            for (const file of files) {
                // Jangan sentuh kredensial utama
                if (file === 'creds.json' || file === 'api_key.txt' || file === 'admin_cred.json' || file === 'webhook_url.txt') {
                    continue;
                }
                // Hapus pre-key yang sudah lebih dari 24 jam
                if (file.startsWith('pre-key-') || file.startsWith('app-state-sync-version')) {
                    const filePath = path.join(dir, file);
                    try {
                        const stats = fs.statSync(filePath);
                        if (now - stats.mtimeMs > ONE_DAY_MS) {
                            fs.unlinkSync(filePath);
                            cleanedFiles++;
                        }
                    } catch {}
                }
            }
            if (cleanedFiles > 0) {
                console.log(`[System] Auto-cleanup: ${cleanedFiles} file pre-key kadaluwarsa dibersihkan dari disk.`);
            }
        } catch (e) {
            console.error('[System] Gagal auto-cleanup file:', e.message);
        }
    }
}

// Jalankan auto-cleanup setiap 8 jam
setInterval(performScheduledCleanup, CLEANUP_INTERVAL_MS);

function getOrSetWebhookUrl(newUrl) {
    const webhookPath = path.join('auth_info_baileys', 'webhook_url.txt');
    if (newUrl !== undefined) {
        const trimmed = String(newUrl).trim();
        try {
            if (!fs.existsSync('auth_info_baileys')) fs.mkdirSync('auth_info_baileys', { recursive: true });
            fs.writeFileSync(webhookPath, trimmed, 'utf8');
        } catch {}
        currentWebhookUrl = trimmed;
        return trimmed;
    }

    if (currentWebhookUrl !== null) return currentWebhookUrl;

    try {
        if (fs.existsSync(webhookPath)) {
            const saved = fs.readFileSync(webhookPath, 'utf8').trim();
            if (saved) { currentWebhookUrl = saved; return saved; }
        }
    } catch {}

    currentWebhookUrl = (process.env.WEBHOOK_URL || '').trim();
    return currentWebhookUrl;
}

async function forwardToWebhook(payload) {
    const url = getOrSetWebhookUrl();
    if (!url) return { success: false, status: 'No Webhook configured' };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) {
            addErrorLog({
                type: 'webhook',
                message: `Webhook endpoint merespon dengan status ${res.status} ${res.statusText}`,
                details: { url, event: payload?.event, from: payload?.from }
            });
            return { success: false, status: `${res.status} ${res.statusText}` };
        }

        return { success: true, status: `${res.status} ${res.statusText}` };
    } catch (err) {
        const errDesc = err.name === 'AbortError' ? 'Timeout (5s)' : err.message;
        addErrorLog({
            type: 'webhook',
            message: `Gagal mengirim payload ke webhook: ${errDesc}`,
            details: { url, error: err.message }
        });
        return { success: false, status: `Error: ${errDesc}` };
    }
}

let reconnectTimer = null;

function clearBaileysAuth() {
    const dir = 'auth_info_baileys';
    if (!fs.existsSync(dir)) return;
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (file !== 'api_key.txt' && file !== 'admin_cred.json' && file !== 'webhook_url.txt') {
                try { fs.rmSync(path.join(dir, file), { recursive: true, force: true }); } catch {}
            }
        }
        console.log('[WhatsApp] Sesi lama dibersihkan dari auth_info_baileys.');
    } catch (err) {
        console.error('[WhatsApp] Gagal membersihkan auth:', err.message);
    }
}

async function connectToWhatsApp () {
    clearTimeout(reconnectTimer);

    if (sock) {
        try {
            sock.ev.removeAllListeners();
            sock.end(undefined);
        } catch {}
        sock = null;
    }

    let { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // AUTO-DELETE: Jika sesi di disk belum pernah terhubung/pairing (tidak ada state.creds.me),
    // bersihkan sesi gantung agar Baileys selalu meminta QR Code baru yang segar dari WhatsApp!
    if (!state.creds?.me) {
        const credFile = path.join('auth_info_baileys', 'creds.json');
        if (fs.existsSync(credFile)) {
            console.log('[WhatsApp] Mendeteksi kredensial gantung yang belum terhubung. Auto-delete...');
            clearBaileysAuth();
            const fresh = await useMultiFileAuthState('auth_info_baileys');
            state = fresh.state;
            saveCreds = fresh.saveCreds;
        }
    }
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) {
            currentQR = qr;
            console.log('\n[WhatsApp] QR Code siap di-scan via Web Dashboard di port ' + PORT);
        }
        if(connection === 'close') {
            isConnected = false;
            currentQR = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const errMessage = lastDisconnect?.error?.message || 'Connection closed';
            console.log(`[WhatsApp] Koneksi terputus. Status Code: ${statusCode}`);

            addErrorLog({
                type: 'whatsapp',
                message: `Koneksi terputus (Status: ${statusCode || 'Unknown'}): ${errMessage}`,
                details: { statusCode, error: lastDisconnect?.error?.stack || errMessage }
            });

            // AUTO-DELETE: Jika belum login atau sesi logout (401), hapus sesi lama agar QR baru muncul
            if (!state.creds?.me || statusCode === DisconnectReason.loggedOut) {
                console.log('[WhatsApp] Sesi pairing belum tersambung / kedaluwarsa. Auto-delete kredensial lama...');
                clearBaileysAuth();
            }

            // Selalu jadwalkan reconnect otomatis agar QR code selalu tersedia di dashboard
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                connectToWhatsApp();
            }, 3000);
        } else if(connection === 'open') {
            isConnected = true;
            currentQR = null;
            clearTimeout(reconnectTimer);
            console.log('[WhatsApp] WhatsApp connection opened successfully!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages?.[0];
            if (!msg || !msg.message || msg.key.fromMe) return;

            // Extract text from conversation, extendedTextMessage, or caption
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         '';

            const sender = msg.key.remoteJid;
            const isGroup = sender.endsWith('@g.us');
            const pushName = msg.pushName || '';
            const trimmed = text.trim();
            const isCommand = trimmed.toLowerCase().startsWith('nad,');
            const command = isCommand ? trimmed.slice(4).trim() : null;

            // Forward to Webhook asynchronously (non-blocking)
            const webhookPayload = {
                event: 'messages.upsert',
                from: sender,
                isGroup,
                pushName,
                message: text,
                isCommand,
                command,
                timestamp: Math.floor(Date.now() / 1000)
            };

            forwardToWebhook(webhookPayload).then(whResult => {
                addActivityLog({
                    from: sender,
                    pushName,
                    isGroup,
                    message: text.slice(0, 100),
                    isCommand,
                    command,
                    webhookStatus: whResult.status
                });

                if (!whResult.success && currentWebhookUrl) {
                    console.warn(`[Webhook Delivery]: ${whResult.status}`);
                }
            });

            if (isCommand) {
                console.log(`[Command Received] from: ${sender} (Group: ${isGroup}), command: "${command}"`);

                const replyText = `[Nad Bot]\nCommand diterima: "${command || '(kosong)'}"\nStatus: Menunggu perizinan/integrasi logika.`;
                await sock.sendMessage(sender, { text: replyText }, { quoted: msg });
            }
        } catch (err) {
            console.error('Error handling incoming message:', err);
        }
    });
}

// Shared helper: read from file or run generator and persist result
function readOrCreate(filePath, generator) {
    try {
        if (fs.existsSync(filePath)) {
            const saved = fs.readFileSync(filePath, 'utf8').trim();
            if (saved) return saved;
        }
    } catch {}
    const value = generator();
    try {
        if (!fs.existsSync('auth_info_baileys')) fs.mkdirSync('auth_info_baileys', { recursive: true });
        fs.writeFileSync(filePath, value, 'utf8');
    } catch {}
    return value;
}

function getOrGenerateApiKey() {
    if (process.env.API_KEY?.trim()) return process.env.API_KEY.trim();
    return readOrCreate(
        path.join('auth_info_baileys', 'api_key.txt'),
        () => crypto.randomBytes(16).toString('hex')
    );
}

const API_KEY = getOrGenerateApiKey();

// Admin Authentication Setup with Scrypt Hashing
function getOrGenerateAdminCredentials() {
    const credPath = path.join('auth_info_baileys', 'admin_cred.json');
    let plainPassword = (process.env.ADMIN_PASSWORD || '').trim();
    let isAutoGenerated = false;

    if (!plainPassword) {
        try {
            if (fs.existsSync(credPath)) {
                const saved = JSON.parse(fs.readFileSync(credPath, 'utf8'));
                if (saved.hash && saved.salt) return { username: 'admin', salt: saved.salt, hash: saved.hash };
            }
        } catch {}
        plainPassword = crypto.randomBytes(6).toString('hex');
        isAutoGenerated = true;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plainPassword, salt, 64).toString('hex');

    try {
        if (!fs.existsSync('auth_info_baileys')) fs.mkdirSync('auth_info_baileys', { recursive: true });
        fs.writeFileSync(credPath, JSON.stringify({ username: 'admin', salt, hash }), 'utf8');
    } catch {}

    return { username: 'admin', salt, hash, plainPassword: isAutoGenerated ? plainPassword : null };
}

const ADMIN_CRED = getOrGenerateAdminCredentials();
const activeSessions = new Set();

function verifyPassword(inputPassword, salt, expectedHash) {
    if (!inputPassword || typeof inputPassword !== 'string') return false;
    try {
        const inputHash = crypto.scryptSync(inputPassword, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(inputHash, 'hex'), Buffer.from(expectedHash, 'hex'));
    } catch {
        return false;
    }
}

function requireAuth(req, res, next) {
    const token = req.headers['x-api-key'] || req.query.api_key;
    if (!token || (token !== API_KEY && !activeSessions.has(token))) {
        return res.status(401).json({ error: 'Unauthorized: Harap login terlebih dahulu atau gunakan API Key yang valid' });
    }
    next();
}

app.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username !== 'admin' || !verifyPassword(password, ADMIN_CRED.salt, ADMIN_CRED.hash)) {
        return res.status(401).json({ error: 'Username atau password salah' });
    }
    const sessionToken = crypto.randomBytes(32).toString('hex');
    activeSessions.add(sessionToken);
    res.json({ success: true, token: sessionToken, username: 'admin' });
});

app.post('/logout', (req, res) => {
    const token = req.headers['x-api-key'] || req.query.api_key;
    if (token) activeSessions.delete(token);
    res.json({ success: true });
});

app.get('/status', (req, res) => {
    const token = req.headers['x-api-key'] || req.query.api_key;
    const isAuthed = token && (token === API_KEY || activeSessions.has(token));

    if (!isAuthed) {
        return res.status(401).json({ error: 'Unauthorized', requiresAuth: true });
    }

    res.json({ connected: isConnected, qr: currentQR });
});

app.get('/webhook', requireAuth, (req, res) => {
    res.json({ webhookUrl: getOrSetWebhookUrl() });
});

app.post('/webhook', requireAuth, (req, res) => {
    const { url } = req.body || {};
    const updated = getOrSetWebhookUrl(url !== undefined ? url : '');
    res.json({ success: true, webhookUrl: updated });
});

app.post('/webhook/test', requireAuth, async (req, res) => {
    const testPayload = {
        event: 'test',
        message: 'Ping dari WhatsAPI Gateway',
        timestamp: Math.floor(Date.now() / 1000)
    };
    const result = await forwardToWebhook(testPayload);
    res.json(result);
});

app.get('/logs', requireAuth, (req, res) => {
    res.json({ logs: activityLogs });
});

app.get('/apikey', requireAuth, (req, res) => {
    res.json({ apiKey: API_KEY });
});

app.get('/groups', requireAuth, async (req, res) => {
    if (!sock || !isConnected) {
        return res.status(503).json({ error: 'WhatsApp belum terhubung. Scan QR terlebih dahulu.' });
    }
    try {
        const groups = await sock.groupFetchAllParticipating();
        const list = Object.entries(groups).map(([jid, meta]) => ({
            jid,
            name: meta.subject || '(Tanpa Nama)',
            participantCount: meta.participants?.length || 0
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ groups: list });
    } catch (err) {
        res.status(500).json({ error: 'Gagal mengambil daftar grup: ' + err.message });
    }
});

app.post('/reconnect', requireAuth, (req, res) => {
    try {
        currentQR = null;
        clearTimeout(reconnectTimer);
        // Jika belum terhubung, bersihkan sesi lama agar Baileys meminta QR baru yang segar
        if (!isConnected) {
            clearBaileysAuth();
        }
        connectToWhatsApp();
        res.json({ success: true, message: 'Menghubungkan ulang sesi...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/reset-session', requireAuth, (req, res) => {
    try {
        isConnected = false;
        currentQR = null;
        clearTimeout(reconnectTimer);
        clearBaileysAuth();
        connectToWhatsApp();
        res.json({ success: true, message: 'Sesi berhasil direset. Kode QR baru sedang dibuat...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/send', requireAuth, async (req, res) => {
    try {
        let { to, message } = req.body;
        if (!to || typeof to !== 'string' || !message || typeof message !== 'string') {
            const errTxt = 'Missing or invalid "to" or "message" (must be non-empty strings)';
            addErrorLog({ type: 'send', message: errTxt, details: req.body });
            return res.status(400).json({ error: errTxt });
        }

        if (message.length > 4096) {
            const errTxt = 'Message exceeds maximum limit of 4096 characters';
            addErrorLog({ type: 'send', message: errTxt });
            return res.status(400).json({ error: errTxt });
        }

        if (!sock || !isConnected) {
            const errTxt = 'WhatsApp not connected yet. Please scan the QR code first.';
            addErrorLog({ type: 'send', message: errTxt, details: { to } });
            return res.status(503).json({ error: errTxt });
        }

        let target = to.trim();
        // Bersihkan prefix "JID:", "jid:", atau whitespace yang tidak sengaja tertempel
        target = target.replace(/^jid\s*:?\s*/i, '').trim();

        // Normalisasi tujuan
        if (!target.includes('@')) {
            // Hilangkan tanda + jika ada
            if (target.startsWith('+')) target = target.slice(1);
            // Ubah format lokal Indonesia 08xxx ke 628xxx
            if (target.startsWith('08')) {
                target = '62' + target.slice(1);
            }
            // Bersihkan sisa karakter non-angka
            target = target.replace(/[^0-9]/g, '');

            // Deteksi grup WhatsApp (nomor grup berdigit banyak dimulai 12036...)
            if (target.startsWith('12036') && target.length >= 17) {
                target = `${target}@g.us`;
            } else {
                target = `${target}@s.whatsapp.net`;
            }
        } else {
            // Sudah memiliki domain @, bersihkan karakter aneh
            target = target.replace(/[^0-9@.a-z_-]/gi, '');
        }

        if (target.length < 7) {
            const errTxt = 'Invalid destination phone number or JID';
            addErrorLog({ type: 'send', message: errTxt, details: { to, target } });
            return res.status(400).json({ error: errTxt });
        }

        console.log(`[WhatsApp] Mengirim pesan ke ${target}...`);
        const sentResult = await sock.sendMessage(target, { text: message });

        addActivityLog({
            from: target,
            pushName: 'Keluar (API)',
            message: message,
            isGroup: target.endsWith('@g.us'),
            isCommand: false,
            command: null,
            webhookStatus: 'N/A'
        });

        res.json({ status: 'sent', to: target, messageId: sentResult?.key?.id });
    } catch (err) {
        console.error('Error sending message:', err);
        addErrorLog({
            type: 'send',
            message: `Gagal mengirim pesan ke ${req.body?.to || 'target'}: ${err.message}`,
            details: { to: req.body?.to, error: err.stack || err.message }
        });
        res.status(500).json({ error: 'Failed to send message', details: err.message });
    }
});

app.get('/error-logs', requireAuth, (req, res) => {
    res.json({ errors: errorLogs });
});

app.post('/error-logs/clear', requireAuth, (req, res) => {
    errorLogs.length = 0;
    res.json({ success: true, message: 'Log error berhasil dikosongkan.' });
});

app.post('/logs/cleanup', requireAuth, (req, res) => {
    performScheduledCleanup();
    res.json({ success: true, message: 'Pembersihan berkala berhasil dijalankan (log & cache dikosongkan).' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`\n======================================================`);
    console.log(`👤 [WEB GUI LOGIN]:`);
    console.log(`   Username : admin`);
    if (ADMIN_CRED.plainPassword) {
        console.log(`   Password : ${ADMIN_CRED.plainPassword} (Auto-generated & di-hash dengan scrypt)`);
    } else {
        console.log(`   Password : [Diatur via .env ADMIN_PASSWORD & di-hash dengan scrypt]`);
    }
    console.log(`🔑 [API KEY PROGRAMMATIK]: ${API_KEY}`);
    console.log(`======================================================\n`);
    connectToWhatsApp();
});
