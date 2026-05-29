# ProxyPilot

A Chrome extension (Manifest V3) for intercepting and modifying HTTP requests and responses. Feature-parity target: [Requestly](https://requestly.io).

## Features

### MVP Rules (implemented)
| Rule | Description | Implementation |
|---|---|---|
| **Redirect** | Redirect matching URLs to a new URL | DNR |
| **Block / Cancel** | Block matching requests | DNR |
| **Modify Headers** | Add/remove/set request or response headers | DNR |
| **Mock Response** | Replace response body, status code, or serve without request | interceptor.js (page layer) |
| **Insert Script** | Inject custom JS/CSS into pages | DNR (scripting API) |
| **Delay** | Add latency to matching requests | interceptor.js |
| **Modify Request Body** | Replace request payload | interceptor.js |
| **Replace String** | Replace URL substrings | DNR |
| **Modify Query Params** | Add/remove URL query parameters | DNR |
| **User Agent** | Override the User-Agent header | DNR |

### URL Matching
- Contains
- Equals (exact)
- Regex Matches
- Wildcard (`*`)

Optional filters: HTTP method, resource type.

## Installation (development)

```bash
npm install
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

## Usage

1. Click the ProxyPilot icon in the toolbar to open the popup.
2. Use the **Enable/Disable** toggle to pause all rules.
3. Click **Manage rules →** to open the full editor.
4. In the editor, select a rule type, set a URL condition, configure the action, and save.

### URL Tester
In the rule editor there's a live URL test field — paste any URL to see if it matches your current condition.

### Import / Export
Click **Export** in the options page to get a JSON snapshot of all rules. Paste it back and click **Import** to restore or merge rules.

## Architecture

### Dual-layer interception

```
Storage (chrome.storage.local)
    │
    ▼
background.js (Service Worker)
    ├─── DNR rules → chrome.declarativeNetRequest  (Redirect, Block, Headers, ...)
    └─── Page rules → content-script.js (postMessage) → interceptor.js (MAIN world)
                                                           (Mock Response, Request Body, Delay)
```

- **`background.js`** — Service worker. Reads storage, compiles DNR rules, pushes page-level rules to tabs.
- **`content-script.js`** — Isolated world bridge. Relays rules to interceptor and logs back to background.
- **`interceptor.js`** — MAIN world. Overrides `fetch` / `XMLHttpRequest` to apply response-body/request-body/delay rules.
- **`popup`** — Quick toggle and rule list.
- **`options`** — Full rule CRUD editor with URL tester and import/export.

### interceptor.js

Derived from the open-source Requestly interceptor (AGPL-3.0). All Requestly-specific identifiers have been replaced with ProxyPilot identifiers (`__PROXYPILOT__`, `PROXYPILOT_INTERCEPTOR`, etc.) and all external reporting code has been removed.

Original copyright: Requestly contributors. License: AGPL-3.0.

## Development

```bash
npm run dev      # watch mode build
npm test         # run unit tests (matcher + DNR compiler)
npm run build    # production build → dist/
```

## Known limitations

- **MV3 cannot modify response bodies via the network layer** — mock/response-body rules require the page-layer interceptor. Very early requests (before `document_start`) may not be intercepted.
- **CSP-restricted pages** may block script injection for Insert Script rules.
- **DNR rule limit**: Chrome enforces a maximum number of dynamic rules (~5000).
