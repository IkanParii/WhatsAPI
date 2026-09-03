# WhatsAPI

WhatsApp API Gateway super ringan berbasis Node.js (@whiskeysockets/baileys) & Express dengan Web GUI Dashboard terproteksi login, Webhook Forwarder, dan dukungan Docker.

Dirancang sebagai alternatif mandiri yang jauh lebih ringan daripada OpenWA/WPPConnect untuk VPS dengan spesifikasi kecil (RAM 512MB – 1GB) karena **berjalan tanpa Google Chromium/Puppeteer** (hanya ~40MB RAM).

---

## ✨ Fitur Utama
1. **Webhook Forwarder (Penerus Pesan)**:
   - Setiap pesan masuk (personal maupun grup) otomatis diteruskan ke Webhook URL eksternal (n8n, Laravel, NextJS, Python, dsb).
   - Format JSON terstandarisasi dan bersih.
   - Non-blocking (asinkron) dengan batas waktu timeout 5 detik.
   - URL Webhook bisa diatur lewat `.env` atau langsung diubah via Web Dashboard.
2. **Web GUI Dashboard Terproteksi**:
   - Halaman login aman dengan username `admin` dan password ter-hash (`scrypt`).
   - Scan QR Code langsung di layar web tanpa perlu melihat terminal log VPS.
   - Live Activity Log: Melihat 25 pesan masuk dan status respon webhook secara langsung.
   - Form kirim pesan cepat langsung dari browser.
3. **HTTP API**:
   - Kirim pesan teks ke nomor kontak atau grup (`POST /send`).
   - Ambil/ubah URL Webhook via API (`GET /webhook`, `POST /webhook`).
   - Dilindungi autentikasi `API_KEY` (header `x-api-key`).
4. **Listener Bot (Prefix `nad,`)**:
   - Otomatis menandai pesan yang diawali `nad,` sebagai command (`isCommand: true`) dan membalas otomatis.
5. **Persistent Session**:
   - Sesi WhatsApp, Webhook URL, dan kredensial tersimpan di Docker Volume (`auth_info_baileys/`).

---

## 🔒 Konfigurasi Keamanan (.env)

Sebelum menjalankan di VPS yang terhubung ke internet:
1. Salin file konfigurasi environment:
   ```bash
   cp .env.example .env
   ```
2. Buka `.env` dan atur konfigurasi Anda:
   ```env
   PORT=3000

   # Password login Web Dashboard (Username: admin)
   # Password akan otomatis di-hash secara aman menggunakan scrypt
   ADMIN_PASSWORD=password_admin_rahasia_anda

   # Kunci rahasia untuk akses HTTP API luar (curl / webhook)
   # Jika dikosongkan, server akan men-generate kunci acak secara otomatis
   API_KEY=ganti_dengan_api_key_rahasia_anda

   # Webhook URL tujuan forward pesan (Opsional)
   WEBHOOK_URL=https://webhook.site/xxx
   ```

---

## Cara Menjalankan di VPS (Docker)

### 1. Clone & Jalankan Container
```bash
git clone <url-repo>
cd WhatsAPI
docker compose up -d --build
```

### 2. Hubungkan WhatsApp via Web GUI
1. Buka browser ke `http://<IP-VPS-ANDA>:3000`.
2. Masukkan username: `admin` dan password yang Anda atur di `.env`.
3. Setelah masuk, scan QR Code yang muncul di layar web menggunakan WhatsApp di HP (Menu: **Perangkat Tertaut > Tautkan Perangkat**).
4. Selesai! Bot WhatsApp Anda sudah aktif dan siap digunakan.

---

## 📡 Format Payload Webhook

Ketika ada pesan masuk, gateway mengirimkan request `POST` ke Webhook URL Anda dengan body JSON:

```json
{
  "event": "messages.upsert",
  "from": "628123456789@s.whatsapp.net",
  "isGroup": false,
  "pushName": "John Doe",
  "message": "nad, tolong verifikasi akun",
  "isCommand": true,
  "command": "tolong verifikasi akun",
  "timestamp": 1725376500
}
```

---

## 🚀 Penggunaan HTTP API (Programmatik)

### Kirim Pesan
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: kunci_rahasia_anda" \
  -d '{
    "to": "628123456789",
    "message": "Halo dari WhatsAPI Gateway!"
  }'
```

> **Format `to`**:
> - Nomor personal: masukkan nomor berawalan kode negara (misal `628123456789`).
> - Grup: masukkan JID lengkap grup (misal `12036302xxxx@g.us`).

### Update Webhook URL via API
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-api-key: kunci_rahasia_anda" \
  -d '{
    "url": "https://backend.domain.com/webhook/wa"
  }'
```