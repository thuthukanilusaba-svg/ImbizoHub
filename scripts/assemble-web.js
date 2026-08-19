// scripts/assemble-web.js
//
// Runs AFTER `expo export -p web`. Its whole job is to lay out the final
// deploy folder so that:
//
//   dist/index.html      -> the marketing landing page  (imbizohub.com/)
//   dist/app/**          -> the Expo web app            (imbizohub.com/app)
//
// WHY A SCRIPT AND NOT A vercel.json REWRITE:
// Vercel evaluates `rewrites` only when no real file matches the path.
// Expo's export writes its own dist/index.html, so a rewrite of "/" would
// never fire — the app's index.html would always win. Physically placing
// the files where they need to live removes that ambiguity entirely, and
// is far easier to reason about than route-precedence rules.
//
// This pairs with `"baseUrl": "/app"` in app.json's experiments block.
// That setting is what makes the exported app reference its own JS and
// assets as /app/_expo/... instead of /_expo/... — WITHOUT it the app
// would load a blank page from /app because every asset URL would 404.
// The two must stay in sync: if you ever move the app back to the root,
// remove baseUrl and this script together.
//
// Written in plain Node (no rm -rf, no cp -r) so it behaves identically
// on a Windows dev machine and on Vercel's Linux builders.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const exportDir = path.join(root, 'dist-app'); // raw `expo export` output
const outDir = path.join(root, 'dist');        // what Vercel publishes
const webDir = path.join(root, 'web');         // hand-written landing page + static files
const appDir = path.join(outDir, 'app');

function fail(msg) {
  console.error(`\n[assemble-web] ${msg}\n`);
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

// 1. Sanity-check the export actually happened. Without this the script
//    would happily produce a dist/ containing only the landing page and
//    a completely missing app — which would deploy "successfully" and
//    take the whole app offline. Fail loudly instead.
if (!fs.existsSync(exportDir)) {
  fail(`Expected the Expo export at ${exportDir} but it does not exist.
Run \`npx expo export -p web --output-dir dist-app\` first, or use \`npm run build:web\`.`);
}
if (!fs.existsSync(path.join(exportDir, 'index.html'))) {
  fail(`${exportDir} exists but has no index.html — the Expo export looks incomplete.`);
}
if (!fs.existsSync(path.join(webDir, 'index.html'))) {
  fail(`Expected the landing page at ${path.join(webDir, 'index.html')} but it is missing.`);
}

// 2. Start from a clean dist so stale files from a previous build can
//    never linger and get served.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 3. App goes to /app, landing page and its static assets go to the root.
copyDir(exportDir, appDir);
copyDir(webDir, outDir);

// 4. Report what shipped, so a broken deploy is obvious in the build log
//    rather than only in production.
const appFiles = fs.readdirSync(appDir).length;
const rootFiles = fs.readdirSync(outDir).filter((f) => f !== 'app');
console.log('[assemble-web] done');
console.log(`  dist/          -> ${rootFiles.join(', ')}`);
console.log(`  dist/app/      -> ${appFiles} entries (Expo web build)`);
