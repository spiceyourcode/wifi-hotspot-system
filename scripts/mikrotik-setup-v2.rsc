# ================================================================
# MikroTik RouterOS Configuration Script - v6 COMPATIBLE
# Device: hAP Lite (RB941-2nD)
# RouterOS: v6.x (Optimized for legacy)
# ================================================================

# 1. INTERFACE NAMING
/interface set [find name=ether1] name=WAN1
/interface set [find name=ether2] name=WAN2

# 2. BRIDGE - combine ether3, ether4, wlan1
/interface bridge add name=bridge-lan
/interface bridge port add interface=ether3 bridge=bridge-lan
/interface bridge port add interface=ether4 bridge=bridge-lan
/interface bridge port add interface=wlan1 bridge=bridge-lan

# 3. LAN IP ADDRESS
/ip address add address=192.168.88.1/24 interface=bridge-lan

# 4. WAN DHCP CLIENTS
/ip dhcp-client add interface=WAN1 disabled=no add-default-route=yes
/ip dhcp-client add interface=WAN2 disabled=no add-default-route=no

# 5. NAT MASQUERADE
/ip firewall nat add chain=srcnat out-interface=WAN1 action=masquerade
/ip firewall nat add chain=srcnat out-interface=WAN2 action=masquerade

# 6. HOTSPOT POOL
/ip pool add name=hs-pool ranges=192.168.88.10-192.168.88.254

# 7. HOTSPOT PROFILE 
/ip hotspot profile add name=hsprof1 hotspot-address=192.168.88.1 dns-name=wifi.hotspot html-directory=hotspot login-by=http-pap

# 8. HOTSPOT SERVER
/ip hotspot add name=hotspot1 interface=bridge-lan address-pool=hs-pool profile=hsprof1 disabled=no

# 9. USER PROFILES
/ip hotspot user profile add name=trial rate-limit="512k/512k" uptime-limit=00:03:00 shared-users=1
/ip hotspot user profile add name=1hr rate-limit="2M/2M" uptime-limit=01:00:00 shared-users=1
/ip hotspot user profile add name=6hr rate-limit="2M/2M" uptime-limit=06:00:00 shared-users=1
/ip hotspot user profile add name=24hr rate-limit="3M/3M" uptime-limit=24:00:00 shared-users=1
/ip hotspot user profile add name=7day rate-limit="4M/4M" uptime-limit=168:00:00 shared-users=1

# 10. WIRELESS
/interface wireless set wlan1 mode=ap-bridge ssid="HotSpot-WiFi" band=2ghz-b/g/n disabled=no

# 11. API CONFIG
/ip service set api disabled=no port=8728
/user add name=hotspot-api password="admin" group=full comment="backend"

# 12. FIREWALL (Basic v6 rules)
/ip firewall filter
add chain=input connection-state=established,related action=accept
add chain=input connection-state=invalid action=drop
add chain=input in-interface=bridge-lan action=accept
add chain=input protocol=icmp action=accept
add chain=input dst-port=8728 protocol=tcp src-address=192.168.88.254 action=accept comment="Allow API"
add chain=input dst-port=8728 protocol=tcp action=drop comment="Block API"
add chain=input in-interface=WAN1 action=drop
add chain=input in-interface=WAN2 action=drop

# 13. TRIAL RESET SCHEDULER
/system scheduler add name=reset-trial interval=1d on-event="/ip hotspot user remove [find profile=trial]"
