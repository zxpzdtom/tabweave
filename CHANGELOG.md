# 更新日志 / Changelog

这里记录 TabWeave 每次发版的主要变化。

All notable changes to TabWeave are recorded here.

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
