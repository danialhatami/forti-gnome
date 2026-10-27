# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.5] - 2026-10-27

### Fixed
- The indicator now releases all its widgets and signals when the extension is disabled.

## [1.4] - 2026-10-27

- New shield icon (symbolic, follows the panel color) and a longer setup guide.
- Two install modes in the README: `.deb` package or manual.
- Cleaner shutdown: widgets and signals are released in `disable()`, the keyring schema is created on first use.

## [1.3] - 2026-10-25

First public release.

- Connect and disconnect a Fortinet SSL-VPN from the GNOME top bar.
- Multiple profiles, live connection steps, desktop notifications.
- Passwords and OTP secrets in the GNOME Keyring; OTP made for you, asked on connect, or skipped.
- Safe DNS: VPN DNS first, system DNS as backup, untouched if the VPN pushes none; always restored.
- Optional gateway certificate pin for self-signed gateways.
- Optional passwordless mode, limited to gateways you list.
- Dark menu that also works with a light GNOME theme.
- `.deb` package built with `bash build.sh`.
