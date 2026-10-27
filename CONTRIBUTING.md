# Contributing

Thanks for helping. Bug reports, fixes and ideas are all welcome.

The goal of this project is small: connect and disconnect a Fortinet VPN, and do it safely.
If you want to add something big, please [open an issue](https://github.com/danialhatami/forti-gnome/issues) first so we can talk about it.

## Set up

```bash
sudo apt install openfortivpn ppp pkexec gir1.2-secret-1 libglib2.0-bin nodejs
bash build.sh        # checks the sources and builds the .deb
```

To try the shell part without logging out:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

## Tests

The helper tests use fake `openfortivpn`, `ip` and `resolvectl` programs, but they **change `/etc/resolv.conf`**.
Run them only in a throw-away VM or container:

```bash
sudo FORTI_TEST_DESTRUCTIVE=1 python3 tests/test_helper.py
```

A change to `src/forti-gnome-helper` should come with a test.

## Rules

- No new dependencies. The helper uses only the Python standard library.
- Never put secrets in command arguments, logs or GSettings.
- Do not add real host names, user names or company names. Use `vpn.example.com` in examples.
- New files start with `SPDX-License-Identifier: GPL-3.0-or-later`.

## Pull requests

Make one small change per pull request, run `bash build.sh` and the tests, add a line to `CHANGELOG.md`, and say how you tested it.
Your work is released under GPL-3.0-or-later.
