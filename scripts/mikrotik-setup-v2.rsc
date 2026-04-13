# ================================================================
# ================================================================
# MikroTik RouterOS Configuration Script - PRODUCTION v2.1
# Device: hAP Lite (RB941-2nD)
# ================================================================

# 1. INTERFACE NAMING
/interface set [find name=ether1] name=WAN1 comment="Primary ISP"
/interface set [find name=ether2] name=WAN2 comment="Secondary ISP"

# 2. BRIDGE (ether3 + ether4 + wlan1)
:if ([:len [/interface bridge find name=bridge-lan]] = 0) do={
    /interface bridge add name=bridge-lan
}
/interface bridge port
:if ([:len [find interface=ether3]] = 0) do={ add interface=ether3 bridge=bridge-lan }
:if ([:len [find interface=ether4]] = 0) do={ add interface=ether4 bridge=bridge-lan }
:if ([:len [find interface=wlan1]]  = 0) do={ add interface=wlan1 bridge=bridge-lan }

# 3. LAN IP & WAN DHCP
:if ([:len [/ip address find address="192.168.88.1/24"]] = 0) do={
    /ip address add address=192.168.88.1/24 interface=bridge-lan
}
:if ([:len [/ip dhcp-client find interface=WAN1]] = 0) do={
    /ip dhcp-client add interface=WAN1 disabled=no add-default-route=yes
}

# 4. DNS (Critical for portal detection)
/ip dns set allow-remote-requests=yes servers=8.8.8.8,1.1.1.1

# 5. NAT
:if ([:len [/ip firewall nat find out-interface=WAN1]] = 0) do={
    /ip firewall nat add chain=srcnat out-interface=WAN1 action=masquerade
}

# 6. POOL & DHCP SERVER
:if ([:len [/ip pool find name=hs-pool]] = 0) do={
    /ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254
}
:if ([:len [/ip dhcp-server find name=dhcp-hs]] = 0) do={
    /ip dhcp-server add name=dhcp-hs interface=bridge-lan address-pool=hs-pool disabled=no
}
/ip dhcp-server network
:if ([:len [find address="192.168.88.0/24"]] = 0) do={
    add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1
}

# 7. HOTSPOT PROFILE & SERVER
:if ([:len [/ip hotspot profile find name=hsprof1]] = 0) do={
    /ip hotspot profile add name=hsprof1
}
/ip hotspot profile set hsprof1 \
    hotspot-address=192.168.88.1 \
    dns-name="wifi.hotspot" \
    html-directory=hotspot \
    login-by=cookie,http-pap \
    http-cookie-lifetime=3d

:if ([:len [/ip hotspot find name=hotspot1]] = 0) do={
    /ip hotspot add name=hotspot1 interface=bridge-lan address-pool=hs-pool profile=hsprof1 disabled=no
}

# 8. USER PROFILES (Trial + Paid)
/ip hotspot user profile
set [find name=default] shared-users=1
:if ([:len [find name=trial]] = 0) do={ add name=trial }
set [find name=trial] rate-limit=512k/512k uptime-limit=3m shared-users=1 status-autorefresh=1m
:if ([:len [find name=1hr]]   = 0) do={ add name=1hr   }
set [find name=1hr]   rate-limit=2M/2M uptime-limit=1h shared-users=1
:if ([:len [find name=6hr]]   = 0) do={ add name=6hr   }
set [find name=6hr]   rate-limit=2M/2M uptime-limit=6h shared-users=1
:if ([:len [find name=24hr]]  = 0) do={ add name=24hr  }
set [find name=24hr]  rate-limit=3M/3M uptime-limit=24h shared-users=1
:if ([:len [find name=7day]]  = 0) do={ add name=7day  }
set [find name=7day]  rate-limit=4M/4M uptime-limit=7d shared-users=1

# 9. WIRELESS (HotSpot-WiFi)
/interface wireless set wlan1 \
    mode=ap-bridge \
    ssid="HotSpot-WiFi" \
    band=2ghz-b/g/n \
    disabled=no \
    frequency=auto

# 10. API & USER
/ip service set api disabled=no port=8728
:if ([:len [/user find name=hotspot-api]] = 0) do={
    /user add name=hotspot-api password=admin group=full
}

# 11. HOTSPOT IP-BINDING (Backend Bypass)
:if ([:len [/ip hotspot ip-binding find address=192.168.88.253]] = 0) do={
    /ip hotspot ip-binding add address=192.168.88.253 type=bypassed comment="Backend Server PC"
}

# 12. WALLED GARDEN (Portal Detection)
/ip hotspot walled-garden
:if ([:len [find dst-host=connectivitycheck.gstatic.com]] = 0) do={ add dst-host=connectivitycheck.gstatic.com }
:if ([:len [find dst-host=*.apple.com]] = 0) do={ add dst-host=*.apple.com }
:if ([:len [find dst-host=*.msftconnecttest.com]] = 0) do={ add dst-host=*.msftconnecttest.com }

# 13. FIREWALL (Clean & Locked)
/ip firewall filter
remove [find chain=input !dynamic]
add chain=input action=accept connection-state=established,related comment="Allow established"
add chain=input action=drop connection-state=invalid comment="Drop invalid"
add chain=input action=accept in-interface=bridge-lan comment="Allow all LAN to router (API/Winbox)"
add chain=input action=accept protocol=icmp comment="Allow ICMP (Ping)"
add chain=input action=accept protocol=tcp src-address=192.168.88.0/24 dst-port=8728 comment="Allow API from LAN"
add chain=input action=drop protocol=tcp dst-port=8728 in-interface=WAN1 comment="Block API from WAN-1"
add chain=input action=drop in-interface=WAN1 comment="Drop all other unsolicited WAN traffic"

# 14. SCHEDULER (Daily Reset)
:if ([:len [/system scheduler find name=reset-trial]] = 0) do={
    /system scheduler add name=reset-trial interval=1d on-event="/ip hotspot user remove [find profile=trial]"
}

# ================================================================
# FINISHED. Now upload portal/login.html to router hotspot/ folder
# ================================================================
