// 议礼判定的断言脚本：用 esbuild 把 tools/tests/yili.test.ts 打包成临时 mjs 再运行。
// 用法：node tools/check_yili.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(mkdtempSync(join(tmpdir(), 'yili-')), 'yili.test.mjs');
await build({
  entryPoints: [join(ROOT, 'tools/tests/' + (process.argv[2] ?? 'yili') + '.test.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out,
  loader: { '.css': 'empty' }, logLevel: 'error',
  define: {
    'import.meta.env': JSON.stringify({ BASE_URL: '/', DEV: false }),
    'import.meta.url': JSON.stringify(pathToFileURL(join(ROOT, 'tools/tests/yili.test.ts')).href),
  },
});
await import(pathToFileURL(out).href);
