#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Danial Hatami
"""Integration test for src/forti-gnome-helper using fake openfortivpn/resolvectl/ip.

DESTRUCTIVE: the helper rewrites /etc/resolv.conf and needs root. Run it only in a throw-away
container/VM:   sudo FORTI_TEST_DESTRUCTIVE=1 python3 tests/test_helper.py
"""
import glob, json, os, subprocess, sys, tempfile, time

if os.geteuid() != 0 or os.environ.get("FORTI_TEST_DESTRUCTIVE") != "1":
    sys.exit(__doc__)

HELPER = os.path.join(os.path.dirname(__file__), "..", "src", "forti-gnome-helper")
FAKES = {
    "openfortivpn": '''#!/usr/bin/python3
import sys, os, time, signal
print("CFGMODE=%o" % (os.stat(sys.argv[2]).st_mode & 0o777), flush=True)
print("CFGKEYS=" + ",".join(l.split(" =")[0] for l in open(sys.argv[2]) if " =" in l), flush=True)
print("INFO: Tunnel is up and running.", flush=True)
signal.signal(signal.SIGTERM, lambda *_: (print("INFO: Cleaning up.", flush=True), sys.exit(0)))
while True: time.sleep(0.2)
''',
    "resolvectl": '#!/bin/sh\ncase "$2" in ppp0) cat "$FAKE_PPP_DNS" 2>/dev/null;; *) echo "Link 2 ($2): 8.8.8.8";; esac\n',
    "ip": '#!/bin/sh\ncase "$*" in "route show default") echo "default via 1.1.1.1 dev eth0";; "-o -4 addr show"|*ppp0*) echo "5: ppp0    inet 10.9.8.7/32 scope global ppp0";; esac\n',
    "systemctl": "#!/bin/sh\nexit 0\n",
    "pidof": "#!/bin/sh\nexit 1\n",
}
bindir = tempfile.mkdtemp()
for name, body in FAKES.items():
    with open(os.path.join(bindir, name), "w") as f:
        f.write(body)
    os.chmod(os.path.join(bindir, name), 0o755)
PPP_DNS = os.path.join(bindir, "ppp_dns")
env = dict(os.environ, PATH=bindir + ":" + os.environ["PATH"], FAKE_PPP_DNS=PPP_DNS)
CFG = dict(host="vpn.example.com", port=443, realm="", user="u", **{"pass": "S3cret#x"}, otp="123456")


def start():
    return subprocess.Popen([sys.executable, HELPER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)


def read_until(p, needles, timeout=10):
    seen, end = [], time.time() + timeout
    while time.time() < end and not all(any(n in x for x in seen) for n in needles):
        line = p.stdout.readline()
        if not line:
            break
        seen.append(line.strip())
    assert all(any(n in x for x in seen) for n in needles), (needles, seen)
    return seen


def send(p, cfg):
    p.stdin.write(json.dumps(cfg) + "\n")
    p.stdin.flush()


def set_ppp_dns(*servers):
    if servers:
        open(PPP_DNS, "w").write("Link 5 (ppp0): " + " ".join(servers) + "\n")
    elif os.path.exists(PPP_DNS):
        os.remove(PPP_DNS)


orig = open("/etc/resolv.conf").read()
set_ppp_dns("10.0.0.53")
assert not os.path.lexists("/etc/resolv.conf.fortibak"), "leftover backup from an earlier run"

# connect: config is 0600, DNS = VPN first then system, a second instance is refused
p = start(); read_until(p, ["READY"])
p2 = start(); assert "already running" in p2.stdout.readline() and p2.wait() == 1
send(p, CFG)
lines = read_until(p, ["STATE connected", "IP 10.9.8.7", "DNS 10.0.0.53 8.8.8.8", "CFGMODE=600", "CFGKEYS=host"])
assert open("/etc/resolv.conf").read().splitlines()[:2] == ["nameserver 10.0.0.53", "nameserver 8.8.8.8"]
time.sleep(3.5)
assert not [d for d in glob.glob("/run/forti-*") if os.path.isdir(d)], "config dir must be deleted"

# disconnect restores DNS and exits 0
p.stdin.write("quit\n"); p.stdin.flush()
assert p.wait(timeout=15) == 0 and open("/etc/resolv.conf").read() == orig

# no OTP (account without 2FA) and a pinned gateway certificate end up in the config the right way
p = start(); read_until(p, ["READY"]); send(p, dict(CFG, otp="", cert="AB" * 32))
seen = read_until(p, ["CFGKEYS=", "STATE connected"])
keys = [x for x in seen if x.startswith("LOG CFGKEYS=")][0].split("=")[1].split(",")
assert "otp" not in keys and "trusted-cert" in keys and "password" in keys, keys
p.stdin.write("quit\n"); p.stdin.flush(); assert p.wait(timeout=15) == 0
p = start(); read_until(p, ["READY"]); send(p, dict(CFG, cert="nothex")); assert p.wait(timeout=5) == 1
p = start(); read_until(p, ["READY"]); send(p, dict(CFG, otp="12")); assert p.wait(timeout=5) == 1

# the shell vanishing (EOF) behaves like quit
p = start(); read_until(p, ["READY"]); send(p, CFG); read_until(p, ["STATE connected", "DNS "])
p.stdin.close()
assert p.wait(timeout=15) == 0 and open("/etc/resolv.conf").read() == orig

# glibc reads only 3 nameservers: a local fallback must survive even if the VPN pushes 3
set_ppp_dns("10.0.0.1", "10.0.0.2", "10.0.0.3")
p = start(); read_until(p, ["READY"]); send(p, CFG); read_until(p, ["DNS "])
assert open("/etc/resolv.conf").read().splitlines()[:3] == ["nameserver 10.0.0.1", "nameserver 10.0.0.2", "nameserver 8.8.8.8"]
p.stdin.write("quit\n"); p.stdin.flush(); assert p.wait(timeout=15) == 0 and open("/etc/resolv.conf").read() == orig

# the VPN pushes no DNS: system DNS must stay untouched
set_ppp_dns()
p = start(); read_until(p, ["READY"]); send(p, CFG); read_until(p, ["STATE connected", "DNS none"], timeout=20)
assert open("/etc/resolv.conf").read() == orig and not os.path.lexists("/etc/resolv.conf.fortibak")
p.stdin.write("quit\n"); p.stdin.flush(); assert p.wait(timeout=15) == 0
set_ppp_dns("10.0.0.53")

# cancelled before credentials, invalid input, allow-list
p = start(); read_until(p, ["READY"]); p.stdin.close(); assert p.wait(timeout=5) == 0
p = start(); read_until(p, ["READY"]); send(p, dict(CFG, host="a;b")); assert p.wait(timeout=5) == 1
os.makedirs("/etc/forti-gnome", exist_ok=True)
with open("/etc/forti-gnome/allowed-host", "w") as f:
    f.write("other.example.com\n")
try:
    p = start(); read_until(p, ["READY"]); send(p, CFG); assert p.wait(timeout=5) == 1
finally:
    os.remove("/etc/forti-gnome/allowed-host")

# crash leftover is repaired
with open("/etc/resolv.conf.fortibak", "w") as f:
    f.write("nameserver 9.9.9.9\n")
subprocess.run([sys.executable, HELPER, "--restore-dns"], env=env, check=True)
assert open("/etc/resolv.conf").read() == "nameserver 9.9.9.9\n"
open("/etc/resolv.conf", "w").write(orig)
print("all helper tests passed")
