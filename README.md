# 府城营造司

以明代府城规划基因为内核的网页游戏 demo。

- **经典模式**：舆图上保定、襄阳、荆州、武昌四城顺次解锁；每城一节营建课，按方位、地形与礼制营建府城，接受礼部「议礼」的诘问；三城还可入城寻访、点亮七项城池基因。
- **自定义模式**：在真实比例的大明疆域六边形大地图（天下舆图）上，用形胜透镜择址建府，再进入城址自由营建。

- 线上试玩：https://gazerrr03.github.io/fucheng-yingzaosi/
- 技术：WebGL2 + TypeScript + Vite，不用游戏引擎；3D 模型由 `tools/blender/` 下的脚本在 Blender 里生成。

## 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:5173/ 。常用入口：`?view=classic` 经典舆图，`?view=world` 天下舆图，`?city=xiangyang` 探索襄阳，`?lesson=xiangyang` 襄阳营建课，`?custom=chongqing` 重庆城址。

## 检查

```bash
npm run build                    # 类型检查 + 构建
node tools/check_models.mjs      # 模型能否被加载器读取
python3 tools/check_level.py xiangyang
node tools/check_yili.mjs        # 议礼判定、评分、史书断言
python3 tools/build_world_map.py # 重新生成天下舆图（public/data/world/ming.json）
node tools/shot.mjs "http://localhost:5173/?view=world" /tmp/w.png   # 无头截图
```

## 文档

- `docs/验收清单.md`：当前版本的验收路线与已知问题
- `docs/玩法需求_v1.md`、`v2`、`v3_议礼.md`、`v4_进入流程与天下舆图.md`：各轮需求拆解
- `docs/资料问题报告.md`：资料数值冲突与占位
- `docs/模型体检报告.md`：3D 模型精度、贴图、投影与远近模型

推到 `main` 后，GitHub Actions 自动构建并发布到 GitHub Pages（`.github/workflows/pages.yml`）。
