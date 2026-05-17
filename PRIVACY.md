# TabWeave Privacy Policy

Last updated: May 17, 2026

TabWeave is a Chrome extension for organizing browser tabs into useful tab groups. This policy explains what information TabWeave handles, how it is used, and when it may be shared.

## Information TabWeave Handles

TabWeave may access the following information in Chrome to provide its tab organization features:

- Open tab metadata, including tab titles, URLs, domains, window IDs, tab group names, and tab activity state.
- Browser history entries when the command search feature is used to search and reopen history results.
- User-created rules, group preferences, theme and language preferences, hibernation settings, search settings, and AI grouping settings.
- AI provider settings entered by the user, including API keys and model or endpoint configuration.
- Optional page context for AI grouping, such as page title, canonical URL, meta descriptions, Open Graph metadata, language, and page headings.

TabWeave does not collect names, email addresses, payment information, passwords, cookies, or authentication tokens.

## How Information Is Used

TabWeave uses this information only to provide and improve its single purpose: organizing and navigating browser tabs.

Specifically, TabWeave uses tab metadata and user rules to:

- Match tabs against grouping rules.
- Create, rename, collapse, deduplicate, or hibernate tab groups.
- Show open tabs, groups, commands, and matching history results in the extension UI.
- Apply user preferences such as grouping scope, theme, language, and sync behavior.
- Generate an optional AI grouping plan when the user enables and runs AI grouping.

## Storage

TabWeave stores settings in Chrome extension storage:

- Rules and general preferences may be stored in `chrome.storage.sync` or `chrome.storage.local`, depending on the user's sync setting.
- AI grouping settings and API keys are stored in `chrome.storage.local`.

Chrome may sync data stored in `chrome.storage.sync` through the user's Google account if Chrome sync is enabled. TabWeave does not operate its own account system or backend service.

## Sharing and Third Parties

TabWeave does not sell user data and does not share user data with the developer's own server.

When the optional AI grouping feature is enabled and the user runs it, TabWeave sends selected tab metadata to the AI provider configured by the user. Supported providers include OpenAI, OpenRouter, Google Gemini, or a user-configured OpenAI-compatible endpoint. Depending on the user's settings, this request may include tab titles, domains, URLs, group names, and optional page context. The user's API key is used only to make requests to the selected provider from the extension.

When the new tab search feature is used, the search query is sent to the search engine selected by the user.

Third-party services process information according to their own privacy policies and terms.

## Limited Use

TabWeave limits its use of user data to providing or improving its tab organization, tab navigation, history search, hibernation, deduplication, and optional AI grouping features. TabWeave does not use user data for advertising, user profiling, creditworthiness, or unrelated purposes.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Remote Code

TabWeave does not load or execute remotely hosted extension code. Optional AI providers return grouping suggestions as data; they are not executed as extension code.

## Data Retention and Deletion

TabWeave keeps settings only as long as they remain in Chrome extension storage. Users can delete this data by:

- Removing the extension from Chrome.
- Clearing the extension's storage data in Chrome.
- Editing or deleting rules and preferences from TabWeave's Options page.
- Removing AI provider API keys from TabWeave's Options page.

## Security

Requests to AI providers and search engines are sent over HTTPS when those services use HTTPS endpoints. Users should only configure trusted AI-compatible endpoints and should avoid entering API keys they do not want stored locally by the extension.

## Contact

For privacy questions or requests, please contact the developer through the TabWeave GitHub repository:

https://github.com/zxpzdtom/tabweave
