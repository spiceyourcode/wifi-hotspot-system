# ================================================================
# MikroTik RouterOS MASTER INITIALIZATION - CLOUD READY v3.4
# ================================================================

# --- 1. CLEANUP SCRIPT (The Fix for 'Dead Internet') ---
:do {
    :if ([:len [/system script find name="cleanup_on_logout"]] = 0) do={
        /system script add name=cleanup_on_logout source={
            :local expiredUser $user
            /ip hotspot host remove [find where user=$expiredUser]
            :log info "Auto-cleaned host entry for expired user: $expiredUser"
        }
    }
} on-error={}

# --- 2. INTERFACE NAMES ---
:do { /interface set [find name=ether1] name=WAN1 } on-error={}
:do { /interface set [find name=ether2] name=WAN2 } on-error={}

# --- 3. THE MASTER BRIDGE ---
:do { /interface bridge add name=bridge } on-error={}
:do { /interface bridge port add interface=ether3 bridge=bridge } on-error={}
:do { /interface bridge port add interface=ether4 bridge=bridge } on-error={}
:do { /interface bridge port add interface=wlan1 bridge=bridge } on-error={}
:do { /ip address add address=192.168.88.1/24 interface=bridge } on-error={}

# --- 4. DNS ---
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes
:do { /ip dns static add name=wifi.hotspot address=192.168.88.1 } on-error={}
:do { /ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force internal DNS" } on-error={}

# --- 5. DHCP SERVER ---
:do { /ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254 } on-error={}
:do { /ip dhcp-server add name=dhcp-hs interface=bridge address-pool=hs-pool disabled=no } on-error={}
:do { /ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1 } on-error={}

# --- 6. HOTSPOT CORE ---
:do { /ip hotspot profile add name=hsprof1 } on-error={}
/ip hotspot profile set [find name=hsprof1] \
    dns-name=wifi.hotspot \
    html-directory=hotspot \
    login-by=http-pap,cookie \
    http-cookie-lifetime=3d

:do { /ip hotspot add name=hotspot1 interface=bridge address-pool=hs-pool profile=hsprof1 disabled=no } on-error={}

# --- 7. USER PROFILES (Link to cleanup script) ---
/ip hotspot user profile set [find name=default] on-logout=cleanup_on_logout

:do { /ip hotspot user profile add name=trial } on-error={}
/ip hotspot user profile set trial rate-limit=1M/1M shared-users=1 status-autorefresh=1m on-logout=cleanup_on_logout

:do { /ip hotspot user profile add name="1hr" } on-error={}
/ip hotspot user profile set "1hr" rate-limit=2M/2M shared-users=1 status-autorefresh=1m on-logout=cleanup_on_logout

# --- 8. API & BYPASS (The Cloud Link) ---
/ip service set api disabled=no port=8728
:do { /user add name=hotspot-api password=admin group=full } on-error={}

# Whitelist the Google Cloud Server (136.113.152.126)
:do { /ip hotspot ip-binding add address=136.113.152.126 type=bypassed comment="GCP-Server" } on-error={}
:do { /ip hotspot walled-garden ip add dst-address=136.113.152.126 action=accept comment="GCP-Server" } on-error={}

# --- 9. FIREWALL SECURITY OVERRIDE ---
:do { /ip firewall filter add chain=input action=accept in-interface=bridge comment="Trust Local Bridge" } on-error={}
/ip firewall filter move [find comment="Trust Local Bridge"] destination=0

# Disable Fasttrack for session accuracy
:do { /ip firewall filter disable [find action=fasttrack-connection] } on-error={}

# --- 10. WI-FI ---
/interface wireless set [find name=wlan1] mode=ap-bridge ssid=HotSpot-WiFi disabled=no frequency=auto

/log info "==== PRODUCTION v3.4 CLOUD-READY COMPLETE ===="
