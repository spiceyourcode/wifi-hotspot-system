# ================================================================
# MikroTik RouterOS Master Setup Script - FINAL PRODUCTION v2.1
# ================================================================

# 1. INTERFACE & NAMES
/interface set [find name=ether1] name=WAN1
/interface set [find name=ether2] name=WAN2

# 2. BRIDGE CONSOLIDATION
# Moving all ports to the default 'bridge' to avoid siloed traffic
:if ([:len [/interface bridge find name=bridge]] = 0) do={ /interface bridge add name=bridge }
/interface bridge port
:if ([:len [find interface=ether3]] = 0) do={ add interface=ether3 bridge=bridge }
:if ([:len [find interface=ether4]] = 0) do={ add interface=ether4 bridge=bridge }
:if ([:len [find interface=wlan1]] = 0) do={ add interface=wlan1 bridge=bridge }

# 3. IP ADDRESSING
:if ([:len [/ip address find address="192.168.88.1/24"]] = 0) do={
    /ip address add address=192.168.88.1/24 interface=bridge
}

# 4. DNS SETTINGS (The 'Magic' for Popups)
/ip dns set servers=8.8.8.8,1.1.1.1 allow-remote-requests=yes
:if ([:len [/ip dns static find name=wifi.hotspot]] = 0) do={
    /ip dns static add name=wifi.hotspot address=192.168.88.1
}

# 5. DHCP SERVER
:if ([:len [/ip pool find name=hs-pool]] = 0) do={
    /ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254
}
:if ([:len [/ip dhcp-server find interface=bridge]] = 0) do={
    /ip dhcp-server add name=dhcp-hs interface=bridge address-pool=hs-pool disabled=no
}
/ip dhcp-server network
:if ([:len [find address="192.168.88.0/24"]] = 0) do={
    add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1
} else={
    set [find address="192.168.88.0/24"] dns-server=192.168.88.1
}

# 6. NAT & DNS HIJACKING
:if ([:len [/ip firewall nat find out-interface=WAN1 action=masquerade]] = 0) do={
    /ip firewall nat add chain=srcnat out-interface=WAN1 action=masquerade
}
# Force DNS to Router (Fixes 'No Internet' probe)
:if ([:len [/ip firewall nat find comment="Force internal DNS"]] = 0) do={
    /ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 comment="Force internal DNS"
    /ip firewall nat move [find comment="Force internal DNS"] destination=0
}

# 7. HOTSPOT CONFIGURATION
:if ([:len [/ip hotspot profile find name=hsprof1]] = 0) do={
    /ip hotspot profile add name=hsprof1
}
/ip hotspot profile set hsprof1 hotspot-address=192.168.88.1 dns-name=wifi.hotspot html-directory=hotspot login-by=http-pap

:if ([:len [/ip hotspot find name=hotspot1]] = 0) do={
    /ip hotspot add name=hotspot1 interface=bridge address-pool=hs-pool profile=hsprof1 disabled=no
}

# 8. USER PROFILES
:if ([:len [/ip hotspot user profile find name=trial]] = 0) do={ /ip hotspot user profile add name=trial }
/ip hotspot user profile set trial rate-limit=1M/1M shared-users=1 status-autorefresh=1m

:if ([:len [/ip hotspot user profile find name="1hr"]] = 0) do={ /ip hotspot user profile add name="1hr" }
/ip hotspot user profile set "1hr" rate-limit=2M/2M shared-users=1 status-autorefresh=1m

:if ([:len [/ip hotspot user profile find name="6hr"]] = 0) do={ /ip hotspot user profile add name="6hr" }
/ip hotspot user profile set "6hr" rate-limit=2M/2M shared-users=1 status-autorefresh=1m

:if ([:len [/ip hotspot user profile find name="24hr"]] = 0) do={ /ip hotspot user profile add name="24hr" }
/ip hotspot user profile set "24hr" rate-limit=3M/3M shared-users=1 status-autorefresh=1m

:if ([:len [/ip hotspot user profile find name="7day"]] = 0) do={ /ip hotspot user profile add name="7day" }
/ip hotspot user profile set "7day" rate-limit=4M/4M shared-users=1 status-autorefresh=1m

# 9. WIFI WIRELESS
/interface wireless set [find name=wlan1] mode=ap-bridge ssid=HotSpot-WiFi band=2ghz-b/g/n disabled=no frequency=auto

# 10. API & MANAGEMENT PORTS
/ip service set www port=8080
/ip service set api disabled=no port=8728
:if ([:len [/user find name=hotspot-api]] = 0) do={
    /user add name=hotspot-api password=admin group=full
}

# 11. BACKEND BYPASS (Walled Garden)
:if ([:len [/ip hotspot ip-binding find address=192.168.88.254]] = 0) do={
    /ip hotspot ip-binding add address=192.168.88.254 type=bypassed comment="Backend Server"
}
:if ([:len [/ip hotspot walled-garden ip find dst-address=192.168.88.254]] = 0) do={
    /ip hotspot walled-garden ip add dst-address=192.168.88.254 action=accept
}

# 12. FIREWALL CLEANUP
# Ensuring the Hotspot has full control
/ip firewall filter
:if ([:len [find chain=input in-interface=bridge]] = 0) do={
    add chain=input action=accept in-interface=bridge comment="Trust Local Bridge"
}
/ip firewall filter move [find comment="Trust Local Bridge"] destination=0
