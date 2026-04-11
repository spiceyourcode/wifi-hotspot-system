# ================================================================
#  MikroTik RouterOS Configuration Script
#  Device: hAP Lite (or any RouterOS v6.49+ / v7.x device)
#
#  SECTIONS:
#   1. Interface naming
#   2. IP addressing
#   3. Dual-WAN PCC load balancing + failover
#   4. NAT masquerade
#   5. Hotspot setup
#   6. Hotspot user profiles (trial + paid)
#   7. DHCP server
#   8. Firewall essentials
#
#  HOW TO APPLY:
#   Option A: Paste into WinBox → Terminal
#   Option B: Upload as .rsc file → System → Scripts → Run
#   Option C: SSH: ssh admin@192.168.88.1 "import /flash/setup.rsc"
#
#  ⚠ ADJUST all interface names and IP addresses to match YOUR setup.
# ================================================================

# ────────────────────────────────────────────────────────────────
# 1. INTERFACE NAMING (rename to match your physical ports)
#    WAN1 = ether1 (primary ISP)
#    WAN2 = ether2 (secondary ISP)
#    LAN  = ether3 (local clients / AP)
# ────────────────────────────────────────────────────────────────
/interface set ether1 name=WAN1 comment="Primary ISP"
/interface set ether2 name=WAN2 comment="Secondary ISP"
/interface set ether3 name=LAN  comment="LAN / AP"

# ────────────────────────────────────────────────────────────────
# 2. IP ADDRESSING
#    Adjust gateway IPs to match your ISPs (usually assigned via DHCP).
#    For DHCP WAN, use /ip dhcp-client add interface=WAN1 disabled=no
# ────────────────────────────────────────────────────────────────
/ip address
add address=192.168.10.1/24 interface=WAN1 comment="WAN1 Static — adjust per ISP"
add address=192.168.20.1/24 interface=WAN2 comment="WAN2 Static — adjust per ISP"
add address=192.168.88.1/24 interface=LAN  comment="LAN Gateway"

# If your ISPs use DHCP, comment above and uncomment these:
# /ip dhcp-client add interface=WAN1 disabled=no add-default-route=no
# /ip dhcp-client add interface=WAN2 disabled=no add-default-route=no

# ────────────────────────────────────────────────────────────────
# 3. DUAL-WAN: PCC LOAD BALANCING + FAILOVER
#    PCC (Per-Connection Classifier) ensures each connection
#    consistently uses the same WAN for its lifetime.
# ────────────────────────────────────────────────────────────────

# ── Routing tables ───────────────────────────────────────────────
/ip route
add dst-address=0.0.0.0/0 gateway=192.168.10.254 routing-table=WAN1_table distance=1 comment="WAN1 default route"
add dst-address=0.0.0.0/0 gateway=192.168.20.254 routing-table=WAN2_table distance=1 comment="WAN2 default route"

# ── Failover: distance=1 preferred, distance=2 backup ───────────
add dst-address=0.0.0.0/0 gateway=192.168.10.254 distance=1 check-gateway=ping comment="Main default via WAN1"
add dst-address=0.0.0.0/0 gateway=192.168.20.254 distance=2 check-gateway=ping comment="Failover via WAN2"

# ── Mangle rules for PCC ─────────────────────────────────────────
/ip firewall mangle
# Mark connections from LAN: split 50/50 across both WANs
add chain=prerouting in-interface=LAN \
    src-address=192.168.88.0/24 \
    per-connection-classifier=both-addresses-and-ports:2/0 \
    action=mark-connection new-connection-mark=WAN1_conn passthrough=yes \
    comment="PCC: LAN → WAN1 (even connections)"

add chain=prerouting in-interface=LAN \
    src-address=192.168.88.0/24 \
    per-connection-classifier=both-addresses-and-ports:2/1 \
    action=mark-connection new-connection-mark=WAN2_conn passthrough=yes \
    comment="PCC: LAN → WAN2 (odd connections)"

# Mark routing based on connection mark
add chain=prerouting in-interface=LAN \
    connection-mark=WAN1_conn \
    action=mark-routing new-routing-mark=WAN1_table passthrough=no \
    comment="Route WAN1 connections through WAN1"

add chain=prerouting in-interface=LAN \
    connection-mark=WAN2_conn \
    action=mark-routing new-routing-mark=WAN2_table passthrough=no \
    comment="Route WAN2 connections through WAN2"

# Mark return traffic
add chain=output connection-mark=WAN1_conn \
    action=mark-routing new-routing-mark=WAN1_table passthrough=no

add chain=output connection-mark=WAN2_conn \
    action=mark-routing new-routing-mark=WAN2_table passthrough=no

# ────────────────────────────────────────────────────────────────
# 4. NAT MASQUERADE (both WANs)
# ────────────────────────────────────────────────────────────────
/ip firewall nat
add chain=srcnat out-interface=WAN1 action=masquerade comment="NAT → WAN1"
add chain=srcnat out-interface=WAN2 action=masquerade comment="NAT → WAN2"

# ────────────────────────────────────────────────────────────────
# 5. DHCP SERVER FOR LAN
# ────────────────────────────────────────────────────────────────
/ip pool
add name=dhcp-pool ranges=192.168.88.10-192.168.88.254

/ip dhcp-server
add name=dhcp-lan interface=LAN address-pool=dhcp-pool disabled=no lease-time=1h

/ip dhcp-server network
add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=8.8.8.8,8.8.4.4

# ────────────────────────────────────────────────────────────────
# 6. HOTSPOT SETUP
#    Creates a captive portal on the LAN interface.
#    The hotspot will intercept HTTP and redirect to the login page.
# ────────────────────────────────────────────────────────────────
/ip hotspot
add name=hotspot1 interface=LAN address-pool=hs-pool disabled=no \
    idle-timeout=10m keepalive-timeout=none \
    login-by=cookie,http-pap \
    html-directory=hotspot \
    http-proxy=0.0.0.0:64872 \
    comment="Main captive portal"

/ip pool
add name=hs-pool ranges=192.168.88.10-192.168.88.254

/ip hotspot
set hotspot1 profile=hsprof1

/ip hotspot profile
set hsprof1 \
    hotspot-address=192.168.88.1 \
    dns-name=wifi.hotspot \
    use-radius=no \
    html-directory=hotspot \
    http-cookie-lifetime=3d \
    smtp-server=0.0.0.0 \
    rate-limit=""

# ────────────────────────────────────────────────────────────────
# 7. HOTSPOT USER PROFILES
#    Rate limits use format: Rx/Tx (download/upload)
#    uptime-limit: maximum connected time
#    session-timeout: per-session limit (can differ from uptime)
# ────────────────────────────────────────────────────────────────
/ip hotspot user profile
# Trial — 3 minutes, 512kbps throttled, resets every 1 day
add name=trial \
    rate-limit="512k/512k" \
    uptime-limit=00:03:00 \
    shared-users=1 \
    keepalive-timeout=none \
    status-autorefresh=1m \
    transparent-proxy=yes \
    comment="Free trial: 3 min/day"

# 1 Hour — KES 10
add name=1hr \
    rate-limit="2M/2M" \
    uptime-limit=01:00:00 \
    shared-users=1 \
    keepalive-timeout=none \
    transparent-proxy=yes \
    comment="1 Hour @ KES 10"

# 6 Hours — KES 30
add name=6hr \
    rate-limit="2M/2M" \
    uptime-limit=06:00:00 \
    shared-users=1 \
    keepalive-timeout=none \
    transparent-proxy=yes \
    comment="6 Hours @ KES 30"

# 24 Hours — KES 50
add name=24hr \
    rate-limit="3M/3M" \
    uptime-limit=24:00:00 \
    shared-users=1 \
    keepalive-timeout=none \
    transparent-proxy=yes \
    comment="24 Hours @ KES 50"

# 7 Days — KES 200
add name=7day \
    rate-limit="4M/4M" \
    uptime-limit=168:00:00 \
    shared-users=1 \
    keepalive-timeout=none \
    transparent-proxy=yes \
    comment="7 Days @ KES 200"

# ────────────────────────────────────────────────────────────────
# 8. AUTO-RESET TRIAL USAGE DAILY (Scheduler)
#    Removes trial users that have consumed their uptime so they
#    can get a fresh trial the next day.
# ────────────────────────────────────────────────────────────────
/system scheduler
add name=reset-trial-users \
    start-time=00:00:00 \
    interval=1d \
    on-event="/ip hotspot user remove [find profile=trial]" \
    comment="Remove exhausted trial users at midnight"

# ────────────────────────────────────────────────────────────────
# 9. ENABLE ROUTEROS API (for Node.js backend)
#    Port 8728 (plain) or 8729 (SSL)
# ────────────────────────────────────────────────────────────────
/ip service
set api disabled=no port=8728

# Create a dedicated API user (do NOT use 'admin' in production)
/user add name=hotspot-api password="ApiStrongPass!" group=full \
    comment="Used by Node.js backend"

# Restrict API access to backend server IP only
/ip firewall filter
add chain=input dst-port=8728 protocol=tcp \
    src-address=127.0.0.1 \
    action=accept comment="Allow RouterOS API from backend"
add chain=input dst-port=8728 protocol=tcp \
    action=drop comment="Block RouterOS API from everyone else"

# ────────────────────────────────────────────────────────────────
# 10. BASIC FIREWALL (INPUT chain — protect the router)
# ────────────────────────────────────────────────────────────────
/ip firewall filter
add chain=input connection-state=established,related action=accept comment="Allow established"
add chain=input connection-state=invalid action=drop comment="Drop invalid"
add chain=input in-interface=LAN action=accept comment="Allow LAN → router"
add chain=input in-interface=WAN1 protocol=icmp action=accept comment="Allow ping WAN1"
add chain=input in-interface=WAN2 protocol=icmp action=accept comment="Allow ping WAN2"
add chain=input in-interface=WAN1 action=drop comment="Drop unsolicited WAN1"
add chain=input in-interface=WAN2 action=drop comment="Drop unsolicited WAN2"

# ────────────────────────────────────────────────────────────────
# DONE — Verify with:
#   /ip hotspot print
#   /ip hotspot user profile print
#   /ip route print
#   /ip firewall mangle print
# ────────────────────────────────────────────────────────────────
