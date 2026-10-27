// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Danial Hatami
// Thin wrapper over libsecret (GNOME Keyring), one entry per profile + field.
import Secret from 'gi://Secret';

let schema = null;
// Created on first use (not at import time), so nothing is built before enable().
const SCHEMA = () => schema ??= new Secret.Schema(
    'org.forti-gnome.Secret',
    Secret.SchemaFlags.NONE,
    {profile: Secret.SchemaAttributeType.STRING, field: Secret.SchemaAttributeType.STRING});

export const store = (profile, field, value, label) =>
    Secret.password_store_sync(SCHEMA(), {profile, field}, Secret.COLLECTION_DEFAULT,
        `Forti VPN: ${label} (${field})`, value, null);

export const has = (profile, field) => Secret.password_lookup_sync(SCHEMA(), {profile, field}, null) !== null;

export const clear = (profile, field) => Secret.password_clear_sync(SCHEMA(), {profile, field}, null);

// Async so the shell never blocks if the keyring needs unlocking.
export const lookup = (profile, field) => new Promise((resolve, reject) => {
    Secret.password_lookup(SCHEMA(), {profile, field}, null, (_s, res) => {
        try {
            resolve(Secret.password_lookup_finish(res));
        } catch (e) {
            reject(e);
        }
    });
});
