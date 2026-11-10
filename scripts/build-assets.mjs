import { copyFile } from 'node:fs/promises';
// Mirror the transpiled, browser-safe TypeScript script into the served public folder.
await copyFile('dist/src/web/client/app.js','public/assets/app.js');
console.log('Browser TypeScript asset built: public/assets/app.js');
