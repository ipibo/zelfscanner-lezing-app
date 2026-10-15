#!/usr/bin/env node
/**
 * Zet het pack op het device: de vier bestanden uit pack/ plus de lezing.json
 * van de lezing die je gaat geven, plus een settings.json met het lan-adres
 * van de laptop.
 *
 *   node tools/push-pack.js <pack-map> [--device <serial>] [--runner http://ip:8080]
 *
 * Voorbeeld:
 *   node tools/push-pack.js ~/Development/2026/zelfscanner-lezing/runner/packs/demo \
 *     --device 192.168.1.6:5555 --runner http://192.168.1.50:8080
 *
 * Alleen de assets blijven op de laptop: de beamer hangt aan de runner, het
 * device heeft alleen de notes nodig. Een pack op het device is daarmee een
 * paar kilobyte.
 *
 * Met opzet geen zsdeploy: dat is het fleet-gereedschap van de speurtocht (push
 * naar 8 tot 15 devices met verify). De lezing is één device aan een kabel.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

const DOEL = '/sdcard/zelfscanner-lezing/pack';
const PACK_DIR = path.resolve(__dirname, '..', 'pack');
const EIGEN_BESTANDEN = ['index.html', 'fx.js', 'lezing.js'];

const args = process.argv.slice(2);
let packMap = null;
let device = null;
let runner = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--device' || args[i] === '-s') {
    device = args[++i];
  } else if (args[i] === '--runner') {
    runner = args[++i];
  } else if (!args[i].startsWith('-')) {
    packMap = args[i];
  }
}

function adb(...rest) {
  const voor = device ? ['-s', device] : [];
  return execFileSync('adb', voor.concat(rest), {encoding: 'utf8'});
}

function lokaalIp() {
  const nets = os.networkInterfaces();
  for (const naam of Object.keys(nets)) {
    for (const net of nets[naam] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

if (!packMap) {
  console.error(
    'Geef de pack-map mee:\n  node tools/push-pack.js <pack-map> [--device <serial>] [--runner http://ip:8080]',
  );
  process.exit(1);
}
const manifestPad = path.join(path.resolve(packMap), 'lezing.json');
if (!fs.existsSync(manifestPad)) {
  console.error(`geen lezing.json in ${packMap}`);
  process.exit(1);
}

// settings.json hoort bij het apparaat, niet bij de lezing: hier wordt hij
// gemaakt, met het ip van deze laptop als het niet is meegegeven.
if (!runner) {
  const ip = lokaalIp();
  if (ip) {
    runner = `http://${ip}:8080`;
    console.log(`geen --runner meegegeven, ik gebruik ${runner}`);
  }
}
const settings = {usb: true};
if (runner) {
  settings.runner = runner;
}
const tmp = path.join(os.tmpdir(), 'zelfscanner-lezing-settings.json');
fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');

adb('shell', 'mkdir', '-p', DOEL);
for (const naam of EIGEN_BESTANDEN) {
  adb('push', path.join(PACK_DIR, naam), `${DOEL}/${naam}`);
  console.log(`  ${naam}`);
}
adb('push', manifestPad, `${DOEL}/lezing.json`);
console.log('  lezing.json');
adb('push', tmp, `${DOEL}/settings.json`);
console.log(`  settings.json (${runner || 'alleen usb'})`);

// Opnieuw starten, zodat de WebView het nieuwe pack inleest.
try {
  adb('shell', 'am', 'force-stop', 'com.zelfscannerlezing');
  adb('shell', 'am', 'start', '-n', 'com.zelfscannerlezing/.MainActivity');
  console.log('\napp herstart met het nieuwe pack');
} catch (e) {
  console.log('\npack staat erop; de app zelf niet gestart (niet geïnstalleerd?)');
}
