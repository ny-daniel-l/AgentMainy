// A fingerprint of the server code on disk. A running server keeps the one it started with, so the
// command line and the window can tell when UltraClaude was updated and the server is out of date.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function codeVersion() {
  const hash = crypto.createHash('sha1');
  for (const dir of ['src', 'bin']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.js')).sort()) {
      hash.update(`${dir}/${name}\0`);
      hash.update(fs.readFileSync(path.join(ROOT, dir, name)));
    }
  }
  return hash.digest('hex').slice(0, 12);
}
