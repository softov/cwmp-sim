// Codegen: inline dashboard.html into a .ts string constant so the UI ships
// compiled in dist/ — no runtime fs, no loader, no bundler, zero dependencies.
// Edit dashboard.html (real, highlighted HTML); this writes dashboard.generated.ts.
// Run by the gen:html npm script (hooked before dev/build/check/test).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "dashboard.html"), "utf8");

// JSON.stringify yields a valid JS string literal (escapes quotes/newlines/etc.).
const out =
  "// AUTO-GENERATED from dashboard.html by gen-html.mjs — do not edit.\n" +
  "export default " + JSON.stringify(html) + ";\n";

writeFileSync(join(here, "dashboard.generated.ts"), out);
console.log(`gen:html → dashboard.generated.ts (${html.length} bytes)`);
