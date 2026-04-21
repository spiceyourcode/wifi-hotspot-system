# ================================================================
# MikroTik RouterOS MASTER INITIALIZATION - BARE METAL v3.3
# ================================================================

# --- 1. INTERFACE NAMES ---
/interface set [find name=ether1] name=WAN1
/interface set [find name=ether2] name=WAN2

# --- 2. INTERNET (WAN) SETUP ---
/ip dhcp-client add interface=WAN1 disabled=no
/ip dhcp-client add interface=WAN2 disabled=no
/ip dhcp-client set [find interface=WAN1] add-default-route=yes default-route-distance=1
/ip dhcp-client set [find interface=WAN2] add-default-route=yes default-route-distance=2

# NAT - Internet Access
/ip firewall nat add chain=srcnat out-interface=WAN1 action=masquerade
/ip firewall nat add chain=srcnat out-interface=WAN2 action=masquerade

# --- 3. THE MASTER BRIDGE ---
/interface bridge add name=bridge
/interface bridge port add interface=ether3 bridge=bridge
/interface bridge port add interface=ether4 bridge=bridge
/interface bridge port add interface=wlan1 bridge=bridge
/ip address add address=192.168.88.1/24 interface=bridge

# --- 4. DNS ---
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes
/ip dns static add name=wifi.hotspot address=192.168.88.1
/ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force internal DNS"

# --- 5. DHCP SERVER ---
/ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254
/ip dhcp-server add name=dhcp-hs interface=bridge address-pool=hs-pool disabled=no
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1

# --- 6. HOTSPOT ---
/ip hotspot profile add name=hsprof1
/ip hotspot profile set [find name=hsprof1] dns-name=wifi.hotspot html-directory=hotspot login-by=http-pap,cookie
/ip hotspot add name=hotspot1 interface=bridge address-pool=hs-pool profile=hsprof1 disabled=no

# --- 7. USER PROFILES ---
/ip hotspot user profile add name=trial
/ip hotspot user profile set trial rate-limit=1M/1M shared-users=1
/ip hotspot user profile add name="1hr"
/ip hotspot user profile set "1hr" rate-limit=2M/2M shared-users=1

# --- 8. API & BYPASS (CLEAN & ADD) ---
/ip service set www port=8080
/ip service set api disabled=no port=8728
/user add name=hotspot-api password=admin group=full

# Re-apply Whitelists (Removes old ones first to avoid "Already Exists" failure)
/ip hotspot ip-binding remove [find address=192.168.88.254]
/ip hotspot ip-binding add address=192.168.88.254 type=bypassed comment="PC-Backend"

/ip hotspot walled-garden ip remove [find dst-address=192.168.88.254]
/ip hotspot walled-garden ip add dst-address=192.168.88.254 action=accept comment="PC-Backend"

# --- 9. FIREWALL SECURITY OVERRIDE ---
# This allows phones to talk to the PC Backend even if NOT authenticated
/ip firewall filter add chain=input action=accept in-interface=bridge comment="Trust Local Bridge"
/ip firewall filter add chain=forward action=accept dst-address=192.168.88.254 comment="Allow Backend Access"
/ip firewall filter move [find comment="Trust Local Bridge"] destination=0
/ip firewall filter move [find comment="Allow Backend Access"] destination=1

# Disable Fasttrack for session accuracy
/ip firewall filter disable [find action=fasttrack-connection]

# --- 10. WI-FI ---
/interface wireless set [find name=wlan1] mode=ap-bridge ssid=HotSpot-WiFi disabled=no

/log info "==== INITIALIZATION v3.3 COMPLETE ===="
