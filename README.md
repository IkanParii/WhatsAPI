# WhatsAPI

API WhatsApp ringan berbasis Node.js (@whiskeysockets/baileys) & Express dengan Web GUI Dashboard terproteksi login dan dukungan Docker.

## Fitur
1. **Web GUI Dashboard Terproteksi**: Halaman login dengan username `admin` dan password ter-hash aman (menggunakan algoritma `scrypt`).
2. **Scan QR Code di Web**: Scan langsung dari layar browser tanpa repot membuka log konsol VPS.
3. **HTTP API**: Mengirim pesan ke kontak personal maupun grup (`POST /send`).
4. **Keamanan Ganda**:
   - Web GUI dilindungi login admin (password di-hash).
   - HTTP API dilindungi `API_KEY` (bisa diatur sendiri atau di-generate otomatis oleh server).
5. **Listener Bot**: Membaca pesan masuk di grup dan kontak pribadi, hanya merespon perintah dengan prefix `nad,`.
6. **Persistent Session**: Menggunakan Docker Volume agar sesi login WhatsApp tetap tersimpan saat container di-restart.

---

## 🔒 Konfigurasi Keamanan (.env)

Sebelum menjalankan di VPS yang terhubung ke internet:
1. Salin file konfigurasi environment:
   ```bash
   cp .env.example .env
   ```
2. Buka `.env` dan atur password admin Anda:
   ```env
   PORT=3000

   # Password login Web Dashboard (Username: admin)
   # Password akan otomatis di-hash secara aman menggunakan scrypt + salt acak
   ADMIN_PASSWORD=password_admin_rahasia_anda

   # Kunci rahasia untuk akses HTTP API luar (curl / webhook)
   # Jika dikosongkan, server akan men-generate kunci acak secara otomatis
   API_KEY=ganti_dengan_api_key_rahasia_anda
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

*(Alternatif: Anda juga tetap bisa melihat QR Code di terminal log lewat perintah `docker compose logs -f`)*

---

## Penggunaan HTTP API (Programmatik)

Untuk mengirim pesan dari sistem eksternal, gunakan endpoint `POST /send` dengan header `x-api-key`:

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: kunci_rahasia_anda_di_sini" \
  -d '{
    "to": "628123456789",
    "message": "Halo dari WhatsAPI!"
  }'
```

> **Catatan parameter `to`**:
> - Nomor personal: masukkan nomor berawalan kode negara (misal `628123456789`).
> - Grup: masukkan JID lengkap grup (misal `12036302xxxx@g.us`).

---

## Listener Bot (Prefix `nad,`)

Bot otomatis mendengarkan pesan baik di **Chat Pribadi** maupun **Grup WhatsApp**.
Jika ada pesan diawali dengan `nad,` (contoh: `nad, halo apa kabar`), bot akan membalas pesan tersebut.