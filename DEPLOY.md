# 🚀 Simple Deployment Guide: Google Cloud (GCP) Free Tier

Follow these steps to move your WiFi Hotspot system to a permanent home in the cloud.

## 1. Google Cloud Console Setup
*   **Sign up:** Create an account at [console.cloud.google.com](https://console.cloud.google.com).
*   **Create Project:** Name it `wifi-hotspot`.
*   **Billing:** You must link a card, but you will stay in the **$0 Free Tier** if you follow these settings:
    *   **Region:** Must be `us-central1` (Iowa), `us-west1` (Oregon), or `us-east1` (South Carolina).
    *   **Machine Type:** `e2-micro`.
    *   **Disk:** 30GB Standard Persistent Disk.

## 2. Prepare the Instance (Ubuntu)
Once your VPS is running, click **SSH** and run these commands to install the engine:

```bash
# Update and Install Docker
sudo apt-get update
sudo apt-get install -y docker.io docker-compose
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Upload Your Code
You can use `git clone` if your code is on GitHub, or use the **Upload File** button in the SSH window.
*   Make sure you include the `.env` file!

## 4. Launch the System
Navigate to your folder on the VPS and run:

```bash
docker-compose up -d
```

## 5. Network Tuning (CRITICAL)
1.  **GCP Firewall:** Open Port `3000` (TCP) and `443` (TCP) in the Google Cloud Console (VPC Network -> Firewall).
2.  **Static IP:** Reserve a Static External IP for your instance so it never changes.
3.  **MikroTik Walled Garden:** Add your new GCP Public IP to the router's Walled Garden:
    ```routeros
    /ip hotspot walled-garden ip add dst-address=[YOUR_VPS_IP] action=accept
    ```

## 6. M-Pesa Configuration
Update your `.env` on the VPS:
*   `BASE_URL`: Set this to `http://YOUR_VPS_IP:3000` (or your domain).
*   `MPESA_CALLBACK_URL`: Update this on the Safaricom Daraja Portal too!

---
**Your server is now live 24/7!** 📡🌎
