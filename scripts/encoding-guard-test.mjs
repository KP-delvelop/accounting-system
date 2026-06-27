import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['src', 'shared', 'scripts', 'data'];
const mojibakePattern = /\u00e0[\u00b8\u00ba]|\u00c2|\ufffd/;
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.ts', '.tsx']);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

const offenders = [];
for (const scanRoot of scanRoots) {
  const base = path.join(root, scanRoot);
  if (!fs.existsSync(base)) continue;
  for (const filePath of walk(base)) {
    if (!textExtensions.has(path.extname(filePath))) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!mojibakePattern.test(text)) continue;
    const lineNumber = text.slice(0, text.search(mojibakePattern)).split(/\r?\n/).length;
    offenders.push(`${path.relative(root, filePath)}:${lineNumber}`);
  }
}

if (offenders.length) {
  throw new Error(`Mojibake guard failed:\n${offenders.join('\n')}`);
}

console.log('Encoding guard test passed.');
