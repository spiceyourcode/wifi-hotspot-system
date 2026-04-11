# WiFi Hotspot Monetization System
## Complete Deployment & Operations Guide

---

## Table of Contents
1. [Architecture Overview](#architecture)
2. [Prerequisites](#prerequisites)
3. [MikroTik Router Setup](#mikrotik)
4. [Backend Server Setup (Ubuntu VPS)](#backend)
5. [M-Pesa Daraja API Setup](#mpesa)
6. [Development with ngrok](#dev)
7. [Production Deployment](#production)
8. [API Endpoints Reference](#api)
9. [Troubleshooting](#troubleshooting)

---

## 1. Architecture Overview <a name="architecture"></a>

```
[ User Device ]
      ↓
[ cnPilot E501S AP ]
      ↓
[ MikroTik hAP Lite ]  ←── RouterOS API ──→ [ Node.js Backend ]
      ↓                                              ↓              ↓
[ Hotspot/Captive Portal ]              [ M-Pesa Daraja ]    [ MySQL DB ]
      ↓
[ User sees login.html ]
      ↓ (selects package, enters phone)
[ POST /pay ] → STK Push → User pays → Callback → MikroTik user created
```

**Payment Flow:**
1. User connects to WiFi → gets 3-min free trial
2. Trial expires → redirected to captive portal (login.html)
3. User enters phone + selects package → clicks "Pay with M-Pesa"
4. Backend sends STK Push to user's phone
5. User enters M-Pesa PIN
6. Safaricom calls `/callback/mpesa` on your server
7. Backend validates payment → calls MikroTik API → creates user
8. User is now connected for the purchased duration

---

## 2. Prerequisites <a name="prerequisites"></a>

**Router:** MikroTik hAP Lite (or any RouterOS 6.49+/7.x device)
**Server:** Ubuntu 22.04 LTS VPS (minimum 1 vCPU, 1 GB RAM)
**Domain:** A domain or subdomain with DNS pointing to your VPS
**M-Pesa:** Safaricom Daraja API account (developer.safaricom.co.ke)

---

## 3. MikroTik Router Setup <a name="mikrotik"></a>

### Step 1: Apply the RouterOS script

```bash
# Option A: Paste in WinBox → Terminal
# Option B: Via SSH
ssh admin@192.168.88.1
# Then paste contents of scripts/mikrotik-setup.rsc
```

### Step 2: Upload custom captive portal HTML

```bash
# Using FTP (WinBox → Files, or sftp)
sftp admin@192.168.88.1
put portal/login.html /hotspot/login.html
```

Or via WinBox: Files → drag `login.html` into the `hotspot/` folder.

### Step 3: Point hotspot to your backend

In WinBox → IP → Hotspot → Server Profiles → (your profile):
- **Login Page**: keep as `login.html`

The `login.html` file's fetch calls (`/pay`, `/pay/status/*`) will hit your
backend. But MikroTik serves the HTML, so you need to configure a **walled garden**
entry to allow the backend URL without authentication:

```
/ip hotspot walled-garden
add dst-host=your-domain.com comment="Backend API — allow pre-auth"
add dst-host=*.safaricom.co.ke comment="M-Pesa"
```

### Step 4: Verify router API is reachable from backend

```bash
# From your backend server:
telnet 192.168.88.1 8728
# Should connect (then Ctrl+C)
```

---

## 4. Backend Server Setup (Ubuntu VPS) <a name="backend"></a>

```bash
# ── System packages ──────────────────────────────────────────────
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx mysql-server ufw

# ── Node.js 20.x ────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should be v20.x

# ── PM2 ─────────────────────────────────────────────────────────
sudo npm install -g pm2

# ── MySQL setup ──────────────────────────────────────────────────
sudo mysql_secure_installation
sudo mysql -u root -p < /path/to/scripts/schema.sql

# ── Clone / upload project ───────────────────────────────────────
git clone https://github.com/yourrepo/hotspot-system.git /opt/hotspot
cd /opt/hotspot
npm install --production

# ── Configure environment ────────────────────────────────────────
cp .env.example .env
nano .env
# Fill in all values (M-Pesa keys, DB password, MikroTik IP, etc.)

# ── Nginx ────────────────────────────────────────────────────────
sudo cp scripts/nginx.conf /etc/nginx/sites-available/hotspot
# Edit server_name to your actual domain:
sudo nano /etc/nginx/sites-available/hotspot
sudo ln -s /etc/nginx/sites-available/hotspot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# ── SSL (Let's Encrypt) ──────────────────────────────────────────
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com

# ── Firewall ─────────────────────────────────────────────────────
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# ── Start with PM2 ──────────────────────────────────────────────
cd /opt/hotspot
pm2 start pm2.config.js
pm2 save
pm2 startup   # follow the printed command to enable on boot

# ── Verify ───────────────────────────────────────────────────────
pm2 status
curl http://localhost:3000/health
```

---

## 5. M-Pesa Daraja API Setup <a name="mpesa"></a>

1. Register at [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Create an app → get **Consumer Key** and **Consumer Secret**
3. Note your **Lipa Na M-Pesa** Shortcode and **Passkey** (from the Go Live section)
4. Set `MPESA_ENV=sandbox` for testing, `production` for live
5. **Callback URL** must be HTTPS and publicly reachable:
   ```
   MPESA_CALLBACK_URL=https://your-domain.com/callback/mpesa
   ```

**Test credentials (Sandbox):**
- Shortcode: `174379`
- Passkey: `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`
- Test phone: `254708374149`

---

## 6. Development with ngrok <a name="dev"></a>

```bash
# Install ngrok
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok

# Add your authtoken (from ngrok.com)
ngrok config add-authtoken YOUR_TOKEN

# Expose local server
ngrok http 3000
# Note the https:// URL shown (e.g. https://abc123.ngrok.io)

# Update your .env:
MPESA_CALLBACK_URL=https://abc123.ngrok.io/callback/mpesa
BASE_URL=https://abc123.ngrok.io

# Restart the server
npm run dev
```

**Note:** ngrok URL changes each restart on free tier. Use a static ngrok domain
or a cheap VPS for persistent development.

---

## 7. Production Deployment Checklist <a name="production"></a>

- [ ] `MPESA_ENV=production` in `.env`
- [ ] Real Shortcode and Passkey from Safaricom Go Live
- [ ] `CALLBACK_URL` is HTTPS with valid SSL cert
- [ ] MikroTik API restricted to backend server IP only
- [ ] MySQL password is strong and `hotspot_user` has minimal privileges
- [ ] `ADMIN_TOKEN` set in `.env` (random 32+ char string)
- [ ] Nginx `location /callback/mpesa` allows only Safaricom IPs
- [ ] Nginx `location /admin` restricted to your IP
- [ ] UFW firewall enabled
- [ ] PM2 startup script enabled (`pm2 startup`)
- [ ] Log rotation configured (`pm2 install pm2-logrotate`)

---

## 8. API Endpoints Reference <a name="api"></a>

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/packages` | List all packages |
| POST | `/pay` | Initiate STK Push |
| GET | `/pay/status/:checkoutRequestId` | Poll payment status |
| POST | `/callback/mpesa` | M-Pesa callback (Daraja only) |

**POST /pay — Request:**
```json
{
  "phone": "0712345678",
  "package": "1hr"
}
```

**POST /pay — Response:**
```json
{
  "success": true,
  "message": "Payment prompt sent to 0712345678. Enter your M-Pesa PIN.",
  "checkoutRequestId": "ws_CO_...",
  "amount": 10,
  "package": "1 Hour"
}
```

### Admin Endpoints (Bearer token required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/provision` | Manually provision a user |
| DELETE | `/admin/user/:phone` | Remove MikroTik user |
| GET | `/admin/user/:phone/status` | Check active session |
| GET | `/admin/failures` | List provisioning failures |
| PATCH | `/admin/failures/:id/resolve` | Mark failure resolved |
| GET | `/admin/payments` | Payment history |

**Authorization header:** `Bearer YOUR_ADMIN_TOKEN`

---

## 9. Troubleshooting <a name="troubleshooting"></a>

**STK Push not arriving:**
- Check M-Pesa ENV (sandbox vs production)
- Verify Consumer Key/Secret are for the right app
- Check phone number format (must be 254XXXXXXXXX)
- Look at `logs/combined.log` for the Daraja API response

**Callback not received:**
- Ensure `CALLBACK_URL` is HTTPS and publicly reachable
- Test with: `curl -X POST https://your-domain.com/callback/mpesa -d '{}'`
- Check Nginx logs: `tail -f /var/log/nginx/hotspot-error.log`
- In sandbox, use the Daraja simulator to manually trigger a callback

**MikroTik API connection refused:**
- Verify `/ip service` has `api` enabled on port 8728
- Check firewall rule allows the backend IP
- Test: `telnet 192.168.88.1 8728` from the backend server
- Verify `MIKROTIK_USER` and `MIKROTIK_PASSWORD` in `.env`

**User paid but not connected:**
- Check `provisioning_failures` table: `SELECT * FROM provisioning_failures WHERE resolved=0;`
- Use admin endpoint to manually re-provision: `POST /admin/provision`
- Check MikroTik user list: WinBox → IP → Hotspot → Users

**Check logs:**
```bash
# Application logs
pm2 logs hotspot-api
tail -f /opt/hotspot/logs/combined.log
tail -f /opt/hotspot/logs/error.log

# Nginx
tail -f /var/log/nginx/hotspot-access.log
tail -f /var/log/nginx/hotspot-error.log

# MySQL
sudo journalctl -u mysql
```
