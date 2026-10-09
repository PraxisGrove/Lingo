# Lingo / Dual Fold

Lingo 的长期标志以“双向折环”为核心：两个相向的 L 对应原文与译文，180° 旋转对称构成稳定轮廓，45° 切口赋予翻页和语言流转的动势。

主标志、字标和组合 Logo 均为可编辑 SVG。字标由自绘轮廓组成，无需字体文件。单色版保留完整识别结构；酸橙绿作为可识别的品牌色。

## 资产

| 场景 | 文件 |
| --- | --- |
| 符号母版 | `assets/brand/lingo-symbol.svg` |
| 字标母版 | `assets/brand/lingo-wordmark.svg` |
| 应用图标 SVG | `public/brand/lingo-icon.svg` |
| 黑、白、绿透明符号 | `public/brand/lingo-symbol-{ink,white,lime}.svg` |
| 黑、白横向 Logo | `public/brand/lingo-logo-{ink,white}.svg` |
| 扩展图标 | `public/icon/{16,32,48,96,128}.png` |
| 高清 PNG 与透明 PNG | `docs/brand/assets/` |
| 完整资产包 | `docs/brand/assets/lingo-brand-kit.zip` |
| 演示图 | `docs/brand/preview.png` |

## 视觉规则

- Ink：`#171A17`，核心符号和文字。
- Acid lime：`#DFFF45`，应用图标及品牌强调色。
- Paper：`#F4F4EF`，浅色基底与反白标志。
- 符号与其他内容之间至少留出约一个笔画宽度的空间。
- 独立符号建议显示尺寸不小于 24px；工具栏使用专门的 16px PNG，避免直接缩小组合 Logo。
- 16px 版本使用相同骨架，并加宽两个开口，保持像素级辨识度。
- 保持原比例、相向结构与开口，不增加细线或改变切口角度。
- 浅色背景用 Ink，深色背景用反白；彩色应用图标使用固定的 Ink 底与 Acid lime 符号。

## 再生成与预览

修改母版后运行：

```bash
pnpm icons
pnpm brand:preview
```

预览地址为 `http://127.0.0.1:4174/`。预览服务器仅绑定本机，只提供品牌演示与品牌资产。`docs/brand/index.html` 也可直接在浏览器中打开，浅深背景切换不依赖网络。

扩展 PNG、公开 SVG 和高清 PNG 由母版再生成。大尺寸下载资产放在文档目录，不进入扩展发布包；浏览器只打包运行时需要的轻量资源。栅格化使用锁定版本的 resvg，`pnpm icons` 不请求任何远程服务。

## 参考

研究了 [YouMind](https://youmind.com/)、[World Labs](https://www.worldlabs.ai/)、[Scale 品牌系统](https://brand.scale.com/) 与 [Photon 品牌系统](https://photon.codes/brand) 的符号、留白与组合方式。参考用于判断视觉表达；本资产包的几何路径与字标独立绘制，没有包含这些品牌的图形资源。
