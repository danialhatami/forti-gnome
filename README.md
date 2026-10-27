<p align="center"><img src="assets/icon.png" width="96" alt="Forti GNOME icon"></p>

# Forti GNOME

Connect to a **Fortinet SSL-VPN** from the GNOME top bar with one click.
It uses [openfortivpn](https://github.com/adrienverge/openfortivpn) and is much faster than the FortiClient app.

Made by [Danial Hatami](https://github.com/danialhatami).

![Menu with two profiles](screenshots/menu.png)

## What you get

- A shield icon in the top bar. One click to connect, one click to disconnect.
- **Multiple accounts and gateways.** Save as many profiles as you like (different hosts, ports, realms, users) and switch between them from the menu. Each profile has its own password and OTP secret. Only one can be connected at a time.
- OTP support. Save your OTP secret and the code is made for you. If you save nothing, the extension asks for the code when you connect. If your account has no OTP, leave the code empty.
- Passwords and OTP secrets are kept in the GNOME Keyring. They are not shown in `ps` and not written to logs.
- Safe DNS. If the VPN sends DNS servers, they are used first and your normal DNS stays as a backup, so your system never loses DNS. If the VPN sends none, your DNS is not changed. Everything is restored when you disconnect, also after a crash.
- You can see each connection step, and you get a notification when you connect, disconnect, lose the connection, or fail (with the reason).

## Requirements

| You need | Notes |
|----------|-------|
| Ubuntu 24.04 (or another distro with GNOME 45 to 50) | Tested on Ubuntu 24.04 with GNOME 46. |
| A Fortinet SSL-VPN account | Gateway host, port (often 443 or 10443), username, password. Realm only if your company uses one. |
| `sudo` rights on your computer | The helper needs root to create the VPN network interface and set DNS. |

You do **not** need FortiClient. With Mode 1 below you also do not install `openfortivpn` by hand: the package installs it for you. With Mode 2 you install it yourself with one `apt` command.

Not supported: gateways that only use push approval (for example FortiToken Mobile push) and SAML/SSO logins. The extension works with password and password + 6-digit code.

## Install

The extension itself is only the top-bar part. To connect, your computer also needs `openfortivpn` and a small root helper that starts it and sets DNS (this part must be installed as root, so it can not be inside the extension). You have two ways to get everything:

### Mode 1: the `.deb` package (easiest)

One package installs the extension, the helper, and all needed programs (`openfortivpn`, `ppp`, `pkexec`, ...).
Download it from the [releases page](https://github.com/danialhatami/forti-gnome/releases/latest) and run:

```bash
sudo apt install ./forti-gnome_*.deb
```

You can also build it yourself: `git clone https://github.com/danialhatami/forti-gnome`, then `cd forti-gnome && bash build.sh --install`.

### Mode 2: manual install

Use this if you want to see and control every step, or you do not use a `.deb` based system.

1. Install the programs:

   ```bash
   sudo apt install openfortivpn ppp pkexec gir1.2-secret-1 libglib2.0-bin python3
   ```

2. Install the helper (three files, all owned by root):

   ```bash
   git clone https://github.com/danialhatami/forti-gnome
   cd forti-gnome
   sudo install -D -m 755 src/forti-gnome-helper /usr/libexec/forti-gnome-helper
   sudo install -D -m 644 src/org.forti-gnome.policy /usr/share/polkit-1/actions/org.forti-gnome.policy
   sudo install -m 755 src/forti-gnome-setup /usr/bin/forti-gnome-setup
   ```

3. Install the extension, in one of two ways:
   - from [extensions.gnome.org](https://extensions.gnome.org) (search "Forti VPN"), or
   - from the cloned folder: `bash build.sh --zip && gnome-extensions install --force forti-gnome@danialhatami.github.io.shell-extension.zip`

To remove the manual install: delete the three files above and run `gnome-extensions uninstall forti-gnome@danialhatami.github.io`.

### Enable it

Log out and log in once (Wayland needs this for a new extension), then run:

```bash
gnome-extensions enable forti-gnome@danialhatami.github.io
```

You can also switch it on in the Extensions app. To upgrade the `.deb`, install the new one. To remove it, run `sudo apt remove forti-gnome`.

## First connection, step by step

1. Click the shield icon in the top bar, then the gear button.
2. Press **Add profile** and fill in:
   - **Name**: anything you like, for example "Office".
   - **Host**: the gateway name, for example `vpn.example.com`.
   - **Port**: usually `443` (some gateways use `10443`).
   - **Realm**: leave empty unless your company told you to use one.
   - **Username**.
3. Type your **Password** and press the tick button. It is saved in the GNOME Keyring.
4. Optional: paste your **OTP secret** and press the tick button.
   This is the base32 key (letters and digits like `JBSWY3DPEHPK3PXP`) that you can see when you set up an authenticator app. If your company shows only a QR code, many authenticator apps and QR readers can also show the text key.
5. Close the settings and click the big power button.
6. The system asks for your computer password. This is the admin check for starting the VPN. It is remembered for a few minutes.
7. If you did not save an OTP secret, a small window asks for the code now. Type the current code and press **Connect**.

When the button turns green you are connected. Click it again to disconnect.

To add another account, press **Add profile** again. With more than one profile, pick one from the list in the menu first.

![Settings](screenshots/settings.png)

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

- The icon does not appear after install: log out and in, then run the `gnome-extensions enable` command again.
- "The helper is not installed": install the `.deb` package (see Install).
- Wrong OTP: check your clock with `timedatectl`. TOTP needs the correct time.
- "Another openfortivpn is already running": stop it first (`sudo pkill openfortivpn`).
- DNS looks wrong after a hard crash: `sudo forti-gnome-setup restore-dns`
- Logs: `journalctl -f -o cat /usr/bin/gnome-shell` and look for `[forti-gnome]`.

There is no auto-reconnect on purpose. Many failed logins in a row can lock a Fortinet account.

## Develop

```bash
bash build.sh                                                # check the sources and build the .deb
bash build.sh --zip                                          # zip for extensions.gnome.org
sudo FORTI_TEST_DESTRUCTIVE=1 python3 tests/test_helper.py   # only in a throw-away VM or container
```

More in [CONTRIBUTING.md](CONTRIBUTING.md). Found a bug or have an idea? [Open an issue](https://github.com/danialhatami/forti-gnome/issues). Security problems: see [SECURITY.md](SECURITY.md).

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Copyright 2026 Danial Hatami.
This project is not connected to Fortinet. Fortinet and FortiClient are trademarks of their owners.
