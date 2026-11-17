# Home Assistant kit

The Home pages of AgentMainy (Radar, House, Clock, Network, Server) talk to any Home Assistant over its WebSocket
API and finds everything by itself: people, locks, door sensors, internet
(Speedtest + a connectivity sensor), appliances with a `running` sensor,
timers. Nothing here is required for that.

This folder adds the extras the tab can show when your Home Assistant has them:

| File | What it gives you |
|---|---|
| `swisscom/swisscom_devices.py` | Logs in to a **Swisscom Internet-Box** and lists every device with "online right now". Remembers devices it has seen, so it can report new ones. |
| `packages/agentmainy.yaml` | Example package: the router sensor, **who's home** from phones on the Wi-Fi (no app on the phone), a **new device** alert, the **Nuki** last action + door sensor over MQTT, a **V-ZUG** appliance over its local API, and **Raspberry Pi 5 fan control** (Auto = the Pi's own curve, manual levels with a safety floor above 70 °C). |
| `flipper_bridge/` | A local add-on that makes a **Flipper Zero** plugged into the Pi reachable over TCP, for AgentMainy's Flipper page. |

## Install

1. Copy `swisscom/swisscom_devices.py` to `/config/swisscom/` on your Home Assistant.
2. Put the router's admin password, and nothing else, in `/config/swisscom/password.txt` and run `chmod 600` on it.
3. Copy `packages/agentmainy.yaml` to `/config/packages/`, replace every `<PLACEHOLDER>` and delete the blocks you do not need.
4. Enable packages once in `configuration.yaml`:
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
5. Check the config and restart Home Assistant.

Then open AgentMainy → **Settings**, enter your Home Assistant address and a
long-lived access token (profile → Security → Long-lived access tokens).

## The Server page (Raspberry Pi)

The fan block in the package gives `sensor.pi_cpu_temperature`,
`sensor.pi_fan_speed`, `sensor.pi_fan` and `input_select.pi_fan_mode`. For CPU,
memory, disk and uptime, add the **System Monitor** integration and enable
these sensors, renamed to these entity ids (Settings → Entities):

| Sensor | Entity id |
|---|---|
| Processor use | `sensor.pi_cpu_load` |
| Memory usage | `sensor.pi_memory_used` |
| Disk usage (`/config`) | `sensor.pi_disk_used` |
| Last boot | `sensor.pi_last_boot` |
| Load (1 min) | `sensor.pi_load_1m` |
| Network throughput in / out (`end0`) | `sensor.pi_network_in`, `sensor.pi_network_out` |
| IPv4 address (`end0`) | `sensor.pi_ip_address` |

Fixed ids keep the page working whatever language Home Assistant uses.

## Good to know

- Phones are matched by the **last 3 bytes** of their Wi-Fi address, because
  range extenders often rewrite the first 3. On iPhones set *Private Wi-Fi
  Address* to **Fixed** for your home network.
- The router password stays on your Home Assistant. AgentMainy never sees it.
- The router's certificate is self-signed, so the script does not verify it.
  It only ever talks to your own router on your LAN.

## Flipper bridge (Flipper Zero from anywhere)

`flipper_bridge/` is a local add-on: socat connects the Flipper's USB serial
port to TCP port **8023**, so AgentMainy's Flipper page can show its screen and
press its buttons over [Tailscale](https://tailscale.com).

1. Plug the Flipper into the Pi by USB.
2. Set up the Tailscale add-on and turn **`userspace_networking` off** in its
   options. With it on, Tailscale hands connections to the Pi as `127.0.0.1`
   and the bridge refuses them.
3. Copy the `flipper_bridge` folder to `/addons/` on the Pi (Samba or SSH add-on).
4. Settings → Add-ons → Add-on store → ⋮ → **Check for updates** → "Local add-ons" →
   **Flipper bridge** → Install → Start.
5. In AgentMainy, set the Flipper address to `<Pi's Tailscale address>:8023`.

| Option | Default | |
|---|---|---|
| `device` | empty: finds `/dev/serial/by-id/*Flipper*` | the Flipper's serial port |
| `port` | `8023` | TCP port |
| `allow` | `100.64.0.0/10` | who may connect: only Tailscale devices |

The bridge gives **full control of the Flipper** (radios, files). One client at
a time. Never forward port 8023 on the router. On the home Wi-Fi, use the Pi's
Tailscale address as well.

