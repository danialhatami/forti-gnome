// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Danial Hatami
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as Secrets from './secrets.js';

const FIELDS = ['password', 'totp'];

export default class FortiPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        let profiles = [];
        try {
            profiles = JSON.parse(s.get_string('profiles'));
        } catch (e) {
            profiles = [];
        }
        const save = () => s.set_string('profiles', JSON.stringify(profiles));
        const toast = title => window.add_toast(new Adw.Toast({title}));

        const page = new Adw.PreferencesPage({title: 'Profiles', icon_name: 'network-vpn-symbolic'});
        window.add(page);
        window.set_default_size(620, 740);

        const group = new Adw.PreferencesGroup({
            title: 'VPN profiles',
            description: 'Passwords and OTP secrets are kept in the GNOME Keyring, never in plain text. ' +
                'One profile can be connected at a time.',
        });
        const add = new Gtk.Button({label: 'Add profile', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        group.set_header_suffix(add);
        page.add(group);

        let rows = [];

        const entry = (parent, title, value, onChange) => {
            const row = new Adw.EntryRow({title, text: value ?? ''});
            row.connect('changed', () => onChange(row.text));
            parent.add_row(row);
            return row;
        };

        const secretRow = (parent, p, field, title, normalize) => {
            const row = new Adw.PasswordEntryRow({title, show_apply_button: true});
            const refresh = () => {
                row.title = `${title}: ${Secrets.has(p.id, field) ? 'saved ✓' : 'not set'}`;
            };
            row.connect('apply', () => {
                try {
                    const v = normalize(row.text);
                    if (!v)
                        return;
                    Secrets.store(p.id, field, v, p.name || p.host || p.id);
                    row.text = '';
                    toast(`${title} saved to keyring`);
                } catch (e) {
                    toast(e.message);
                }
                refresh();
            });
            refresh();
            parent.add_row(row);
        };

        const profileRow = p => {
            const row = new Adw.ExpanderRow({title: p.name || 'New profile', subtitle: p.host || 'not configured'});
            const touch = () => {
                row.title = p.name || 'New profile';
                row.subtitle = p.host || 'not configured';
                save();
            };
            entry(row, 'Name', p.name, v => { p.name = v; touch(); });
            entry(row, 'Host (e.g. vpn.example.com)', p.host, v => { p.host = v.trim(); touch(); });
            const port = new Adw.SpinRow({
                title: 'Port',
                adjustment: new Gtk.Adjustment({lower: 1, upper: 65535, step_increment: 1, page_increment: 100, value: p.port || 443}),
            });
            port.connect('notify::value', () => { p.port = Math.round(port.value); touch(); });
            row.add_row(port);
            entry(row, 'Realm (optional)', p.realm, v => { p.realm = v.trim(); touch(); });
            entry(row, 'Username', p.username, v => { p.username = v.trim(); touch(); });
            entry(row, 'Gateway certificate SHA-256 (optional, for self-signed gateways)', p.trusted_cert, v => {
                p.trusted_cert = v.replace(/[\s:]/g, '').toLowerCase();
                touch();
            });
            secretRow(row, p, 'password', 'Password', v => v);
            secretRow(row, p, 'totp', 'OTP secret key (optional, if empty you are asked on each connect)', v => {
                const k = v.replace(/[\s-]/g, '').toUpperCase();
                if (k && !/^[A-Z2-7]+=*$/.test(k))
                    throw new Error('That is not a valid base32 secret');
                return k;
            });

            const rm = new Adw.ActionRow({title: 'Remove this profile', subtitle: 'Also deletes its saved password and OTP secret'});
            const btn = new Gtk.Button({label: 'Remove', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
            btn.connect('clicked', () => {
                for (const f of FIELDS) {
                    try { Secrets.clear(p.id, f); } catch (e) { /* nothing stored */ }
                }
                profiles = profiles.filter(x => x.id !== p.id);
                if (s.get_string('selected') === p.id)
                    s.set_string('selected', '');
                save();
                rebuild();
            });
            rm.add_suffix(btn);
            row.add_row(rm);
            return row;
        };

        const rebuild = (expandId = null) => {
            rows.forEach(r => group.remove(r));
            rows = profiles.map(p => {
                const r = profileRow(p);
                r.expanded = p.id === expandId;
                group.add(r);
                return r;
            });
        };

        const addProfile = () => {
            const p = {id: GLib.uuid_string_random(), name: '', host: '', port: 443, realm: '', username: ''};
            profiles.push(p);
            save();
            rebuild(p.id);
        };
        add.connect('clicked', addProfile);

        rebuild();
        if (profiles.length === 0)
            addProfile();
    }
}
