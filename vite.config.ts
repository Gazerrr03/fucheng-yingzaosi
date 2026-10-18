import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** JSON 格式化：两格缩进，但把纯数字的短数组收成一行，方便人读和 diff。 */
export function formatJSON(value: unknown): string {
  return (
    JSON.stringify(value, null, 2).replace(/\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]/g, (_, inner: string) =>
      `[${inner.split(/,\s*/).join(', ')}]`,
    ) + '\n'
  );
}

/** 仅开发期：标定工具通过 POST /__save/{city} 把关卡数据写回 public/data/{city}.json。 */
function levelSavePlugin(): Plugin {
  return {
    name: 'level-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save/', async (req, res) => {
        const city = (req.url ?? '').replace(/^\//, '').split('?')[0];
        if (req.method !== 'POST' || !/^[a-z]+$/.test(city)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const data = JSON.parse(body);
          if (data.id !== city) throw new Error('id 与路径不一致');
          await writeFile(resolve(__dirname, 'public', 'data', `${city}.json`), formatJSON(data));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages 部署在子路径（/fucheng-yingzaosi/），由工作流通过 BASE_PATH 传入；本地开发为根路径
  base: process.env.BASE_PATH ?? '/',
  plugins: [levelSavePlugin()],
});
