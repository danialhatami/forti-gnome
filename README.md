# Forti GNOME

A small GNOME Shell extension that connects you to a Fortinet SSL-VPN from the top bar.
It uses [openfortivpn](https://github.com/adrienverge/openfortivpn) and is much faster than the FortiClient app.

Made by [Danial Hatami](https://github.com/danialhatami).

![Menu with two profiles](screenshots/menu.png)

## What you get

- A power button in the top bar: one click to connect, one click to disconnect.
- **Multiple accounts and gateways.** Save as many profiles as you like (different hosts, ports, realms, users) and switch between them from the menu. Each profile has its own password and OTP secret. Only one can be connected at a time.
- OTP support. Save your OTP secret and the code is made for you. If you save nothing, the extension asks for the code when you connect. If your account has no OTP, leave the code empty.
- Passwords and OTP secrets are kept in the GNOME Keyring. They are not shown in `ps` and not written to logs.
- Safe DNS. If the VPN sends DNS servers, they are used first and your normal DNS stays as a backup, so your system never loses DNS. If the VPN sends none, your DNS is not changed. Everything is restored when you disconnect, also after a crash.
- You can see each connection step, and you get a notification when you connect, disconnect, lose the connection, or fail (with the reason).

It is tested on Ubuntu 24.04 with GNOME 46. The metadata says GNOME 45 to 50.

## Install

The extension needs a small root helper (it starts `openfortivpn` and sets DNS), so the easiest way is the `.deb` package.
It contains the extension and the helper. Download it from the [releases page](https://github.com/danialhatami/forti-gnome/releases), or build it yourself:

```bash
git clone https://github.com/danialhatami/forti-gnome
cd forti-gnome
bash build.sh --install
```

Or install a ready package:

```bash
sudo apt install ./forti-gnome_*.deb
```

The package pulls in `openfortivpn` and everything else it needs.
Log out and log in once (Wayland needs this for a new extension), then run:

```bash
gnome-extensions enable forti-gnome@danialhatami.github.io
```

To upgrade, install the new `.deb`. To remove it, run `sudo apt remove forti-gnome`.

## Use

1. Click the icon in the top bar, then the gear.
2. Press **Add profile** and fill in the host, port and username.
3. Type your password and press the tick button. It goes to the Keyring.
4. Optional: save your OTP secret (the base32 key you got when you set up your authenticator).
5. Click the big power button.

To add another account, press **Add profile** again. With more than one profile, pick one from the list in the menu first.

![Settings](screenshots/settings.png)

**No OTP secret saved?** The extension asks for the code after the admin password prompt, so the code is fresh when it is sent.

**Self-signed certificate?** The first connection fails and the error shows a SHA-256 value. If you trust the gateway, paste that value into the profile field "Gateway certificate SHA-256".

### Skip the admin password (optional)

Normally polkit asks for your password and remembers it for about 5 minutes.
You can turn this off for gateways you choose:

```bash
sudo forti-gnome-setup passwordless vpn.example.com
sudo forti-gnome-setup ask        # back to the default
forti-gnome-setup status
```

In this mode the helper refuses all other hosts, so other programs running as you cannot point it at a gateway you did not choose.

## How it works

The extension runs as your user. When you connect, it starts a small helper as root through `pkexec`.
The helper starts `openfortivpn`, handles DNS, and cleans up when you disconnect.

1. The helper prints `READY`. Only then does the extension create the OTP and send the credentials. A slow password prompt can not make a code expire.
2. The helper writes a private config file (mode `0600`) in `/run`, starts `openfortivpn`, and deletes the file after 3 seconds.
3. When you disconnect, or the shell closes, the helper stops `openfortivpn` and puts DNS back.

## Troubleshooting

- Nothing happens after install: log out and in, then run the `gnome-extensions enable` command again.
- Wrong OTP: check your clock with `timedatectl`. TOTP needs the correct time.
- "Another openfortivpn is already running": stop it first (`sudo pkill openfortivpn`).
- DNS looks wrong after a hard crash: `sudo forti-gnome-setup restore-dns`
- Logs: `journalctl -f -o cat /usr/bin/gnome-shell` and look for `[forti-gnome]`.

There is no auto-reconnect on purpose. Many failed logins in a row can lock a Fortinet account.

## Develop

```bash
bash build.sh                                                # check the sources and build the .deb
sudo FORTI_TEST_DESTRUCTIVE=1 python3 tests/test_helper.py   # only in a throw-away VM or container
```

More in [CONTRIBUTING.md](CONTRIBUTING.md). Found a bug or have an idea? [Open an issue](https://github.com/danialhatami/forti-gnome/issues). Security problems: see [SECURITY.md](SECURITY.md).

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Copyright 2026 Danial Hatami.
This project is not connected to Fortinet. Fortinet and FortiClient are trademarks of their owners.
