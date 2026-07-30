// Pull the reserved-word list from the latest published compiler.
//
// A release, not `main`: the grammar should describe a language version that
// actually exists somewhere, not whatever is on someone's branch. `keywords.json`
// is committed so the extension builds without network, and refreshing it is a
// deliberate act with a visible diff.
import { writeFileSync } from 'node:fs';

const URL_ = 'https://github.com/rayhuang2006/Loophole/releases/latest/download/keywords.json';
const res = await fetch(URL_, { redirect: 'follow' });
if (!res.ok) {
  console.error(`could not fetch keywords.json: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const text = await res.text();
const d = JSON.parse(text);           // fail loudly here rather than in the generator
writeFileSync(new URL('keywords.json', import.meta.url), JSON.stringify(d, null, 2) + '\n');
console.log(`  keywords.json  wish ${d.languages.wish}, genie ${d.languages.genie}`);
