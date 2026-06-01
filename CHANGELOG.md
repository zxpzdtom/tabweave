# 更新日志 / Changelog

这里记录 TabWeave 每次发版的主要变化。

All notable changes to TabWeave are recorded here.

## 0.7.1 - 2026-06-01

### 中文

- 为 Chrome Web Store 合规调整新标签页搜索：改用 Chrome 默认搜索引擎设置，不再提供扩展内的搜索引擎选择或自定义搜索 URL。
- 新增 `search` 权限说明所需的实现基础，避免新标签页和搜索体验被视为两个独立功能。

### English

- Update New Tab search for Chrome Web Store compliance: searches now use Chrome's default search provider settings, and extension-level search engine/custom search URL choices were removed.
- Add the implementation basis for the `search` permission so the New Tab page and search entry remain one compliant flow.

## 0.7.0 - 2026-05-30

### 中文

- 优化 Options 顶部操作文案：导入/导出改为导入配置/导出配置，整理按钮不再暴露“全部窗口”范围。
- 调整 Command 搜索默认结果：空搜索时“全部”不显示内置命令，切换到“命令”分类仍可查看全部命令。
- 为历史记录结果补充网站图标，并按 Chrome 扩展要求声明 favicon 访问资源。
- 更新扩展图标、Chrome Web Store 图标、宣传图和 5 张商店展示图，重新设计产品截图风格。
- 更新 Chrome Web Store 素材清单和上架文案，指向新的 0.7.0 发布包。

### English

- Refine Options header copy: import/export now read as config actions, and the organize button no longer exposes the “all windows” scope.
- Adjust Command search defaults: built-in commands are hidden from the empty “All” view while remaining available in the Command category.
- Add website favicons for history results and declare the required favicon web-accessible resource for Chrome extensions.
- Refresh extension icons, Chrome Web Store icon, promo tiles, and five redesigned store listing screenshots.
- Update the Chrome Web Store asset manifest and listing copy for the new 0.7.0 package.

## 0.6.0 - 2026-05-23

### 中文

- 新增标签页定时恢复（Snooze）功能：支持对单个标签或整个分组设置定时恢复，到时自动打开。
- 定时恢复支持循环模式，可按每日固定时间重复唤醒。
- 分组推迟使用单一闹钟机制，避免多标签并发唤醒时的竞态问题。
- 定时恢复卡片支持分组折叠展示，分组与单标签均有统一边框样式。
- 新增窗口快照功能：一键保存当前窗口所有标签页及分组状态。
- 快照详情视图支持交互式操作：拖拽排序、关闭标签、解散分组、折叠/展开。
- 快照恢复改为在新浏览器窗口中打开，恢复后自动删除快照。
- AI 整理默认 Prompt 支持中英文自动切换，根据界面语言选择对应模板。
- AI 整理默认开启发送 URL 和页面上下文，提升分组准确度。
- 修复恢复弹框在亮色主题下显示异常的问题。
- 修复新标签页 Tab 导航圆角被裁剪的问题。
- 快照删除新增双击确认机制，防止误删。

### English

- Add tab snooze feature: schedule individual tabs or entire groups to reopen at a specified time.
- Snooze supports recurring mode for daily wake-ups at a fixed time.
- Group snooze uses a single alarm per group to avoid race conditions with concurrent wake-ups.
- Snoozed card displays groups in a collapsible layout; both groups and single tabs have a unified card style.
- Add window snapshot feature: save all tabs and group states of the current window with one click.
- Snapshot detail view supports interactive operations: drag-and-drop reorder, close tabs, ungroup, collapse/expand.
- Snapshot restore now opens in a new browser window and auto-deletes the snapshot after restoring.
- AI organize default prompt auto-switches between Chinese and English based on the UI language.
- AI organize now sends URLs and page context by default for better grouping accuracy.
- Fix restore modal displaying incorrectly under light theme.
- Fix tab navigation pill border-radius clipping on the new tab page.
- Add double-click confirmation for snapshot deletion to prevent accidental removal.

## 0.5.0 - 2026-05-17

### 中文

- 新增 Chrome 新标签页 Dashboard，可直接查看分组和未分组标签，并支持在设置中开启或隐藏。
- 新标签页支持搜索、整理当前窗口、标签去重、闲置标签休眠，以及打开设置等常用操作。
- 新标签页复用 AI 整理流程，可在 Dashboard 中生成、检查并应用 AI 分组计划。
- 新增隐私政策文档，并在中英文 README 中提供入口，方便 Chrome Web Store 隐私字段提交。

### English

- Add a Chrome New Tab dashboard for reviewing grouped and ungrouped tabs, with a setting to show or hide it.
- Support search, organize, deduplicate, hibernate, and settings shortcuts directly from the New Tab page.
- Reuse the AI organize flow on the New Tab dashboard so users can generate, review, and apply AI grouping plans there.
- Add a privacy policy document and link it from both English and Chinese READMEs for Chrome Web Store privacy field submission.

## 0.4.0 - 2026-05-15

### 中文

- 新增 AI 整理入口，可在设置中开启或隐藏，并支持 OpenAI、OpenRouter、Gemini 和 OpenAI 兼容服务商。
- AI 整理默认只生成临时分组计划；应用前可检查、展开分组、移除条目、重命名分组，并可选择保存为完整 URL 精确匹配的固定规则。
- 新增 AI Prompt 自定义编辑器，支持内置变量高亮、实际值提示、恢复默认，以及按全局语言和分组阈值渲染 Prompt。
- 支持每个 AI 服务商分别保存 API Key，多个 Key 可用逗号或换行分隔并按顺序轮询使用，输入框会显示 Key 数量。
- AI 整理会在可访问页面中读取轻量 Meta、Open Graph、canonical 和标题层级上下文，不再主动申请读取所有网站数据权限。
- 优化侧边栏体验：AI 执行时显示 Apple Intelligence 风格响应边框，状态提示会自动消失，分组可一键取消分组，窄宽度按钮文案更稳定。
- 修复 OpenRouter 行为：只请求用户指定的模型，并将超时时间调整为 75 秒。

### English

- Add an AI organize entry that can be enabled or hidden in Settings, with OpenAI, OpenRouter, Gemini, and OpenAI-compatible provider support.
- Make AI organize temporary by default: review the plan before applying, expand groups, remove tabs, rename groups, and optionally save exact full-URL rules.
- Add a custom AI prompt editor with built-in variable highlighting, rendered-value tooltips, restore default, and prompt rendering from global language and grouping threshold settings.
- Save API keys separately per AI provider, support comma/newline-separated key rotation, and show the parsed key count in the API key field.
- Use lightweight page metadata, Open Graph, canonical URLs, and headings as AI context when accessible, without proactively requesting all-site data access.
- Polish the Side Panel with an Apple Intelligence-style AI response glow, auto-dismissing status messages, one-click group ungrouping, and more stable narrow-width action buttons.
- Fix OpenRouter behavior so TabWeave only calls the user-selected model and uses a 75-second timeout.

## 0.3.2 - 2026-05-14

### 中文

- 新增默认开启的 Chrome Side Panel 模式，并保留设置项可切回 Popup。
- 侧边栏复用标签分组工作台，并在 Options 页修改语言或主题后实时同步。
- 整理时会合并已打开窗口中的同名 Chrome 原生标签组，名称比较忽略大小写和多余空格。
- 快捷键设置页改为展示 Chrome 实际分配的快捷键，冲突或未配置时显示“未绑定”。
- 优化窄侧栏按钮文案与“关闭”按钮排版，减少换行和拥挤。

### English

- Add a default-on Chrome Side Panel mode while keeping a setting to switch back to Popup.
- Reuse the tab grouping workspace in the Side Panel and sync language/theme changes from Options in real time.
- Merge duplicate open Chrome tab groups during organize, comparing titles case-insensitively and ignoring extra whitespace.
- Show Chrome's actual assigned shortcuts in Options, with “Unbound” for conflicts or unset shortcuts.
- Tighten narrow Side Panel button copy and close-button layout to avoid cramped wrapping.

## 0.3.1 - 2026-05-13

### 中文

- 修复 Options 页规则条件中“匹配字段”和“匹配方式”下拉菜单的定位偏移。
- 将自动保存提示调整为基于当前视口显示，滚动到页面底部时仍可见。
- 优化规则编辑器的匹配预览，移除默认示例内容和容易干扰的固定测试文案。

### English

- Fix dropdown positioning for the Field and Mode selectors in rule conditions on the Options page.
- Keep autosave notifications anchored to the current viewport so they remain visible while scrolling.
- Refine the rule editor match preview by removing default sample content and noisy fixed test copy.

## 0.3.0 - 2026-05-12

### 中文

- 新增 Command 搜索：可用快捷键搜索打开的标签、Chrome 分组、历史记录和内置整理命令。
- 支持从 Command 搜索中直接跳转标签/分组，或执行整理当前窗口、标签去重和闲置标签休眠。
- 新增图片与静态资源默认规则，方便自动归组图标、图片和常见 asset 页面。
- 优化 Popup 分组控制，将展开/收起全部合并为一个上下文按钮。
- 更新扩展运行时图标、扩展页 favicon、Chrome Web Store 图标、宣传图和 5 张商店展示图。
- 新增 Chrome Web Store 素材清单，集中记录上架包、图标、宣传图和截图路径。

### English

- Add Command search for open tabs, Chrome tab groups, history entries, and built-in cleanup commands.
- Support jumping to tabs/groups or running organize, deduplicate, and hibernate actions from Command search.
- Add a default images/assets rule for icon, image, upload, and static asset pages.
- Improve Popup group controls by combining expand/collapse-all into a contextual button.
- Refresh runtime icons, extension page favicons, Chrome Web Store icon, promo images, and five store listing screenshots.
- Add a Chrome Web Store asset manifest that records the upload package, icons, promo tiles, and screenshots.

## 0.2.0 - 2026-05-12

### 中文

- 新增重复标签清理：支持自动关闭重复标签，也可以在 Popup 或设置页手动去重，并保护固定或正在发声的标签。
- 增强分组工作流：Popup 支持展开/收起全部分组、关闭整组或单个标签，并可从未分组标签手动创建保存规则。
- 强化规则管理：规则支持搜索、多选、批量删除、复制、拖拽排序、最小成组数量，以及每条规则的多条件匹配。
- 新增闲置标签休眠：可按当前窗口或全部窗口扫描后台标签，配置闲置阈值、媒体/协作保护和白名单。
- 修复规则导入覆盖行为，导入含偏好设置的规则文件时会正确替换当前规则与相关设置。
- 更新扩展图标，并打磨设置页、Popup、主题和中英文文案。
- 新增双语更新日志，并在构建时校验当前版本已写入 changelog。

### English

- Add duplicate tab cleanup with automatic and manual actions from the Popup or options page, while protecting pinned or audible tabs.
- Improve the grouping workflow with expand/collapse-all controls, group/tab closing actions, and manual saved groups from ungrouped tabs.
- Strengthen rule management with search, multi-select, bulk delete, duplication, drag sorting, minimum tab thresholds, and multi-condition matching.
- Add inactive tab hibernation with current-window or all-window scans, idle thresholds, media/collaboration protection, and whitelist rules.
- Fix rule import overwrite behavior so imported rules and included preferences replace the current state correctly.
- Refresh extension icons and polish the options page, Popup, themes, and Chinese/English copy.
- Add a bilingual changelog and a build-time check that the current version has a changelog entry.

## 0.1.0 - 2026-05-10

### 中文

- 发布 TabWeave 首个可用版本。
- 支持按 URL、标题、域名和正则条件自动整理 Chrome 标签分组。
- 提供默认规则、规则导入导出、快捷键、深浅色主题和中英文界面。
- 提供 Popup 工作台和 Options 设置页，用于查看分组、编辑规则和手动整理当前窗口。

### English

- Ship the first usable TabWeave release.
- Support automatic Chrome tab grouping by URL, title, domain, and regular expression rules.
- Provide default rules, rule import/export, keyboard shortcuts, light/dark themes, and Chinese/English UI.
- Provide the Popup workspace and options page for reviewing groups, editing rules, and manually organizing the current window.
