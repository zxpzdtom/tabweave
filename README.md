# TabWeave

[中文文档](./README.zh-CN.md) · [Chrome Web Store](https://chromewebstore.google.com/detail/tabweave/pmfoefbiapldlpljfpjienjahdfmefej) · [GitHub Issues](https://github.com/zxpzdtom/tabweave/issues/new)

TabWeave is a Chrome extension for keeping tab groups clean with rule-based automation. It can group tabs by domain, full URL, page title, or regular expressions, then keep existing managed groups in sync as pages finish loading.

## Highlights

- **Rule-based tab grouping** using domain, URL, title, contains, equals, and regex matching.
- **Multiple conditions per rule**. Each condition has its own field, match mode, and pattern.
- **Popup workspace** for checking groups, expanding/collapsing groups, closing tabs, and creating manual groups.
- **Options page** for rule CRUD, drag-to-reorder priority, import/export, preferences, shortcuts, and issue links.
- **Automatic reconciliation**. If a tab no longer matches the rule that grouped it, TabWeave can move it back to ungrouped.
- **Dark, light, and system themes**.
- **Chinese / English UI**, defaulting to the browser language.
- **Chrome command shortcuts** for opening the popup, organizing the current window, and closing duplicate tabs.

## Screens and entry points

TabWeave ships two extension pages:

- **Popup**: quick workspace for the current window.
- **Options**: rule management and preferences.

The background service worker listens for tab creation, tab updates, and extension commands.

## Default rules

TabWeave includes a practical starter set:

| Rule | Examples | Group |
| --- | --- | --- |
| Blank pages | `chrome://newtab/`, `about:blank` | `Blank` |
| Chrome and extension pages | `chrome://settings/`, extension options pages | `Chrome` |
| GitHub workflow | `github.com` | `Code` |
| Documentation | docs, documentation, guide, manual, 文档, 指南 | `Docs` |
| AI assistants | ChatGPT, Claude, Gemini, Perplexity, Poe, Kimi, Doubao | `AI` |
| Design tools | Figma, Canva, Dribbble, Behance | `Design` |
| Notes and knowledge | Notion, Yuque, Feishu, Lark | `Notes` |
| Mail and calendar | Gmail, Outlook, Google Calendar | `Mail` |
| Video and streaming | YouTube, Bilibili, Netflix, Vimeo, Twitch, Douyin, Kuaishou, iQIYI, Youku | `Video` |
| Local development | localhost, 127.0.0.1, 0.0.0.0, ::1 | `Local Dev` |

New default rules are merged into existing installations without overwriting user-created rules.

## Rule model

A rule contains:

- Rule name
- Target group name
- Group color
- Enabled state
- One or more match conditions

Each condition contains:

- **Field**: domain, URL, or title
- **Mode**: contains, equals, or regex
- **Pattern**: one or more lines; each line is treated as an OR condition

Rules are evaluated from top to bottom. The first enabled rule that matches a tab decides the target group.

## Development

```bash
npm install
npm run dev
```

The Vite dev server is useful for React page development. Chrome extension APIs require loading the built `dist` directory in Chrome.

## Build

```bash
npm run build
```

Then load the extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the project `dist` directory.

## Shortcuts

Declared shortcuts:

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Open Popup | Command + Shift + Y | Ctrl + Shift + Y |
| Organize tabs | Option + Shift + G | Ctrl + Shift + G |
| Deduplicate tabs | Option + Shift + D | Ctrl + Shift + X |

Chrome may leave a shortcut unset if it conflicts with another command. You can change shortcuts at:

```text
chrome://extensions/shortcuts
```

## Sync notes

TabWeave can store preferences and rules in `chrome.storage.sync`. During development, cross-device sync only works reliably when the extension ID is the same on every device. Unpacked extensions often have different IDs across machines. Published Chrome Web Store extensions have stable IDs.

For development builds, import/export is the most reliable way to move rules between machines.

## Project structure

```text
src/
  background.ts          MV3 service worker
  popup.tsx              Popup workspace
  options.tsx            Options / rule editor
  components/ui.tsx      Shared UI primitives
  lib/
    constants.ts         Default rules, colors, storage keys
    grouping.ts          Rule matching, grouping, reconciliation
    i18n.ts              Chinese / English messages
    links.ts             GitHub and extension metadata links
    shortcuts.ts         Platform-aware shortcut formatting
    storage.ts           chrome.storage wrapper
    theme.ts             Theme application helpers
    types.ts             Shared TypeScript types
public/
  manifest.json          Chrome extension manifest
  icons/                 Extension icons
```

## License

MIT
