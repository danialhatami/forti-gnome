# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/).

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
