const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

const files = ['index.html', 'manifest.webmanifest', 'service-worker.js', 'offline.html', 'favicon.ico'];
const dirs = ['css', 'js', 'icons'];

for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(www, f));
}
for (const d of dirs) {
  const src = path.join(root, d);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(www, d), { recursive: true });
}

console.log('www/ built:', fs.readdirSync(www).join(', '));
