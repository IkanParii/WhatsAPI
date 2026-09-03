import express from 'express';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
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

async function connectToWhatsApp () {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) {
            currentQR = qr;
            console.log('\nScan the QR code below to connect WhatsApp:');
            qrcode.generate(qr, {small: true});
        }
        if(connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
            if(shouldReconnect) {
                connectToWhatsApp();
            } else {
                currentQR = null;
            }
        } else if(connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('WhatsApp connection opened successfully!');
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

            const trimmed = text.trim();
            if (trimmed.toLowerCase().startsWith('nad,')) {
                const command = trimmed.slice(4).trim();
                const sender = msg.key.remoteJid;
                const isGroup = sender.endsWith('@g.us');

                console.log(`[Command Received] from: ${sender} (Group: ${isGroup}), command: "${command}"`);

                const replyText = `[Nad Bot]\nCommand diterima: "${command || '(kosong)'}"\nStatus: Menunggu perizinan/integrasi logika.`;
                await sock.sendMessage(sender, { text: replyText }, { quoted: msg });
            }
        } catch (err) {
            console.error('Error handling incoming message:', err);
        }
    });
}

function getOrGenerateApiKey() {
    if (process.env.API_KEY && process.env.API_KEY.trim()) {
        return process.env.API_KEY.trim();
    }

    const keyFilePath = path.join('auth_info_baileys', 'api_key.txt');
    try {
        if (fs.existsSync(keyFilePath)) {
            const savedKey = fs.readFileSync(keyFilePath, 'utf8').trim();
            if (savedKey) return savedKey;
        }

        const newKey = crypto.randomBytes(16).toString('hex');
        if (!fs.existsSync('auth_info_baileys')) {
            fs.mkdirSync('auth_info_baileys', { recursive: true });
        }
        fs.writeFileSync(keyFilePath, newKey, 'utf8');
        return newKey;
    } catch {
        return crypto.randomBytes(16).toString('hex');
    }
}

const API_KEY = getOrGenerateApiKey();

function requireAuth(req, res, next) {
    const token = req.headers['x-api-key'] || req.query.api_key;
    if (!token || token !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }
    next();
}

app.get('/status', (req, res) => {
    // If API_KEY is set, only reveal QR code if auth succeeds
    if (API_KEY) {
        const token = req.headers['x-api-key'] || req.query.api_key;
        if (token !== API_KEY) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key', requiresAuth: true });
        }
    }
    res.json({ 
        connected: isConnected, 
        qr: currentQR,
        requiresAuth: Boolean(API_KEY)
    });
});

app.post('/send', requireAuth, async (req, res) => {
    try {
        const { to, message } = req.body;
        if (!to || typeof to !== 'string' || !message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Missing or invalid "to" or "message" (must be non-empty strings)' });
        }

        if (message.length > 4096) {
            return res.status(400).json({ error: 'Message exceeds maximum limit of 4096 characters' });
        }

        if (!sock || !isConnected) {
            return res.status(503).json({ error: 'WhatsApp not connected yet. Please scan the QR code first.' });
        }

        const cleanTo = to.trim().replace(/[^0-9@.a-z_]/gi, '');
        if (cleanTo.length < 5) {
            return res.status(400).json({ error: 'Invalid destination phone number or JID' });
        }

        const jid = cleanTo.includes('@') ? cleanTo : `${cleanTo}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: message });
        res.json({ status: 'sent', to: jid });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send message', details: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`\n======================================================`);
    console.log(`🔑 [API KEY AKTIF]: ${API_KEY}`);
    console.log(`Gunakan kunci ini pada Web GUI atau header 'x-api-key'`);
    console.log(`======================================================\n`);
    connectToWhatsApp();
});
