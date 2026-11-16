# Home Assistant kit

The **Home** tab of AgentMainy talks to any Home Assistant over its WebSocket
API and finds everything by itself: people, locks, door sensors, internet
(Speedtest + a connectivity sensor), appliances with a `running` sensor,
timers. Nothing here is required for that.

This folder adds the extras the tab can show when your Home Assistant has them:

| File | What it gives you |
|---|---|
| `swisscom/swisscom_devices.py` | Logs in to a **Swisscom Internet-Box** and lists every device with "online right now". Remembers devices it has seen, so it can report new ones. |
| `packages/agentmainy.yaml` | Example package: the router sensor, **who's home** from phones on the Wi-Fi (no app on the phone), a **new device** alert, the **Nuki** last action + door sensor over MQTT, a **V-ZUG** appliance over its local API. |

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

Then open AgentMainy → **Home**, enter your Home Assistant address and a
long-lived access token (profile → Security → Long-lived access tokens).

## Good to know

- Phones are matched by the **last 3 bytes** of their Wi-Fi address, because
  range extenders often rewrite the first 3. On iPhones set *Private Wi-Fi
  Address* to **Fixed** for your home network.
- The router password stays on your Home Assistant. AgentMainy never sees it.
- The router's certificate is self-signed, so the script does not verify it.
  It only ever talks to your own router on your LAN.
