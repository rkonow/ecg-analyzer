// Node-based runner for the same tests.js suite dev.html runs in-browser.
// Kept separate from the browser harness so results can be captured as
// plain text output for verification logs.
import { runAllTests } from './tests.js';

const { results, passCount, failCount, total } = runAllTests();

for (const r of results) {
  console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name}${r.message ? ` — ${r.message}` : ''}`);
}
console.log(`\n${passCount}/${total} tests passed${failCount ? `, ${failCount} FAILED` : ''}`);

process.exit(failCount ? 1 : 0);
