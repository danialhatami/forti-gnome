#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Danial Hatami
# Builds forti-gnome_<version>_all.deb.   bash build.sh            -> just build
#                                         bash build.sh --zip      -> extension zip for extensions.gnome.org
#                                         bash build.sh --install  -> build + install/upgrade
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

UUID="forti-gnome@danialhatami.github.io"
VERSION="${VERSION:-1.3+$(date +%Y%m%d%H%M)}"   # always newer than the previous build, so upgrades just work
DEB="forti-gnome_${VERSION}_all.deb"

echo "==> Checking sources"
glib-compile-schemas --strict --dry-run extension/schemas
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' src/forti-gnome-helper
bash -n src/forti-gnome-setup debian/postinst debian/prerm debian/postrm

B="$(mktemp -d)"; trap 'rm -rf "$B"' EXIT
chmod 755 "$B"
EXT="$B/usr/share/gnome-shell/extensions/$UUID"
install -d "$EXT" "$B/DEBIAN" "$B/usr/libexec" "$B/usr/bin" "$B/usr/share/polkit-1/actions" "$B/usr/share/doc/forti-gnome"
cp -r extension/. "$EXT/"
find "$EXT" -type d -exec chmod 755 {} + ; find "$EXT" -type f -exec chmod 644 {} +
install -m 755 src/forti-gnome-helper "$B/usr/libexec/forti-gnome-helper"
install -m 755 src/forti-gnome-setup  "$B/usr/bin/forti-gnome-setup"
install -m 644 src/org.forti-gnome.policy "$B/usr/share/polkit-1/actions/org.forti-gnome.policy"
install -m 644 LICENSE "$B/usr/share/doc/forti-gnome/copyright"
install -m 755 debian/postinst debian/prerm debian/postrm "$B/DEBIAN/"
cat > "$B/DEBIAN/control" <<EOF
Package: forti-gnome
Version: $VERSION
Section: net
Priority: optional
Architecture: all
Depends: openfortivpn, ppp, pkexec | policykit-1, gir1.2-secret-1, libglib2.0-bin, python3, gnome-shell (>= 45)
Maintainer: Danial Hatami <danialhatami@users.noreply.github.com>
Homepage: https://github.com/danialhatami/forti-gnome
Description: Fortinet VPN indicator for GNOME Shell
 One-click openfortivpn connection from the top bar. Password and OTP secret
 are kept in the GNOME Keyring; a small root helper (via polkit) sets up the
 tunnel and DNS and restores them on disconnect.
EOF

if [ "${1:-}" = "--zip" ]; then   # the file you upload to extensions.gnome.org (no compiled schema, no extras)
    ZIP="$PWD/${UUID}.shell-extension.zip"
    rm -f "$ZIP"
    (cd extension && zip -q -r "$ZIP" . -x '*.compiled')
    echo "==> Built $ZIP"
    exit 0
fi

rm -f forti-gnome_*.deb
dpkg-deb --root-owner-group --build "$B" "$DEB" >/dev/null
echo "==> Built $DEB"

if [ "${1:-}" = "--install" ]; then
    sudo apt install -y "./$DEB"
fi
