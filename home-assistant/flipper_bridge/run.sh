#!/usr/bin/with-contenv bashio
# Flipper Zero USB serial <-> TCP. One client at a time, only from `allow`
# (default: Tailscale addresses). The RPC gives full control of the Flipper:
# never forward this port on the router.

PORT=$(bashio::config 'port')
ALLOW=$(bashio::config 'allow')
DEVICE=$(bashio::config 'device')

find_device() {
  if bashio::var.has_value "$DEVICE"; then echo "$DEVICE"; return; fi
  for d in /dev/serial/by-id/*Flipper*; do
    if [ -e "$d" ]; then echo "$d"; return; fi
  done
  echo /dev/ttyACM0
}

bashio::log.info "Flipper bridge on tcp/${PORT}, open to ${ALLOW}"
while true; do
  # looked up per connection: the Flipper may be replugged or reboot
  DEV=$(find_device)
  if [ ! -e "$DEV" ]; then
    bashio::log.warning "No Flipper at ${DEV}. Plug it into the Pi by USB."
    sleep 10
    continue
  fi
  bashio::log.info "Waiting for a client (Flipper: ${DEV})"
  # no fork: one client at a time, and the tty is reopened per connection,
  # so a client that drops off cannot leave an RPC session behind
  socat -d "TCP-LISTEN:${PORT},reuseaddr,range=${ALLOW}" "OPEN:${DEV},rawer,echo=0" \
    || bashio::log.warning "socat stopped (exit $?)"
  sleep 1
done
