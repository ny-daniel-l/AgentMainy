"""Log in to the Swisscom Internet-Box and print its LAN device list as JSON.

Usage: python swisscom_devices.py <password-file> [--raw]
Output: {"devices": [{"name", "mac", "ip", "active", "interface", "first_seen"}...],
         "new": [names of devices never seen before]}
"""
import http.cookiejar, json, os, ssl, sys, urllib.request

# The Internet-Box default address; set SWISSCOM_HOST if yours differs.
HOST = os.environ.get("SWISSCOM_HOST", "https://192.168.1.1")
CT = "application/x-sah-ws-4-call+json"

# shortcut: router uses a self-signed cert on the LAN, so verification is off; fine for a local box, never reuse for internet hosts
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
opener = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=ctx),
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
)


def call(path, body, headers):
    req = urllib.request.Request(HOST + path, json.dumps(body).encode(), {"Content-Type": CT, **headers})
    with opener.open(req, timeout=15) as r:
        return json.load(r)


password = open(sys.argv[1], encoding="utf-8-sig").read().strip()
login = call("/ws", {"service": "sah.Device.Information", "method": "createContext",
                     "parameters": {"applicationName": "webui", "username": "admin", "password": password}},
             {"Authorization": "X-Sah-Login"})
token = (login.get("data") or {}).get("contextID")
if not token:
    sys.exit(f"login failed: {login.get('errors') or login}")

res = call("/sysbus/Devices:get", {"parameters": {"expression": "lan and not self"}},
           {"X-Context": token, "Authorization": "X-Sah " + token})
items = res.get("status") or []
if "--raw" in sys.argv:
    print(json.dumps(items[:3], indent=1))
    sys.exit()
devices = [{
    "name": d.get("Name"),
    "mac": (d.get("PhysAddress") or d.get("Key") or "").lower(),
    "ip": d.get("IPAddress"),
    "active": bool(d.get("Active")),
    "interface": d.get("InterfaceName") or d.get("Layer2Interface"),
    "first_seen": d.get("FirstSeen"),
} for d in items]

# Remember every MAC ever seen next to the password file; report unseen ones once as "new".
known_path = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "known_devices.json")
macs = {d["mac"] for d in devices if d["mac"] and not d["mac"].startswith("_")}
try:
    known = set(json.load(open(known_path)))
    new = [d["name"] or d["mac"] for d in devices if d["mac"] in macs - known]
except FileNotFoundError:
    known, new = set(), []  # first run: everything already there counts as known
if macs - known:
    json.dump(sorted(known | macs), open(known_path, "w"))
print(json.dumps({"devices": devices, "new": new}))
