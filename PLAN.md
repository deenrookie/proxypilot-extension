# PLAN.md — Chrome 网络请求拦截与修改插件

> 目标:实现一个功能对标 [Requestly](https://chromewebstore.google.com/detail/requestly-intercept-modif/mdnleldcmiljblolnjhpnblkcekpdkpa) 的 Chrome 扩展(Manifest V3),能够拦截并对**请求与响应的数据包**进行修改(改头、改 body、重定向、Mock、拦截等)。项目已具备从 Requestly 改造而来的核心页面拦截模块 `interceptor.js`,本计划指导 Agent **清除其中的 Requestly 残留并替换为本项目标识**,再围绕它补齐完整插件。

本文件是 Agent 的开发蓝图。请**按阶段顺序执行**,每个阶段完成后对照"验收标准"自检,通过后再进入下一阶段。遇到与现有 `interceptor.js` 实现冲突时,以 `interceptor.js` 的实际接口为准,并在第 0 阶段更新本文档的"对接契约"。

---

## 0. 前置:摸清现状(必须最先做)

在写任何新代码前:

1. 阅读已有 `interceptor.js`,搞清楚:
   - 它运行在哪个上下文(预期是 **MAIN world**,直接覆盖页面的 `fetch` / `XMLHttpRequest`)。
   - 它通过什么方式接收"规则"(全局变量?`window.postMessage`?自定义事件?)。
   - 它支持哪些操作(改响应体?改请求体?延迟?Mock?)。
   - 它如何回传日志/拦截记录。
2. 用一句话总结其输入输出,**回填到本文档第 6 节"对接契约"**。
3. **排查并登记所有 Requestly 残留**(关键):`interceptor.js` 派生自 Requestly,里面会夹带 Requestly 专属标识,必须全部换成本项目标识,否则与新写的 content-script 对不上、通信失效。逐一找出并列成清单:
   - 命名空间/全局变量:如 `__REQUESTLY_*`、`window.RQ`、`rq_*`、`__RQ_INTERCEPTOR__` 等。
   - 消息 `source`/`type` 字段:如 `source: 'requestly'`、事件名 `rq:rules` 之类。
   - 品牌字样:日志前缀、注释、字符串里的 "Requestly" / "requestly.io"。
   - 硬编码 URL / 远程上报端点 / 遥测(若有,直接移除)。
   - Requestly 自有的规则数据结构字段名(需映射到第 5 节的数据模型)。
   把清单连同"替换为什么"写进第 6.1 节,作为阶段 4 的改造依据。
4. 运行 `node -v` / `npm -v`,确认构建环境;若项目已有 `package.json`,先 `npm install` 跑通。

> ⚠️ 原则:`interceptor.js` 的**拦截机制/逻辑**是既成事实(source of truth),其它代码去适配它的工作方式。但其中的 **Requestly 专属标识(命名空间、消息名、品牌、上报端点)是要被替换/移除的残留**,不属于"既成事实"——必须统一改成本项目的命名(见第 6.1 节)。两件事别混淆:保留逻辑,换掉标识。
>
> 📄 许可提示:`interceptor.js` 源自开源的 Requestly,改用前确认其上游许可证(注意 Requestly 部分代码为 AGPL-3.0),保留必要的版权/许可声明,合规使用。本项目非法律意见,如有疑虑请咨询。

---

## 1. 项目概述

| 项 | 内容 |
|---|---|
| 形态 | Chrome 扩展,Manifest V3 |
| 核心能力 | 拦截并修改 HTTP 请求与响应(重定向、改头、改 body、Mock、拦截、注入脚本、延迟) |
| 对标产品 | Requestly |
| 已有资产 | `interceptor.js`(页面层拦截核心) |
| 不做 | 桌面客户端、团队协作/云同步、账号体系、API Client(这些是 Requestly 商业部分,超出本插件范围) |

---

## 2. 功能范围(规则类型)

对标 Requestly 的规则类型,按优先级分为 MVP 与扩展。每条规则都包含:启用开关、匹配条件、动作。

### 2.1 MVP(必须实现)

| # | 规则类型 | 说明 | 实现路径 |
|---|---|---|---|
| R1 | **Redirect 重定向** | 把匹配的请求 URL 重定向到另一个 URL | DNR |
| R2 | **Block / Cancel 拦截** | 阻止匹配的请求发出 | DNR |
| R3 | **Modify Headers 改请求/响应头** | 增/删/改 request & response headers | DNR |
| R4 | **Modify Response 改响应体** | 替换响应 body、改 status code、Mock 静态响应 | interceptor.js |
| R5 | **Insert Scripts 注入脚本/样式** | 在页面注入自定义 JS / CSS | content script + MAIN world |

### 2.2 扩展(MVP 之后)

| # | 规则类型 | 说明 | 实现路径 |
|---|---|---|---|
| R6 | **Modify Query Params** | 增/删/改 URL 查询参数 | DNR(transform)|
| R7 | **Modify Request Body** | 修改请求 payload | interceptor.js |
| R8 | **Replace String** | 替换 URL 中的字符串片段(host/path 切换) | DNR |
| R9 | **Delay / Throttle** | 延迟或限速请求 | interceptor.js |
| R10 | **User-Agent override** | 覆盖 UA(本质是特殊 header) | DNR |

### 2.3 通用匹配条件(所有规则共用)

- URL 匹配方式:`Contains` / `Equals` / `Matches(正则)` / `Wildcard`
- 资源类型过滤:`xmlhttprequest` / `script` / `stylesheet` / `image` / `main_frame` / `sub_frame` 等
- 请求方法过滤:GET / POST / PUT / DELETE / ...
- 多条件 AND 组合

---

## 3. 技术架构

### 3.1 双层拦截模型(核心设计)

MV3 移除了阻塞式 `webRequest`,因此拦截能力被拆成两层,Agent 必须理解这一点:

```
┌─────────────────────────────────────────────────────────┐
│                     用户配置规则(UI)                      │
│                  popup / options 页面                      │
└──────────────────────────┬──────────────────────────────┘
                           │ chrome.storage
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Service Worker(background.js)                │
│  · 监听 storage 变化,把规则分流到两条路径                  │
│  · 路径A → 编译成 DNR 动态规则并下发                        │
│  · 路径B → 把页面层规则推送给 content script               │
└───────────┬─────────────────────────────┬────────────────┘
            │                             │
   路径A:网络层                    路径B:页面层
            ▼                             ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│ declarativeNetRequest │    │ content-script(ISOLATED)     │
│ · 重定向 R1           │    │   ↓ 注入                       │
│ · 拦截   R2           │    │ interceptor.js(MAIN world)   │
│ · 改头   R3 R10       │    │ · 改响应体 R4                  │
│ · 改query R6          │    │ · 改请求体 R7                  │
│ · 替换   R8           │    │ · 延迟    R9                   │
└──────────────────────┘    │ · 覆盖 fetch / XHR             │
                             └──────────────────────────────┘
```

**分流规则**:能用 DNR 干净完成的(头、重定向、拦截、query)走 DNR;涉及**响应体内容 / 请求体内容 / 时序**的走 `interceptor.js`。

### 3.2 各组件职责

- **`background.js`(Service Worker)**:规则的"大脑"。读 storage → 把规则拆成 DNR 规则集和页面规则集 → 通过 `chrome.declarativeNetRequest.updateDynamicRules` 下发网络层规则;通过消息把页面规则缓存,供 content script 拉取。维护规则 ID 分配,处理启用/禁用。
- **`content-script.js`(ISOLATED world)**:作为页面与扩展之间的桥。负责把 `interceptor.js` 注入 MAIN world(`world: "MAIN"` 或 `<script>` 注入),把适用于当前页面的页面层规则传给 interceptor,接收 interceptor 上报的拦截日志并转发给 background。
- **`interceptor.js`(MAIN world,已存在)**:覆盖 `fetch`/`XHR`,按规则改响应体/请求体/延迟。**不直接读 chrome API**(MAIN world 拿不到),只通过约定的通道收发数据。
- **`popup`**:工具栏弹窗。规则列表 + 一键启停 + 总开关 + 进入完整编辑页。
- **`options`(规则编辑器)**:完整的规则 CRUD 界面、导入导出、按 URL 测试匹配。
- **`devtools`(可选,扩展阶段)**:Network 面板,实时显示被拦截/修改的请求日志。

---

## 4. 目录结构

```
/
├── PLAN.md                  ← 本文件
├── manifest.json
├── package.json
├── vite.config.ts           ← 构建(推荐 Vite + @crxjs/vite-plugin)
├── src/
│   ├── background/
│   │   ├── index.ts         ← service worker 入口
│   │   ├── dnr-compiler.ts   ← 规则 → DNR 规则编译器
│   │   └── rule-router.ts    ← 规则分流(DNR vs 页面层)
│   ├── content/
│   │   └── content-script.ts ← 注入 interceptor + 桥接
│   ├── injected/
│   │   └── interceptor.js    ← 【已存在】页面层拦截核心,放这里
│   ├── popup/
│   │   ├── index.html
│   │   └── Popup.tsx
│   ├── options/
│   │   ├── index.html
│   │   └── Options.tsx       ← 规则编辑器
│   ├── devtools/            ← 可选
│   ├── shared/
│   │   ├── types.ts         ← Rule 数据模型(见第 5 节)
│   │   ├── storage.ts       ← chrome.storage 封装
│   │   ├── matcher.ts       ← URL 匹配逻辑
│   │   └── messaging.ts     ← 消息协议常量与封装
│   └── assets/icons/
├── tests/
│   ├── unit/                ← matcher / dnr-compiler 单测
│   └── e2e/                 ← Puppeteer 加载扩展跑端到端
└── dist/                    ← 构建产物
```

> 技术选型建议(非强制):**TypeScript + Vite + @crxjs/vite-plugin + React**。UI 框架可用任意,但请保持 popup/options 轻量。若团队偏好原生 JS,可去掉 React,但务必保留 TS 类型以约束规则模型。

---

## 5. 核心数据模型

所有规则统一存储在 `chrome.storage.local`,结构如下(TypeScript):

```typescript
type RuleType =
  | 'redirect' | 'block' | 'modifyHeaders' | 'modifyResponse'
  | 'insertScript' | 'modifyQueryParams' | 'modifyRequestBody'
  | 'replace' | 'delay' | 'userAgent';

interface MatchCondition {
  urlOperator: 'contains' | 'equals' | 'matches' | 'wildcard';
  urlValue: string;
  resourceTypes?: string[];   // xmlhttprequest, script, ...
  methods?: string[];         // GET, POST, ...
}

interface Rule {
  id: string;                 // uuid
  name: string;
  type: RuleType;
  enabled: boolean;
  condition: MatchCondition;
  action: RuleAction;         // 按 type 区分的判别联合,见下
  createdAt: number;
  updatedAt: number;
}

// action 是按 type 区分的 discriminated union,例如:
type RuleAction =
  | { type: 'redirect'; redirectUrl: string }
  | { type: 'block' }
  | { type: 'modifyHeaders'; request?: HeaderOp[]; response?: HeaderOp[] }
  | { type: 'modifyResponse'; statusCode?: number; body: string; bodyType: 'static' | 'jsFunction' }
  | { type: 'insertScript'; code: string; lang: 'js' | 'css'; runAt: 'document_start' | 'document_end' }
  | { type: 'delay'; ms: number }
  // ... 其余类型同理

interface HeaderOp { op: 'set' | 'remove' | 'append'; header: string; value?: string; }

interface GlobalState {
  masterEnabled: boolean;     // 总开关
  rules: Rule[];
}
```

> 设计要点:`action` 用判别联合,UI 表单和编译器都按 `type` 分支处理。新增规则类型 = 加一个分支,不破坏旧数据。导入导出直接序列化 `GlobalState`,保证与 Requestly 风格的"分享规则"兼容(可后续做格式适配)。

---

## 6. 对接契约:background ⇄ content ⇄ interceptor.js

> ⚠️ 这是**预设契约**。第 0 阶段读完真实 `interceptor.js` 后:**通信机制**(用 postMessage 还是 CustomEvent、握手时序)以它实际实现为准来对齐;但**命名空间和消息名**统一改成下面的项目自有标识(把 Requestly 残留替换掉),content-script 与 interceptor 两边必须一致。下面用占位 `NETMOD`(请换成你的项目缩写)。

页面层规则(R4/R7/R9)流转链路:

```
background ──(chrome.runtime message)──▶ content-script
content-script ──(window.postMessage)──▶ interceptor.js (MAIN world)
interceptor.js ──(window.postMessage)──▶ content-script ──(message)──▶ background(日志)
```

约定的消息格式(content → interceptor):

```js
window.postMessage({
  source: 'NETMOD_INTERCEPTOR',        // ← 项目自有命名空间,替换 interceptor 里原 Requestly 的
  type: 'RULES_UPDATE',
  payload: { rules: PageLevelRule[] } // 仅页面层规则,已按当前 origin 过滤
}, '*');
```

interceptor → content(上报命中):

```js
window.postMessage({
  source: 'NETMOD_INTERCEPTOR',
  type: 'REQUEST_INTERCEPTED',
  payload: { ruleId, url, method, modified: true, ts }
}, '*');
```

`interceptor.js` 需要做到:
- 启动时向 content 请求一次当前规则(冷启动),之后被动接收 `RULES_UPDATE`。
- 覆盖 `window.fetch` 与 `XMLHttpRequest`,在请求/响应链路上按规则匹配与改写。
- 自身**幂等**:多次注入不重复包裹(用标志位判断 `window.__NETMOD_INSTALLED__`)。

如果现有 `interceptor.js` 用的是别的通道(如 `CustomEvent` 或全局变量),**改 content-script 去适配它的机制**,但把里面的 Requestly 命名一律换成上面的项目命名,并据实更新本节。

### 6.1 清理 interceptor.js 中的 Requestly 残留(改造清单)

第 0 阶段登记、阶段 4 执行。逐项把左边的 Requestly 标识替换成右边的项目标识,**全文件统一、不留遗漏**(残留一处就可能导致通道对不上或暴露来源):

| 类别 | Requestly 残留(示例,以实际为准) | 替换为 |
|---|---|---|
| 全局安装标志 | `window.__REQUESTLY_INITIALIZED__` 等 | `window.__NETMOD_INSTALLED__` |
| 消息 source | `'requestly'` / `'RQ'` | `'NETMOD_INTERCEPTOR'` |
| 消息/事件 type 名 | `rq:rules`、`RQ_RULE_UPDATED` 等 | `RULES_UPDATE` / `REQUEST_INTERCEPTED` |
| 规则字段名 | Requestly 自有 schema 字段 | 映射到第 5 节 `Rule`/`RuleAction` |
| 日志前缀/品牌 | `[Requestly]`、字符串含 "Requestly" | 项目名,或移除 |
| 远程上报/遥测/埋点 | 上报到 requestly.io 等的代码 | **直接删除**(本插件不外发数据) |
| 硬编码 URL/资源 | 指向 Requestly 域名的引用 | 移除或换成本地资源 |

执行要点:
- 用全局搜索(`grep -ri "requestly\|\brq\b\|RQ_"`)确保无遗漏,改完再搜一遍应为空。
- **只换标识、不改拦截逻辑**:fetch/XHR 的覆盖与改写算法保持原样,降低引入 bug 的风险。
- 改完后,content-script 与 interceptor 两端的 `source`/`type`/全局标志必须字符串完全一致,否则静默失效。
- 验证:注入后页面 console 无任何 "Requestly" 字样;通道握手成功(冷启动能收到规则)。

---

## 7. manifest.json 配置要点

```jsonc
{
  "manifest_version": 3,
  "name": "...",
  "version": "0.1.0",
  "permissions": [
    "declarativeNetRequest",      // 网络层规则
    "declarativeNetRequestFeedback", // 调试时看命中(可选)
    "storage",
    "scripting",                  // 注入 interceptor / 用户脚本
    "tabs"
  ],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html" },
  "options_page": "options.html",
  "web_accessible_resources": [{
    "resources": ["interceptor.js"],   // 必须可被页面加载
    "matches": ["<all_urls>"]
  }],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
    "run_at": "document_start"         // 越早越好,抢在页面请求前装好 interceptor
  }]
}
```

关键陷阱:
- **`run_at: document_start`** + 在 content-script 里**同步注入 interceptor.js 到 MAIN world**,否则页面早期请求拦不到。优先用 `chrome.scripting.registerContentScripts` 注册 `world: "MAIN"` 脚本,可比 DOM 注入更早执行。
- DNR 改响应头需要 `responseHeaders` 动作类型,Chrome 已支持;改响应**体**不在 DNR 能力内,必须走 interceptor。
- DNR 动态规则有数量上限(`MAX_NUMBER_OF_DYNAMIC_RULES`),大量规则需注意。

---

## 8. 开发阶段与里程碑

> 每阶段产出可运行/可验证的增量。完成后跑该阶段"验收标准"。

### 阶段 1 — 骨架与构建(0.5d)
- 初始化 TS + Vite + crxjs 工程,能 `npm run build` 出 `dist/` 并在 `chrome://extensions` 以"加载已解压"装上。
- 空的 background / popup / options / content-script 跑通,console 有各自启动日志。
- **验收**:扩展能装载,四个上下文无报错,popup 能打开。

### 阶段 2 — 数据模型与存储(0.5d)
- 实现第 5 节类型、`storage.ts`、`matcher.ts`(含 4 种 URL 匹配 + 资源/方法过滤)。
- `matcher.ts` 单元测试覆盖 contains/equals/regex/wildcard 边界。
- **验收**:matcher 单测全绿;能在 options 里手写一条规则存进 storage 并读回。

### 阶段 3 — DNR 网络层(R1/R2/R3)(1.5d)
- `dnr-compiler.ts`:把 `redirect`/`block`/`modifyHeaders` 规则编译为 DNR 规则。
- `background` 监听 storage 变化 → 重新编译 → `updateDynamicRules`(先清旧增新)。
- **验收**:配一条重定向规则,访问命中 URL 真实跳转;配 block 规则请求被拦;配改头规则用 DevTools Network 能看到头被改。总开关能整体失效。

### 阶段 4 — 清理 interceptor 残留 + 页面注入对接(R4)(2.5d)
- **先按第 6.1 节清单清理 `interceptor.js` 的 Requestly 残留**:统一命名空间/消息名/全局标志,删除遥测与外发上报,移除品牌字样。改完 `grep -ri "requestly"` 应为空。
- content-script 在 `document_start` 注入清理后的 `interceptor.js` 到 MAIN world,建立第 6 节双向通道(两端标识一致)。
- background 把页面层规则按 origin 过滤后下发;interceptor 实现 Mock/改响应体/改 status。
- interceptor 命中后上报,background 收集日志。
- **验收**:① 页面 console 无 "Requestly" 字样、无对外上报;② 配一条 modifyResponse 规则把某 API 返回替换成自定义 JSON,页面实际拿到改写后的响应;③ 命中日志可见;④ 幂等性(刷新/SPA 路由不重复包裹)通过。

### 阶段 5 — 规则编辑器 UI(1.5d)
- options 页:规则列表(增删改、启停、拖拽排序)、按 type 动态渲染 action 表单、URL 匹配测试器(输入 URL 看是否命中)。
- popup:总开关 + 规则快速启停 + 跳转 options。
- **验收**:全程通过 UI 完成 R1–R4 规则的创建并生效,无需手改 storage。

### 阶段 6 — 注入脚本 R5 与导入导出(1d)
- R5:注入自定义 JS/CSS(注意 MV3 下用户脚本需走 `chrome.scripting` / `userScripts` API,留意权限与 CSP)。
- 导入/导出 `GlobalState` 为 JSON 文件。
- **验收**:注入一段改页面背景色的脚本生效;导出后清空再导入,规则完整还原。

### 阶段 7 — 扩展规则(R6–R10)(2d,可并行)
- 按第 2.2 节逐个实现,query/replace/UA 走 DNR,requestBody/delay 走 interceptor。
- **验收**:每条规则有对应手动测试用例通过。

### 阶段 8 — DevTools 面板与打磨(可选,1.5d)
- 自定义 DevTools 面板,实时表格展示被拦截/修改的请求。
- 图标、空状态、错误提示、暗色模式等打磨。

### 阶段 9 — 测试与发布准备(1d)
- Puppeteer e2e:加载扩展 → 配规则 → 访问目标页 → 断言效果。
- 写 README(安装、使用、规则说明)。
- 打包 zip,自查 Chrome Web Store 政策(权限说明、隐私)。

---

## 9. 关键技术难点与对策

| 难点 | 对策 |
|---|---|
| MV3 无阻塞式 webRequest,改响应体只能页面层做 | 双层架构,响应体/请求体/时序全部交给 interceptor.js |
| content-script 拿不到页面 `fetch`,MAIN world 拿不到 chrome API | content(ISOLATED)做桥,interceptor(MAIN)做拦截,postMessage 通信 |
| 页面早期请求(document_start 前)漏拦 | 用 `registerContentScripts` 注册 MAIN world 脚本,尽早执行;接受极早期请求可能漏拦的现实 |
| DNR 动态规则数量/优先级冲突 | 编译器统一分配 ID 与 priority,规则变更全量重建而非增量打补丁 |
| interceptor 重复注入 | 全局安装标志位,幂等包裹 |
| 跨域 / CSP 限制注入脚本 | R5 用 scripting API 而非内联 `<script>`;文档说明受 CSP 严格站点限制 |
| SPA 路由切换规则不更新 | content 监听规则变化并实时 postMessage;interceptor 始终用最新规则快照 |

---

## 10. 验收标准(整体 Definition of Done)

- [ ] 扩展可在最新稳定版 Chrome 加载,无控制台报错。
- [ ] R1–R5(MVP)全部通过手动测试与对应 e2e 用例。
- [ ] 所有规则可仅通过 UI 完成 CRUD 与启停,总开关一键全停。
- [ ] 规则导入导出可往返还原。
- [ ] `matcher` 与 `dnr-compiler` 有单元测试,核心分支覆盖。
- [ ] 复用了既有 `interceptor.js` 的拦截逻辑,且已按 6.1 清除全部 Requestly 残留(`grep -ri "requestly"` 为空,无对外上报)。
- [ ] README 完整,可据此安装与使用。

---

## 11. 给 Agent 的工作约定

1. **小步提交**:每个阶段(甚至每条规则类型)独立提交,提交信息说明做了什么、怎么验证的。
2. **先测后扩**:每实现一种规则类型,先写/跑它的验证用例,通过再做下一个。
3. **不臆测 interceptor 接口**:任何与 `interceptor.js` 的交互,先读源码确认,再写代码,并据实更新第 6 节。
4. **权限最小化**:manifest 只申请实际用到的权限;每加一个权限在 PR 里说明原因。
5. **遇到 MV3 限制别硬刚**:若某能力 MV3 确实做不到,记录在文档"已知限制"里,给出降级方案,不要用违规手段绕过。
6. **保持文档同步**:架构/契约一旦与代码不一致,先更新 PLAN.md 再继续。

---

## 12. 后续/可选(超出 MVP)

- GraphQL 请求专项匹配与改写
- 规则分组 / 工作区
- 规则分享链接(对标 Requestly 的 share)
- Postman / HAR 导入
- 会话录制与回放
