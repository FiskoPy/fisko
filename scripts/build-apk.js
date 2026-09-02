#!/usr/bin/env node
/**
 * Builds the release APK with the compile-time configuration baked in.
 *
 * `Env.apiBaseUrl` is a `String.fromEnvironment` whose default is the Android
 * emulator alias (10.0.2.2). A plain `flutter build apk --release` therefore
 * produces an APK that looks fine, boots fine, and cannot reach anything — on
 * a real phone every call dies at the socket and the app tells the tester to
 * check their internet. That shipped to the client once. The defines are not
 * documentation to be remembered any more; they live here.
 *
 * Usage:  node scripts/build-apk.js [--api <url>] [--client-id <id>]
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = {
  api: 'https://fisko-api-gxyk.onrender.com/api/v1',
  clientId: '686268310274-tet8th5uu2qdmav1afekd8a3csojtkgg.apps.googleusercontent.com',
};

/** Mirrors Env.isLocalApiBaseUrl in lib/core/config/env.dart. */
function isLocalApiBaseUrl(url) {
  if (!url || !url.trim()) return true;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host === '10.0.2.2') return true;
  const o = host.split('.');
  if (o.length === 4 && o.every((p) => /^\d+$/.test(p))) {
    const a = Number(o[0]);
    const b = Number(o[1]);
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function flutterBin() {
  if (process.env.FLUTTER) return process.env.FLUTTER;
  const local = path.join(
    os.homedir(),
    'flutter',
    'bin',
    process.platform === 'win32' ? 'flutter.bat' : 'flutter',
  );
  return fs.existsSync(local) ? local : 'flutter';
}

const api = arg('api', DEFAULTS.api);
const clientId = arg('client-id', DEFAULTS.clientId);
const mobile = path.join(__dirname, '..', 'apps', 'mobile');

if (isLocalApiBaseUrl(api)) {
  console.error('\nERRO: API_BASE_URL "' + api + '" nao e alcancavel de um celular real.');
  console.error('Um release apontando para localhost/LAN falha em toda chamada e o app');
  console.error('diz "revisa tu internet". Passe --api com a URL publica.\n');
  process.exit(1);
}
if (!clientId.endsWith('.apps.googleusercontent.com')) {
  console.error('\nERRO: GOOGLE_OAUTH_CLIENT_ID "' + clientId + '" nao parece valido.');
  console.error('Sem ele o login com Google fica indisponivel no build.\n');
  process.exit(1);
}

console.log('API_BASE_URL           ' + api);
console.log('GOOGLE_OAUTH_CLIENT_ID ' + clientId.slice(0, 24) + '...\n');

execFileSync(
  flutterBin(),
  [
    'build',
    'apk',
    '--release',
    '--dart-define=API_BASE_URL=' + api,
    '--dart-define=GOOGLE_OAUTH_CLIENT_ID=' + clientId,
  ],
  // Node refuses to spawn a .bat/.cmd directly on Windows (CVE-2024-27980),
  // and the Flutter SDK ships flutter.bat. None of the arguments contain
  // spaces or shell metacharacters, so going through the shell is safe here.
  { cwd: mobile, stdio: 'inherit', shell: process.platform === 'win32' },
);

// Passing the flags is not proof the value landed. Read it back out of the
// compiled artifact — that is the check that would have caught this.
const apk = path.join(mobile, 'build', 'app', 'outputs', 'flutter-apk', 'app-release.apk');
const host = new URL(api).host;
let verified = false;
try {
  const so = execFileSync('unzip', ['-p', apk, 'lib/arm64-v8a/libapp.so'], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString('latin1');
  if (!so.includes(host)) {
    console.error('\nERRO: "' + host + '" nao esta no APK compilado. O define nao pegou.');
    process.exit(1);
  }
  // Match the whole default URL, not the bare IP: Env.isLocalApiBaseUrl
  // compares against '10.0.2.2' itself, so that literal is legitimately in
  // every build and testing for it fails an APK that is perfectly fine.
  if (so.includes('http://10.0.2.2:3000/api/v1')) {
    console.error('\nERRO: o APK ainda carrega a URL do emulador — o define nao pegou.');
    process.exit(1);
  }
  verified = true;
} catch (e) {
  if (e.status === 1) process.exit(1);
  console.warn('AVISO: nao consegui inspecionar o APK (unzip ausente?). Confira a mao.');
}

const pubspec = fs.readFileSync(path.join(mobile, 'pubspec.yaml'), 'utf8');
const m = pubspec.match(/^version:\s*(.+)$/m);
const version = (m ? m[1] : '0.0.0').trim().split('+')[0];
const out = path.join(os.homedir(), 'Downloads', 'Fisko-' + version + '.apk');
fs.copyFileSync(apk, out);

console.log('\nOK  ' + out);
console.log(
  '    ' +
    (fs.statSync(out).size / 1048576).toFixed(1) +
    ' MB' +
    (verified ? '  |  aponta para ' + host + ' (conferido no binario)' : ''),
);
