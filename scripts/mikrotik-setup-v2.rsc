# ================================================================
# MikroTik RouterOS Configuration Script - ULTIMATE v6 COMPATIBLE
# ================================================================

# 1. INTERFACE NAMING
/interface set [find name=ether1] name=WAN1
/interface set [find name=ether2] name=WAN2

# 2. BRIDGE
/interface bridge add name=bridge-lan
/interface bridge port add interface=ether3 bridge=bridge-lan
/interface bridge port add interface=ether4 bridge=bridge-lan
/interface bridge port add interface=wlan1 bridge=bridge-lan

# 3. LAN IP
/ip address add address=192.168.88.1/24 interface=bridge-lan

# 4. WAN DHCP
/ip dhcp-client add interface=WAN1 disabled=no add-default-route=yes
/ip dhcp-client add interface=WAN2 disabled=no add-default-route=no

# 5. NAT
/ip firewall nat add chain=srcnat out-interface=WAN1 action=masquerade
/ip firewall nat add chain=srcnat out-interface=WAN2 action=masquerade

# 6. POOL
/ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254

# 6b. DHCP SERVER
/ip dhcp-server add name=dhcp-hs interface=bridge-lan address-pool=hs-pool disabled=no
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=8.8.8.8,1.1.1.1

# 7. HOTSPOT PROFILE
/ip hotspot profile add name=hsprof1
/ip hotspot profile set hsprof1 hotspot-address=192.168.88.1 dns-name=wifi.hotspot html-directory=hotspot login-by=http-pap

# 8. HOTSPOT SERVER
/ip hotspot add name=hotspot1 interface=bridge-lan address-pool=hs-pool profile=hsprof1 disabled=no

# 9. USER PROFILES (Trial + Paid)
/ip hotspot user profile add name=trial
/ip hotspot user profile set trial rate-limit=512k/512k uptime-limit=3m shared-users=1

/ip hotspot user profile add name=1hr
/ip hotspot user profile set 1hr rate-limit=2M/2M uptime-limit=1h shared-users=1

/ip hotspot user profile add name=6hr
/ip hotspot user profile set 6hr rate-limit=2M/2M uptime-limit=6h shared-users=1

/ip hotspot user profile add name=24hr
/ip hotspot user profile set 24hr rate-limit=3M/3M uptime-limit=24h shared-users=1

/ip hotspot user profile add name=7day
/ip hotspot user profile set 7day rate-limit=4M/4M uptime-limit=7d shared-users=1

# 10. WIRELESS
/interface wireless set wlan1 mode=ap-bridge ssid="HotSpot-WiFi" band=2ghz-b/g/n disabled=no

# 11. API & USER
/ip service set api disabled=no port=8728
/user add name=hotspot-api password=admin group=full

# ────────────────────────────────────────────────────────────────
# 12. HOTSPOT IP-BINDING BYPASS — CRITICAL
#     Any device that must NOT go through the captive portal
#     (the backend server PC) must be bypassed here.
#
#     WITHOUT THIS: the hotspot treats the backend server as an
#     unauthenticated WiFi client and sends tcp-reset to port 8728
#     → ECONNREFUSED even though the API service is enabled.
#
#     The backend PC is 192.168.88.253 (from DHCP).
#     To lock this permanently, set a static DHCP lease below.
# ────────────────────────────────────────────────────────────────
/ip hotspot ip-binding add address=192.168.88.253 type=bypassed comment="Backend server PC - bypass hotspot auth"

# Static DHCP lease — replace MAC with your Ethernet 2 MAC address:
#   ipconfig /all  →  Ethernet 2  →  Physical Address
# /ip dhcp-server lease add address=192.168.88.253 mac-address=XX:XX:XX:XX:XX:XX server=dhcp-hs comment="Backend server static lease"

# ────────────────────────────────────────────────────────────────
# 13. FIREWALL — INPUT CHAIN
#     Rules are top-to-bottom. Accept MUST come before drop.
# ────────────────────────────────────────────────────────────────
/ip firewall filter

# 1. Allow established/related (first = fastest path for existing sessions)
add chain=input action=accept connection-state=established,related comment="Allow established"

# 2. Drop invalid
add chain=input action=drop connection-state=invalid comment="Drop invalid"

# 3. Allow ALL LAN traffic to the router (covers API, DNS, DHCP, Winbox)
#    This is before any port-specific drop rules — ORDER CRITICAL
add chain=input action=accept in-interface=bridge-lan comment="Allow LAN to router"

# 4. Allow ICMP (ping) from WAN for diagnostics
add chain=input action=accept protocol=icmp comment="Allow ICMP"

# 5. Explicitly allow API from LAN (belt-and-suspenders, rule 3 already covers it)
add chain=input action=accept protocol=tcp src-address=192.168.88.0/24 dst-port=8728 comment="Allow RouterOS API from LAN"

# 6. Block API from WAN (explicit protection)
add chain=input action=drop protocol=tcp dst-port=8728 in-interface=WAN1 comment="Block API from WAN1"
add chain=input action=drop protocol=tcp dst-port=8728 in-interface=WAN2 comment="Block API from WAN2"

# 7. Drop all unsolicited WAN traffic
add chain=input action=drop in-interface=WAN1 comment="Drop unsolicited WAN1"
add chain=input action=drop in-interface=WAN2 comment="Drop unsolicited WAN2"

# ────────────────────────────────────────────────────────────────
# 14. DAILY TRIAL RESET
# ────────────────────────────────────────────────────────────────
/system scheduler add name=reset-trial interval=1d on-event="/ip hotspot user remove [find profile=trial]" comment="Reset trial users daily"

# ════════════════════════════════════════════════════════════════
# VERIFY (run in WinBox Terminal after applying):
#   /ip hotspot ip-binding print    → backend server bypass listed
#   /ip firewall filter print       → accept rules BEFORE drops
#   /ip hotspot print               → hotspot1 enabled
#   /ip hotspot user profile print  → trial,1hr,6hr,24hr,7day
#   /ip service print               → api port=8728 not disabled
# Then run: node scripts/test-mikrotik-conn.js  → should show ✅
# ════════════════════════════════════════════════════════════════
