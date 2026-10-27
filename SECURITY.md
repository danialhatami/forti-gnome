# Security

Forti GNOME runs a small helper as root (through polkit), so security reports are important.

## Report a problem

Please do not open a public issue for a security problem.
Use the "Report a vulnerability" button in the [Security tab](https://github.com/danialhatami/forti-gnome/security) of this repository.
Say what you found, how to repeat it, and which version you use.

## What is protected

- Passwords and OTP secrets are stored only in the GNOME Keyring.
- Credentials go to the helper through a pipe and into a private `0600` file that is deleted after 3 seconds. They never show up in the process list.
- The helper checks every value it gets: host, port, realm, user, password, OTP and certificate digest.
- In passwordless mode, the helper connects only to the gateways you listed.

## Limits

- Anyone who can pass the polkit check can start a VPN session as root. In passwordless mode, keep the host list short.
- `openfortivpn` config files do not support passwords that start or end with a space.
