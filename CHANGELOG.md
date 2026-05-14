# 更新日志 / Changelog

这里记录 TabWeave 每次发版的主要变化。

All notable changes to TabWeave are recorded here.

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
