<p align="center">
  <img src="./public/icons/icon-128.png" alt="TabWeave 图标" width="96" height="96">
</p>

<h1 align="center">TabWeave</h1>

<p align="center">
  规则驱动的 Chrome 标签页分组工具，适合常年开着很多标签的人。
</p>

<p align="center">
  <a href="./README.md">English README</a> ·
  <a href="https://chromewebstore.google.com/detail/tabweave/pmfoefbiapldlpljfpjienjahdfmefej">Chrome 商店</a> ·
  <a href="./PRIVACY.md">隐私政策</a> ·
  <a href="./CHANGELOG.md">更新日志</a>
</p>

TabWeave 是一个用于管理 Chrome 标签页分组的浏览器扩展。它可以按域名、完整 URL、页面标题或正则规则自动分组，并在页面加载完成后保持规则分组的状态正确。

## 功能亮点

- **规则驱动的标签页分组**：支持域名、URL、标题、包含、等于和正则匹配。
- **一条规则支持多个匹配条件**：每条条件都有独立的匹配字段、匹配方式和匹配内容。
- **Popup 工作台**：查看分组、展开/收起分组、关闭标签、手动创建分组。
- **Options 设置页**：规则增删改查、拖拽排序、导入导出、偏好设置、快捷键和问题反馈入口。
- **自动纠偏**：如果标签页不再匹配当前规则分组，会自动移回未分组。
- **深色 / 浅色 / 跟随系统主题**。
- **中英文界面**：默认跟随浏览器语言，也可以手动切换。
- **Chrome 快捷键**：支持快捷打开 Popup、整理当前窗口、关闭重复标签和打开 Command 搜索。
- **Command 搜索**：快速跳转已打开标签、分组、历史记录和内置整理命令。
- **标签页定时恢复**：将标签或分组设为定时关闭、到时自动打开，支持每日循环。
- **窗口快照**：一键保存和恢复当前窗口的所有标签页及分组状态。

## 页面入口

TabWeave 包含两个主要入口：

- **Popup**：当前窗口的快速分组工作台。
- **Options**：完整规则管理和偏好设置页。

后台 Service Worker 会监听标签页创建、URL 更新和快捷键命令。

## 默认规则

TabWeave 预置了一组常用规则：

| 规则 | 示例 | 分组 |
| --- | --- | --- |
| Chrome 与扩展页面 | `chrome://settings/`、扩展设置页 | `Chrome` |
| GitHub 工作流 | `github.com` | `Code` |
| 文档与知识库 | docs、documentation、guide、manual、文档、指南 | `Docs` |
| AI 助手 | ChatGPT、Claude、Gemini、Perplexity、Poe、Kimi、豆包 | `AI` |
| 设计工具 | Figma、Canva、Dribbble、Behance | `Design` |
| 笔记与知识管理 | Notion、语雀、飞书、Lark | `Notes` |
| 邮箱与日程 | Gmail、Outlook、Google Calendar | `Mail` |
| 视频与流媒体 | YouTube、Bilibili、Netflix、Vimeo、Twitch、抖音、快手、爱奇艺、优酷 | `Video` |
| 图片与静态资源 | icon、img、image、upload、svg、png、jpg、webp | `Assets` |
| 本地开发服务 | `localhost`、`127.0.0.1`、`0.0.0.0`、`::1` | `Local Dev` |

默认规则会在首次安装时创建，也可以在 Options 页面手动恢复。只要你保存过规则列表，TabWeave 就会尊重这份列表：如果你把全部规则都删除，刷新后也会保持为空，不会重新补回默认规则。

## 规则模型

一条规则包含：

- 规则名称
- 目标分组名称
- 分组颜色
- 启用状态
- 一个或多个匹配条件

每个匹配条件包含：

- **匹配字段**：域名、URL、标题
- **匹配方式**：包含、等于、正则
- **匹配规则**：支持多行，每行都是 OR 关系

规则按从上到下的顺序执行。第一个匹配成功的启用规则会决定标签页进入哪个分组。

## 导入与导出

在 Options 页面点击 **导出**，可以把当前规则和偏好设置保存为 JSON 文件。

点击 **导入** 可以从 JSON 文件恢复。导入是全量覆盖：TabWeave 会先弹出确认提示，确认后会覆盖当前全部规则，并应用文件内包含的偏好设置。

## 开发

```bash
npm install
npm run dev
```

Vite 开发服务器适合调试 React 页面。Chrome 扩展 API 需要构建后加载 `dist` 目录才能正常使用。

## 构建并加载到 Chrome

```bash
npm run build
```

然后：

1. 打开 `chrome://extensions`。
2. 开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择项目的 `dist` 目录。

## 快捷键

默认快捷键：

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 打开 TabWeave | Command + B | Ctrl + B |
| 整理标签 | Option + Shift + G | Ctrl + Shift + G |
| 标签去重 | Option + Shift + D | Ctrl + Shift + X |

如果快捷键和 Chrome 或其他扩展冲突，Chrome 可能会显示“未设置”。可以在这里修改：

```text
chrome://extensions/shortcuts
```

## 跨设备同步说明

TabWeave 可以使用 `chrome.storage.sync` 保存规则和偏好设置。但在开发阶段，如果你通过“加载已解压的扩展程序”安装，跨设备同步只有在两台设备的扩展 ID 一致时才可靠。

Chrome Web Store 发布后的扩展 ID 是稳定的，跨设备同步会更可靠。

开发版迁移规则时，建议优先使用导入 / 导出。因为导入会覆盖整套规则，如果可能需要回退，建议先导出现有配置。

## 项目结构

```text
src/
  background.ts          MV3 后台 Service Worker
  popup.tsx              Popup 工作台
  options.tsx            设置页 / 规则编辑器
  components/ui.tsx      通用 UI 组件
  lib/
    constants.ts         默认规则、颜色、存储键
    grouping.ts          规则匹配、分组、自动纠偏
    i18n.ts              中英文文案
    links.ts             GitHub 与扩展元信息
    shortcuts.ts         快捷键平台格式化
    storage.ts           chrome.storage 封装
    theme.ts             主题应用逻辑
    types.ts             共享类型定义
public/
  manifest.json          Chrome 扩展 Manifest
  icons/                 扩展图标
store-assets/
  chrome-web-store-assets.json  Chrome 商店上传素材清单
  store-*.png                   商店展示图
```

## License

MIT
