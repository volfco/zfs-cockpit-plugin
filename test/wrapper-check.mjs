// Static wrapper completeness check: node test/wrapper-check.mjs
// Parses the required-export names out of docs/api-contract.md ("Wrappers —
// required exports") and asserts each one is exported by src/service.ts as an
// `export function <name>` or an exported const. Dependency-free.
import { readFileSync } from 'node:fs';

const contract = readFileSync(new URL('../docs/api-contract.md', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8');

const section = contract.split(/^## Wrappers/m)[1]?.split(/^## /m)[0] ?? '';

// The two comma-separated backticked spans are the required name lists.
// Single-word spans (`wait`, `spawnStream`, …) belong to prose, not the lists.
const names = new Set();
for (const span of section.match(/`[^`]+`/g) ?? []) {
    if (!span.includes(',')) continue;
    for (const piece of span.slice(1, -1).split(',')) {
        const name = piece.replace(/\(.*\)/, '').trim();
        if (/^[a-z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
}

const missing = [...names].filter(name =>
    !new RegExp(`export (?:function ${name}\\b|const ${name}\\s*=)`).test(service));

const covered = names.size - missing.length;
console.log(`wrapper-check: ${covered}/${names.size} required wrappers exported by src/service.ts`);
if (missing.length > 0) {
    for (const name of missing) console.error(`MISSING export: ${name}`);
    process.exit(1);
}
