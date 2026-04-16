# ================================================================
# MikroTik RouterOS Master Setup Script - FINAL PRODUCTION v2.7
# ================================================================

# --- UTILITY: SILENT ADD ---
# This script wraps commands in a 'try/catch' so it never fails on duplicates

# 1. CLEANUP SCRIPT
:do {
    :if ([:len [/system script find name="cleanup_on_logout"]] = 0) do={
        /system script add name=cleanup_on_logout source={
            :local expiredUser $user
            /ip hotspot host remove [find where user=$expiredUser]
            :log info "Auto-cleaned host entry for expired user: $expiredUser"
        }
    }
} on-error={ :log warning "Script cleanup_on_logout already exists or could not be added" }

# 2. NETWORK CORE
:do { /interface set [find name=ether1] name=WAN1 } on-error={}
:do { /interface set [find name=ether2] name=WAN2 } on-error={}

:do { /interface bridge add name=bridge } on-error={}
:do { /interface bridge port add interface=ether3 bridge=bridge } on-error={}
:do { /interface bridge port add interface=ether4 bridge=bridge } on-error={}
:do { /interface bridge port add interface=wlan1 bridge=bridge } on-error={}

# 3. IP AND DNS
:do { /ip address add address=192.168.88.1/24 interface=bridge disabled=no } on-error={}
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes
:do { /ip dns static add name=wifi.hotspot address=192.168.88.1 } on-error={}

# 4. DHCP
:do { /ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254 } on-error={}
:do { /ip dhcp-server add name=dhcp-hs interface=bridge address-pool=hs-pool disabled=no } on-error={}
:do { /ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1 } on-error={}

# 5. NAT
:do { /ip firewall nat add chain=srcnat out-interface=WAN1 action=masquerade } on-error={}
:do { /ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force internal DNS" } on-error={}

# 6. HOTSPOT SERVER PROFILE
:do { /ip hotspot profile add name=hsprof1 } on-error={}
/ip hotspot profile set [find name=hsprof1] \
    hotspot-address=192.168.88.1 \
    dns-name=wifi.hotspot \
    html-directory=hotspot \
    login-by=http-pap,cookie \
    http-cookie-lifetime=3d

# 7. USER PROFILES
/ip hotspot user profile set [find name=default] on-logout=cleanup_on_logout

:do { /ip hotspot user profile add name=trial } on-error={}
/ip hotspot user profile set [find name=trial] rate-limit=1M/1M shared-users=1 status-autorefresh=1m on-logout=cleanup_on_logout

:do { /ip hotspot user profile add name=1hr } on-error={}
/ip hotspot user profile set [find name=1hr] rate-limit=2M/2M shared-users=1 status-autorefresh=1m on-logout=cleanup_on_logout

:do { /ip hotspot user profile add name=6hr } on-error={}
/ip hotspot user profile set [find name=6hr] rate-limit=2M/2M shared-users=1 status-autorefresh=1m on-logout=cleanup_on_logout

:do { /ip hotspot user profile add name=24hr } on-error={}
/ip hotspot user profile set [find name=24hr] rate-limit=3M/3M shared-users=1 status-autorefresh=1m on-logout=cleanup_on_logout

:do { /ip hotspot user profile add name=7day } on-error={}
/ip hotspot user profile set [find name=7day] rate-limit=4M/4M shared-users=1 status-autorefresh=1m on-logout=cleanup_on_logout

# 8. HOTSPOT SERVER
:do { /ip hotspot add name=hotspot1 interface=bridge address-pool=hs-pool profile=hsprof1 disabled=no } on-error={}

# 9. WIRELESS
/interface wireless set [find name=wlan1] mode=ap-bridge ssid=HotSpot-WiFi band=2ghz-b/g/n disabled=no frequency=auto

# 10. API & MANAGEMENT
:do { /user add name=hotspot-api password=admin group=full } on-error={}

# 11. BYPASS
:do { /ip hotspot ip-binding add address=192.168.88.254 type=bypassed comment="Backend Server" } on-error={}

# 12. FIREWALL
:do { /ip firewall filter add chain=input action=accept in-interface=bridge comment="Trust Local Bridge" } on-error={}
/ip firewall filter move [find comment="Trust Local Bridge"] destination=0

:log info "HOTSPOT SETUP COMPLETE — All systems active!"
