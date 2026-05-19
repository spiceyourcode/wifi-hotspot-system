# ================================================================
# MikroTik RouterOS MASTER INITIALIZATION - BARE METAL v3.5
# ================================================================

# --- 1. INTERFACE NAMES ---
/interface set [find name=ether1] name=WAN1
/interface set [find name=ether2] name=WAN2

# --- 2. INTERNET (WAN) SETUP ---
/ip dhcp-client add interface=WAN1 disabled=no
/ip dhcp-client set [find interface=WAN1] add-default-route=yes default-route-distance=1

# NAT - Internet Access
/ip firewall nat add chain=srcnat out-interface=WAN1 action=masquerade comment="Masquerade WAN"

# --- 3. THE MASTER BRIDGE ---
/interface bridge add name=bridge
/interface bridge port add interface=ether3 bridge=bridge
/interface bridge port add interface=ether4 bridge=bridge
/interface bridge port add interface=wlan1 bridge=bridge
/ip address add address=192.168.88.1/24 interface=bridge

# --- 4. DNS & POPUP MAGIC ---
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes
/ip dns static add name=wifi.hotspot address=192.168.88.1
/ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force internal DNS"

# --- 5. DHCP SERVER ---
/ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254
/ip dhcp-server add name=dhcp-hs interface=bridge address-pool=hs-pool disabled=no
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1

# --- 6. HOTSPOT CORE ---
/ip hotspot profile add name=hsprof1
/ip hotspot profile set [find name=hsprof1] dns-name=wifi.hotspot html-directory=hotspot login-by=http-pap,http-chap,cookie,https refresh-timeout=1m
/ip hotspot add name=hotspot1 interface=bridge address-pool=hs-pool profile=hsprof1 disabled=no
/ip hotspot profile set hsprof1 html-directory=hotspot dns-name=wifi.hotspot

# --- 7. USER PROFILES ---
/ip hotspot user profile add name=trial
/ip hotspot user profile set trial rate-limit=1M/1M shared-users=1 status-autorefresh=1m
/ip hotspot user profile add name="1hr"
/ip hotspot user profile set "1hr" rate-limit=2M/2M shared-users=1 status-autorefresh=1m
/ip hotspot user profile add name="6hr"
/ip hotspot user profile set "6hr" rate-limit=2M/2M shared-users=1 status-autorefresh=1m
/ip hotspot user profile add name="24hr"
/ip hotspot user profile set "24hr" rate-limit=3M/3M shared-users=1 status-autorefresh=1m
/ip hotspot user profile add name="7day"
/ip hotspot user profile set "7day" rate-limit=4M/4M shared-users=1 status-autorefresh=1m

# --- 8. API & BYPASS ---
/ip service set www port=8080
/ip service set api disabled=no port=8728
/user add name=hotspot-api password=admin group=full

# Local Whitelist
/ip hotspot ip-binding remove [find address=192.168.88.254]
/ip hotspot ip-binding add address=192.168.88.254 type=bypassed comment="PC-Local"
/ip hotspot walled-garden ip remove [find dst-address=192.168.88.254]
/ip hotspot walled-garden ip add dst-address=192.168.88.254 action=accept

# Cloud Whitelist (GCP)
/ip hotspot walled-garden ip remove [find dst-address=136.113.152.126]
/ip hotspot walled-garden ip add dst-address=136.113.152.126 action=accept

# --- 9. FIREWALL SECURITY OVERRIDE (CRITICAL) ---
# Explicitly ALLOW traffic to server before login
/ip firewall filter add chain=input action=accept in-interface=bridge comment="Trust Local Bridge"
/ip firewall filter add chain=forward action=accept dst-address=192.168.88.254 comment="Allow Local Server Access"
/ip firewall filter add chain=forward action=accept dst-address=136.113.152.126 comment="Allow Cloud Server Access"
/ip firewall filter move [find comment="Trust Local Bridge"] destination=0
/ip firewall filter move [find comment="Allow Local Server Access"] destination=1
/ip firewall filter move [find comment="Allow Cloud Server Access"] destination=2

# Disable Fasttrack for accuracy
/ip firewall filter disable [find action=fasttrack-connection]

# --- 10. WI-FI ---
/interface wireless set [find name=wlan1] mode=ap-bridge ssid=HotSpot-WiFi disabled=no

/log info "==== INITIALIZATION v3.5 COMPLETE ===="
