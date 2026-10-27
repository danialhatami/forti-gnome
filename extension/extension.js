// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Danial Hatami
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as Secrets from './secrets.js';
import {totp} from './totp.js';

const HELPER = '/usr/libexec/forti-gnome-helper';
const S = {IDLE: 'idle', CONNECTING: 'connecting', CONNECTED: 'connected', ERROR: 'error'};
const TITLE = {idle: 'Disconnected', connecting: 'Connecting…', connected: 'Connected', error: 'Connection failed'};
const enc = s => new TextEncoder().encode(s);
const CENTER = Clutter.ActorAlign.CENTER;

const label = (text, style, props = {}) => new St.Label({text, style_class: style, ...props});

// A small "caption + value" tile for the connection details.
function tile(caption) {
    const box = new St.BoxLayout({style_class: 'forti-tile', x_expand: true});
    const value = label('-', 'forti-tile-val', {y_align: CENTER});
    value.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    box.add_child(label(caption, 'forti-tile-cap', {x_expand: true, y_align: CENTER}));
    box.add_child(value);
    return {box, value};
}

// openfortivpn output -> human readable stage (first match wins)
const STAGES = [
    [/Connected to gateway/, 'Authenticating…'],
    [/Authenticated/, 'Requesting VPN address…'],
    [/allocated a VPN|Got addresses/, 'Starting PPP…'],
    [/Interface .* is UP/, 'Interface is up…'],
    [/route/i, 'Configuring routes…'],
    [/nameserver|DNS/i, 'Configuring DNS…'],
];
const LOG_PREFIX = '[forti-gnome]';

const Indicator = GObject.registerClass(
class FortiIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Forti VPN');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._state = S.IDLE;
        this._text = TITLE.idle;
        this._proc = null;
        this._stdin = null;
        this._active = null;   // {id, name, host} of the profile being connected
        this._creds = null;
        this._busy = false;
        this._stopping = false;
        this._pulsing = false;
        this._logText = '';
        this._lastError = '';
        this._failMsg = null;
        this._cancelOtp = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${ext.path}/icons/forti-symbolic.svg`),
            style_class: 'system-status-icon forti-icon'});
        box.add_child(this._icon);
        this.add_child(box);

        this._buildMenu();
        this._settingsId = this._settings.connect('changed', () => this._render());
        this._render();
    }

    // ---- profiles ----------------------------------------------------------
    _profiles() {
        try {
            const l = JSON.parse(this._settings.get_string('profiles'));
            return Array.isArray(l) ? l : [];
        } catch (e) {
            return [];
        }
    }

    _current() {
        const list = this._profiles(), id = this._settings.get_string('selected');
        return list.find(p => p.id === id) ?? list[0] ?? null;
    }

    // ---- menu --------------------------------------------------------------
    _buildMenu() {
        this.menu.actor.add_style_class_name('forti-menu');
        const card = new St.BoxLayout({vertical: true, style_class: 'forti-card', x_expand: true});
        this.menu.box.add_child(card);

        const top = new St.BoxLayout({style_class: 'forti-top'});
        top.add_child(label('FORTI VPN', 'forti-brand', {x_expand: true, y_align: CENTER}));
        const gear = this._gear = new St.Button({style_class: 'forti-gear', can_focus: true, accessible_name: 'Settings',
            child: new St.Icon({icon_name: 'preferences-system-symbolic', icon_size: 16})});
        this._gearId = gear.connect('clicked', () => {
            this.menu.close();
            this._ext.openPreferences();
        });
        top.add_child(gear);
        card.add_child(top);

        const hero = new St.BoxLayout({vertical: true, style_class: 'forti-hero', x_expand: true});
        this._power = new St.Button({can_focus: true, x_align: CENTER, accessible_name: 'Connect or disconnect',
            child: new St.Icon({icon_name: 'system-shutdown-symbolic', style_class: 'forti-power-icon',
                x_align: CENTER, y_align: CENTER, x_expand: true, y_expand: true})});
        this._powerId = this._power.connect('clicked', () => this._onButton());
        this._status = label('', 'forti-status', {x_align: CENTER});
        this._sub = label('', 'forti-sub', {x_align: CENTER});
        this._sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._log = label('', 'forti-log', {x_align: CENTER});
        this._log.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        hero.add_child(this._power);
        hero.add_child(this._status);
        hero.add_child(this._log);
        hero.add_child(this._sub);
        card.add_child(hero);

        this._error = label('', 'forti-error-msg');
        this._error.clutter_text.line_wrap = true;
        card.add_child(this._error);

        this._detail = new St.BoxLayout({vertical: true, style_class: 'forti-tiles'});
        this._ip = tile('IP ADDRESS');
        this._dns = tile('DNS');
        this._detail.add_child(this._ip.box);
        this._detail.add_child(this._dns.box);
        card.add_child(this._detail);

        this._plistBox = new St.BoxLayout({vertical: true, style_class: 'forti-plist'});
        this._plistBox.add_child(label('PROFILES', 'forti-section'));
        this._plist = new St.BoxLayout({vertical: true, style_class: 'forti-prows'});
        this._plistBox.add_child(this._plist);
        card.add_child(this._plistBox);
    }

    _buildProfiles() {
        const list = this._profiles(), cur = this._current();
        const locked = !!this._proc || this._busy;
        this._plist.destroy_all_children();
        this._plistBox.visible = list.length > 1;
        for (const p of list) {
            const selected = p.id === cur?.id;
            const row = new St.Button({can_focus: true, x_expand: true, reactive: !locked,
                style_class: `forti-prow${selected ? ' forti-prow-selected' : ''}${locked && !selected ? ' forti-prow-dim' : ''}`});
            const box = new St.BoxLayout({x_expand: true});
            const dot = new St.Widget({y_align: CENTER,
                style_class: `forti-dot${selected && this._state === S.CONNECTED ? ' forti-dot-on' : ''}`});
            const txt = new St.BoxLayout({vertical: true, x_expand: true, y_align: CENTER});
            txt.add_child(label(p.name || p.host, 'forti-prow-name'));
            txt.add_child(label(`${p.host}:${p.port}`, 'forti-prow-host'));
            box.add_child(dot);
            box.add_child(txt);
            if (selected)
                box.add_child(new St.Icon({icon_name: 'object-select-symbolic', style_class: 'forti-check', y_align: CENTER}));
            row.set_child(box);
            row.connect('clicked', () => this._settings.set_string('selected', p.id));
            this._plist.add_child(row);
        }
    }

    // ---- state / rendering -------------------------------------------------
    _setState(state, text) {
        if (state !== this._state)
            console.log(`${LOG_PREFIX} state=${state}`);
        this._state = state;
        this._text = text ?? TITLE[state];
        this._render();
    }

    _render() {
        const st = this._state, cls = `forti-${st}`;
        const shown = this._proc ? this._active : this._current();
        this._icon.style_class = `system-status-icon forti-icon ${cls}`;
        this._power.style_class = `forti-power ${cls}${this._stopping ? ' forti-busy' : ''}`;
        this._status.style_class = `forti-status ${cls}`;
        this._status.text = !shown ? 'No profile' : this._stopping ? 'Disconnecting…' : this._text;
        this._sub.text = !shown ? 'Tap to add one' : shown.name && shown.name !== shown.host
            ? `${shown.name} · ${shown.host}` : shown.host;
        this._power.reactive = !this._stopping;
        this._detail.visible = st === S.CONNECTED;
        this._log.text = this._logText;
        this._log.visible = st === S.CONNECTING && !!this._logText;
        this._error.visible = st === S.ERROR && !!this._lastError;
        this._error.text = this._lastError;
        this._buildProfiles();

        if (st === S.CONNECTING && !this._pulsing) {
            this._pulsing = true;
            this._pulse();
        }
    }

    _pulse() {
        if (this._state !== S.CONNECTING) {
            this._pulsing = false;
            this._icon.opacity = this._power.opacity = 255;
            return;
        }
        const target = this._icon.opacity === 255 ? 110 : 255;
        for (const a of [this._power, this._icon]) {
            a.ease({opacity: target, duration: 700, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: a === this._icon ? () => this._pulse() : null});
        }
    }

    // ---- actions -----------------------------------------------------------
    _onButton() {
        if (this._proc) {
            this._disconnect();
        } else if (!this._current()) {
            this.menu.close();
            this._ext.openPreferences();
        } else {
            this._connect();
        }
    }

    async _connect() {
        const p = this._current();
        if (this._busy || this._proc || !p)
            return;
        this._busy = true;
        this._lastError = '';
        this._logText = '';
        this._ip.value.text = this._dns.value.text = '-';
        this._active = {id: p.id, name: p.name, host: p.host};
        this._setState(S.CONNECTING, 'Reading credentials…');
        try {
            if (!p.host?.trim() || !p.username?.trim())
                throw new Error('This profile needs a host and a username. Open Settings to add them.');
            const pass = await Secrets.lookup(p.id, 'password');
            if (!pass)
                throw new Error('No password is saved for this profile. Open Settings to add it.');
            const secret = await Secrets.lookup(p.id, 'totp');
            this._creds = {host: p.host.trim(), port: p.port || 443, realm: (p.realm ?? '').trim(),
                user: p.username.trim(), pass, secret, cert: (p.trusted_cert ?? '').trim()};
            this._setState(S.CONNECTING, 'Waiting for authorization…');
            this._spawn();
        } catch (e) {
            this._fail(e.message);
        } finally {
            this._busy = false;
        }
    }

    // The one-time code is made only AFTER the admin prompt is done and the helper is ready,
    // so a slow password prompt can never leave us with an expired code.
    async _sendCreds(proc) {
        const {secret, ...cfg} = this._creds;
        this._creds = null;
        try {
            let otp;
            if (secret) {
                // A code that is about to expire could be rejected while the gateway is still checking it.
                const left = 30000 - (Date.now() % 30000);
                if (left < 4000) {
                    this._setState(S.CONNECTING, 'Waiting for a fresh code…');
                    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, left + 300, () => (r(), GLib.SOURCE_REMOVE)));
                }
                if (this._proc !== proc || this._stopping)
                    return;
                otp = totp(secret);
            } else {
                otp = await this._askOtp();
            }
            if (this._proc !== proc || this._stopping)
                return;
            if (otp === null) {   // cancelled; an empty string means "this account has no OTP"
                this._disconnect();
                return;
            }
            this._stdin.write_all(enc(`${JSON.stringify({...cfg, otp})}\n`), null);
            this._setState(S.CONNECTING, 'Connecting…');
        } catch (e) {
            if (this._proc === proc) {
                this._failMsg = e.message;
                this._disconnect();
            }
        }
    }

    _askOtp() {
        this.menu.close();
        return new Promise(resolve => {
            const d = new ModalDialog.ModalDialog({styleClass: 'forti-dialog'});
            d.contentLayout.add_child(label(
                `Enter the one-time code for ${this._active.name || this._active.host}.\nLeave it empty if your account has no OTP.`,
                'forti-dialog-text'));
            const entry = new St.Entry({style_class: 'forti-otp-entry', hint_text: '123456', can_focus: true});
            d.contentLayout.add_child(entry);
            let done = false;
            const submit = () => {
                const v = entry.get_text().trim();
                if (v && !/^[0-9A-Za-z]{4,16}$/.test(v)) {   // same rule as the helper: fail here, not after a slow login
                    entry.add_style_class_name('forti-otp-bad');
                    return;
                }
                finish(v);
            };
            const finish = v => {
                if (done)
                    return;
                done = true;
                this._cancelOtp = null;
                entry.clutter_text.disconnect(activateId);
                const closedId = d.connect('closed', () => {
                    d.disconnect(closedId);
                    d.destroy();
                });
                d.close();
                resolve(v);
            };
            this._cancelOtp = () => finish(null);
            d.setButtons([
                {label: 'Cancel', action: () => finish(null), key: Clutter.KEY_Escape},
                {label: 'Connect', default: true, action: submit},
            ]);
            const activateId = entry.clutter_text.connect('activate', submit);
            d.open();
            entry.grab_key_focus();
        });
    }

    _spawn() {
        if (!GLib.file_test(HELPER, GLib.FileTest.IS_EXECUTABLE))
            throw new Error('The helper is not installed. Install the forti-gnome .deb package, or follow "Manual install" in the project README (github.com/danialhatami/forti-gnome).');
        const proc = Gio.Subprocess.new(['pkexec', HELPER],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE);
        this._proc = proc;
        this._stopping = false;
        this._stdin = proc.get_stdin_pipe();

        const reader = new Gio.DataInputStream({base_stream: proc.get_stdout_pipe(), close_base_stream: true});
        const readLine = () => reader.read_line_async(GLib.PRIORITY_DEFAULT, null, (r, res) => {
            let line;
            try {
                [line] = r.read_line_finish_utf8(res);
            } catch (e) {
                return;
            }
            if (line === null || this._proc !== proc)
                return;
            this._onLine(line, proc);
            readLine();
        });
        readLine();

        proc.wait_async(null, (p, res) => {
            try {
                p.wait_finish(res);
            } catch (e) {
                // exit status is read below
            }
            if (this._proc === p)
                this._onExit(p);
        });
    }

    _onLine(line, proc) {
        const [kind, ...rest] = line.split(' ');
        const msg = rest.join(' ');
        if (kind !== 'LOG' || /^(ERROR|WARN)/.test(msg))   // keep the journal quiet: errors and state only
            console.log(`${LOG_PREFIX} ${line}`);
        switch (kind) {
        case 'READY':
            if (this._creds)
                this._sendCreds(proc);
            break;
        case 'STATE':
            if (msg === 'connected' && this._state !== S.CONNECTED) {
                this._setState(S.CONNECTED);
                Main.notify('VPN connected', `${this._active.name || this._active.host} is up.`);
            }
            break;
        case 'IP':
            this._ip.value.text = msg || '-';
            break;
        case 'DNS':
            this._dns.value.text = msg === 'none' ? 'System default' : msg;
            break;
        case 'LOG': {
            const err = msg.match(/ERROR:\s*(.*)/);
            if (err)
                this._lastError = err[1];
            const pin = msg.match(/--trusted-cert\s+([0-9a-f]{64})/i);
            if (pin)   // openfortivpn prints the digest of a certificate it does not know
                this._lastError = `The gateway certificate is not trusted. If you trust it, paste this SHA-256 into the profile: ${pin[1]}`;
            if (this._state === S.CONNECTING) {
                this._logText = msg.replace(/^(INFO|DEBUG|WARN|ERROR):\s*/, '');
                const stage = STAGES.find(([re]) => re.test(msg));
                this._setState(S.CONNECTING, stage ? stage[1] : this._text);
            }
            break;
        }
        }
    }

    _onExit(p) {
        const wasConnected = this._state === S.CONNECTED;
        const name = this._active?.name || this._active?.host || 'VPN';
        const stopped = this._stopping, failMsg = this._failMsg;
        const code = p.get_if_exited() ? p.get_exit_status() : -1;
        this._cleanup();
        if (failMsg) {
            this._fail(failMsg);
        } else if (stopped) {
            this._setState(S.IDLE);
            if (wasConnected)
                Main.notify('VPN disconnected', `${name} was closed.`);
        } else {
            let msg = this._lastError;
            if (!msg) {
                if (code === 126 || code === 127)
                    msg = 'Administrator authorization was cancelled or failed.';
                else
                    msg = wasConnected ? 'The connection was lost.' : `The VPN helper stopped unexpectedly (code ${code}).`;
            }
            this._fail(msg, wasConnected ? `VPN connection lost: ${name}` : `Could not connect: ${name}`);
        }
    }

    _disconnect() {
        if (!this._proc || this._stopping)
            return;
        this._stopping = true;
        this._cancelOtp?.();
        this._render();
        this._sendQuit();
    }

    _sendQuit() {
        try {
            this._stdin?.write_all(enc('quit\n'), null);
            this._stdin?.close(null);
        } catch (e) {
            // helper already gone
        }
    }

    _cleanup() {
        this._cancelOtp?.();
        this._logText = '';
        this._proc = null;
        this._stdin = null;
        this._creds = null;
        this._failMsg = null;
        this._stopping = false;
        this._busy = false;
    }

    _fail(msg, title) {
        const name = this._active?.name || this._active?.host;
        this._cleanup();
        this._lastError = msg;
        this._setState(S.ERROR);
        Main.notify(title ?? `Could not connect${name ? `: ${name}` : ''}`, msg);
    }

    destroy() {
        // Disabling the extension drops the VPN cleanly (the helper restores DNS and routes).
        this._settings.disconnect(this._settingsId);
        this._power.disconnect(this._powerId);
        this._gear.disconnect(this._gearId);
        this._cancelOtp?.();
        if (this._proc)
            this._sendQuit();
        this._proc = null;
        for (const w of [this._power, this._detail, this._plist, this._plistBox])
            w.destroy();
        this._power = this._gear = this._detail = this._plist = this._plistBox = null;
        this._settings = null;
        super.destroy();
    }
});

export default class FortiVpnExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        // This extension also runs on the lock screen (session-modes: unlock-dialog): locking the screen
        // must not disable it, because disabling stops the VPN connection.
        this._indicator?.destroy();
        this._indicator = null;
    }
}
