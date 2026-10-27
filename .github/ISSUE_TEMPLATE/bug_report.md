---
name: Bug report
about: Something does not work
labels: bug
---

**What happened?**

**What did you expect?**

**Steps to repeat**
1.

**Your system**
- Ubuntu / GNOME version:
- Forti GNOME version (`dpkg -s forti-gnome | grep Version`):
- `openfortivpn --version`:
- Wayland or X11:

**Logs** (remove host names and user names first!)
```
journalctl -o cat /usr/bin/gnome-shell | grep forti-gnome | tail -50
```
