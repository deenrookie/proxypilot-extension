/**
 * Requestly 页面注入客户端脚本（可读版）
 * ------------------------------------------------------------------
 * 作用：在页面上下文中劫持 XMLHttpRequest 和 fetch，根据扩展下发的
 *       规则（重定向 / 改写请求体 / 改写响应 / 延迟等）对网络请求做拦截处理。
 *
 * 说明：本文件是对压缩混淆版的还原，变量/函数已重命名并加注释，
 *       运行逻辑与原始代码保持一致。
 */
!function () {
  "use strict";

  // 页面卸载时回传共享状态用的消息 action
  const ACTION_CACHE_SHARED_STATE = "cacheSharedState";
  // 注入到页面 window 上的全局命名空间 key，扩展通过它下发规则与共享状态
  const RQ_NAMESPACE = "__REQUESTLY__";

  // ============================ 枚举常量 ============================

  // 规则对象类型：分组 / 单条规则
  const RuleObjectType = {
    GROUP: "group",
    RULE: "rule",
  };

  // 规则启用状态
  const RuleStatus = {
    ACTIVE: "Active",
    INACTIVE: "Inactive",
  };

  // 规则类型
  const RuleType = {
    REDIRECT: "Redirect",     // 重定向
    CANCEL: "Cancel",         // 取消请求
    REPLACE: "Replace",       // 替换 URL 子串
    HEADERS: "Headers",       // 修改 Header
    USERAGENT: "UserAgent",   // 修改 UA
    SCRIPT: "Script",         // 注入脚本
    QUERYPARAM: "QueryParam", // 修改查询参数
    RESPONSE: "Response",     // 改写响应
    REQUEST: "Request",       // 改写请求体
    DELAY: "Delay",           // 延迟请求
  };

  // URL 匹配时取值的部位
  const SourceKey = {
    URL: "Url",
    HOST: "host",
    PATH: "path",
  };

  // URL 匹配运算符
  const SourceOperator = {
    EQUALS: "Equals",                       // 完全相等
    CONTAINS: "Contains",                   // 包含
    MATCHES: "Matches",                     // 正则匹配
    WILDCARD_MATCHES: "Wildcard_Matches",   // 通配符匹配
  };

  // 规则附加过滤条件的 key
  const SourceFilterKey = {
    PAGE_DOMAINS: "pageDomains",       // 发起页面域名
    REQUEST_METHOD: "requestMethod",   // 请求方法
    RESOURCE_TYPE: "resourceType",     // 资源类型
    REQUEST_PAYLOAD: "requestPayload", // 请求体内容
  };

  // 资源类型（与浏览器 webRequest 的 resourceType 对应）
  const ResourceType = {
    XHR: "xmlhttprequest",
    JS: "script",
    CSS: "stylesheet",
    Image: "image",
    Media: "media",
    Font: "font",
    WebSocket: "websocket",
    MainDocument: "main_frame",
    IFrameDocument: "sub_frame",
  };

  // HTTP 方法
  const RequestMethod = {
    GET: "GET",
    POST: "POST",
    PUT: "PUT",
    DELETE: "DELETE",
    PATCH: "PATCH",
    OPTIONS: "OPTIONS",
    CONNECT: "CONNECT",
    HEAD: "HEAD",
  };

  // 脚本注入的页面范围
  const ScriptPageScope = {
    CUSTOM: "custom",
    ALL_PAGES: "allPages",
  };

  // 录制配置 key
  const StorageConfigKey = {
    SESSION_RECORDING_CONFIG: "sessionRecordingConfig",
  };

  // 注入脚本语言类型
  const ScriptLang = {
    JS: "js",
    CSS: "css",
  };

  // 脚本来源类型：外链 / 内联代码
  const ScriptValueType = {
    URL: "url",
    CODE: "code",
  };

  // 规则变更类型
  const ChangeType = {
    MODIFIED: 0,
    CREATED: 1,
    DELETED: 2,
  };

  // 扩展启用状态 key
  const ExtensionStateKey = {
    IS_EXTENSION_ENABLED: "isExtensionEnabled",
  };

  // ============================ 环境配置 ============================

  const CONFIG = {
    browser: "chrome",
    storageType: "local",
    contextMenuContexts: ["browser_action"],
    env: "prod",
    WEB_URL: "https://app.requestly.io",
    SESSIONS_URL: "https://app.requestly.io/sessions",
    OTHER_WEB_URLS: ["https://app.requestly.com", "https://requestly.com"],
    LANDING_PAGE_BASE_URL: "https://requestly.com",
    logLevel: "info",
  };

  // ============================ URL 匹配相关 ============================

  /**
   * 判断给定 URL 是否属于 Requestly 自身的页面（这些请求不应被规则处理）。
   */
  const isInternalRequestlyUrl = (url) => {
    const internalConditions = [
      ...[...new Set([CONFIG.WEB_URL, ...CONFIG.OTHER_WEB_URLS])].map((webUrl) => ({
        key: SourceKey.URL,
        operator: SourceOperator.CONTAINS,
        value: webUrl,
      })),
      { key: SourceKey.URL, operator: SourceOperator.CONTAINS, value: "__rq" },
    ];
    return internalConditions.some((condition) => matchUrlCondition(condition, url));
  };

  /**
   * 把形如 "/pattern/flags" 的字符串解析为 RegExp 对象，解析失败返回 null。
   */
  const parseRegexString = (regexStr) => {
    const matched = regexStr.match(new RegExp("^/(.+)/(|i|g|ig|gi)$"));
    if (!matched) return null;
    try {
      return new RegExp(matched[1], matched[2]);
    } catch (e) {
      return null;
    }
  };

  /**
   * 用正则模式（字符串形式）测试目标字符串是否匹配。
   * 若 pattern 未被斜杠包裹，会自动补成 "/pattern/"。
   */
  const testRegexPattern = (pattern, target) => {
    if (!pattern.startsWith("/")) pattern = `/${pattern}/`;
    const regex = parseRegexString(pattern);
    return regex?.test(target);
  };

  /**
   * 将通配符模式转换为等价的正则字符串。
   * 例如 "https://*.example.com/*" → "/^https:\/\/(.*)\.example\.com\/(.*)$/"
   */
  const wildcardToRegexString = (wildcard) =>
    "/^" + wildcard.replace(/([?.-])/g, "\\$1").replace(/(\*)/g, "(.*)") + "$/";

  /**
   * 判断单个 URL 条件是否命中目标 URL。
   * @param {{key, operator, value, isActive?}} condition
   * @param {string} url
   */
  const matchUrlCondition = (condition, url) => {
    // 根据 condition.key 从 URL 中取出要比较的部分（整段 / host / path）
    const subject = ((targetUrl, key) => {
      let parsed = null;
      try {
        parsed = new URL(targetUrl);
      } catch (e) {}
      if (parsed) {
        switch (key) {
          case SourceKey.URL:
            return targetUrl;
          case SourceKey.HOST:
            return parsed.host;
          case SourceKey.PATH:
            return parsed.pathname;
        }
      }
    })(url, condition.key);

    const value = condition.value;

    if (!(condition.isActive ?? true)) return false; // 条件被禁用
    if (!subject) return false;

    switch (condition.operator) {
      case SourceOperator.EQUALS:
        if (value === subject) return true;
        break;
      case SourceOperator.CONTAINS:
        if (subject.indexOf(value) !== -1) return true;
        break;
      case SourceOperator.MATCHES:
        return testRegexPattern(value, subject);
      case SourceOperator.WILDCARD_MATCHES:
        return ((wildcard, target) => {
          const regexStr = wildcardToRegexString(wildcard);
          return testRegexPattern(regexStr, target);
        })(value, subject);
    }
    return false;
  };

  /**
   * 判断规则的附加过滤条件（页面域名 / 方法 / 资源类型 / 请求体）是否全部满足。
   * @param {object|object[]} filters
   * @param {object} requestDetails
   */
  const matchFilters = function (filters, requestDetails) {
    if (!filters || !requestDetails || (Array.isArray(filters) && filters.length === 0)) {
      return true; // 无过滤条件 → 直接通过
    }
    const filter = Array.isArray(filters) ? filters[0] : filters;

    return Object.entries(filter).every(([key, expected]) => {
      switch (key) {
        case SourceFilterKey.PAGE_DOMAINS:
          return expected.some((domain) => {
            const parsed = ((u) => {
              try {
                return new URL(u);
              } catch (e) {
                return null;
              }
            })(requestDetails.initiator);
            return (parsed?.hostname || "").endsWith(domain);
          });
        case SourceFilterKey.REQUEST_METHOD:
          return expected.includes(requestDetails.method);
        case SourceFilterKey.RESOURCE_TYPE:
          return expected.includes(requestDetails.type);
        case SourceFilterKey.REQUEST_PAYLOAD:
          return matchRequestPayload(expected, requestDetails.requestData);
        default:
          return true;
      }
    });
  };

  /**
   * 判断请求体是否满足 payload 过滤条件。
   * payload 规则形如 { key: "a.b.c", value, operator: "Equals"|"Contains" }
   */
  const matchRequestPayload = (payloadRule, requestData) => {
    if (!payloadRule) return true;
    if (typeof payloadRule === "object" && Object.keys(payloadRule).length === 0) return true;
    if (!requestData || typeof requestData !== "object") return false;
    if (Object.keys(requestData).length === 0) return false;

    const path = payloadRule?.key;
    const expectedValue = payloadRule?.value;

    if (path && expectedValue !== undefined) {
      const actualRaw = getValueByPath(requestData, path);
      const operator = payloadRule?.operator;
      let actual = "";
      if (typeof actualRaw !== "object") actual = actualRaw?.toString();

      if (!operator || operator === "Equals") return actual === expectedValue;
      if (operator === "Contains") return actual?.includes(expectedValue);
    }
    return false;
  };

  /**
   * 综合判断一条规则是否命中当前请求，并计算重定向/替换后的目标 URL。
   * @returns {{isApplied:boolean, matchedPair?, destinationUrl?}}
   */
  const getRuleMatch = function (rule, requestDetails) {
    // Requestly 自身页面的请求一律跳过
    if (isInternalRequestlyUrl(requestDetails.initiator) || isInternalRequestlyUrl(requestDetails.url)) {
      return {};
    }
    const matchedPair = rule?.pairs?.find(
      (pair) =>
        matchUrlCondition(pair.source, requestDetails.url) &&
        matchFilters(pair.source.filters, requestDetails)
    );
    if (!matchedPair) return { isApplied: false };

    return {
      isApplied: true,
      matchedPair,
      destinationUrl: getDestinationUrl(matchedPair, rule.ruleType, requestDetails),
    };
  };

  /**
   * 将目标字符串中的 $1、$2…… 占位符替换为正则捕获组的值。
   */
  const substituteCaptureGroups = function (template, captureGroups) {
    captureGroups.forEach((group, index) => {
      if (index !== 0) {
        group = group || "";
        template = template.replace(new RegExp("[$]" + index, "g"), group);
      }
    });
    return template;
  };

  /**
   * 根据规则类型计算最终的目标 URL（仅 REPLACE / REDIRECT 有意义）。
   */
  const getDestinationUrl = (pair, ruleType, requestDetails) => {
    switch (ruleType) {
      case RuleType.REPLACE: {
        const replaced = requestDetails.url.replace(pair.from, pair.to);
        return replaced === requestDetails.url ? null : replaced;
      }
      case RuleType.REDIRECT: {
        if (pair.source.operator === SourceOperator.MATCHES) {
          const match = parseRegexString(pair.source.value)?.exec(requestDetails.url);
          return match ? substituteCaptureGroups(pair.destination, match) : pair.destination;
        }
        if (pair.source.operator === SourceOperator.WILDCARD_MATCHES) {
          const regexStr = wildcardToRegexString(pair.source.value);
          const match = parseRegexString(regexStr)?.exec(requestDetails.url);
          return match ? substituteCaptureGroups(pair.destination, match) : pair.destination;
        }
        return pair.destination;
      }
      default:
        return null;
    }
  };

  /**
   * 按点分路径（如 "a.b.c"）从对象中取值。
   */
  const getValueByPath = (obj, path) => {
    if (!path) return;
    const segments = path.split(".");
    try {
      for (let i = 0; i < segments.length - 1; i++) obj = obj[segments[i]];
      return obj[segments[segments.length - 1]];
    } catch (e) {}
  };

  // ============================ 用户脚本执行 ============================

  let reloadWarningShown = false;

  /**
   * 编译用户自定义脚本（请求/响应改写函数）。
   * 编译失败时回退为「触发错误回调 + 提示刷新」的空操作。
   */
  const buildUserFunction = (code, ruleType) => {
    try {
      return compileUserFunction(code);
    } catch (e) {
      onErrorOccurred({ initiator: location.origin, url: location.href }).then(() => {
        if (!reloadWarningShown) {
          reloadWarningShown = true;
          console.log(
            `%cRequestly%c Please reload the page for ${ruleType} rule to take effect`,
            "color: #3c89e8; padding: 1px 5px; border-radius: 4px; border: 1px solid #91caff;",
            "color: red; font-style: italic"
          );
        }
      });
      return () => {};
    }
  };

  /**
   * 在带 $sharedState 上下文的环境中编译并返回用户函数。
   */
  const compileUserFunction = function (code) {
    const SHARED_STATE_VAR = "$sharedState";
    let sharedState;
    try {
      // 优先读取顶层窗口的共享状态（跨 iframe 共享）
      sharedState = window.top[RQ_NAMESPACE]?.sharedState ?? {};
    } catch (e) {
      sharedState = window[RQ_NAMESPACE]?.sharedState ?? {};
    }
    const { func, updatedSharedState } = new Function(
      `${SHARED_STATE_VAR}`,
      `return { func: ${code}, updatedSharedState: ${SHARED_STATE_VAR}}`
    )(sharedState);
    return func;
  };

  /**
   * 计算请求改写规则得到的新请求体。
   * - static：直接取配置值
   * - 否则：执行用户脚本生成
   * 非二进制对象会被 JSON 序列化。
   */
  const resolveRequestBody = (rule, requestContext) => {
    const request = rule.pairs[0].request;
    let result;
    result =
      request.type === "static"
        ? request.value
        : buildUserFunction(request.value, "request")(requestContext);

    const isBinaryOrPlainNonObject =
      typeof result !== "object" ||
      [Blob, ArrayBuffer, Object.getPrototypeOf(Uint8Array), DataView, FormData, URLSearchParams].some(
        (Ctor) => result instanceof Ctor
      );

    return isBinaryOrPlainNonObject ? result : JSON.stringify(result);
  };

  // ============================ 与内容脚本通信 ============================

  /**
   * 向内容脚本发送消息并等待其处理完成（最多 2 秒超时）。
   */
  const sendMessageToContentScript = async (payload, action) => {
    let listener;
    window.postMessage(
      { ...payload, action, source: "requestly:client" },
      window.location.href
    );
    const processedAction = `${action}:processed`;
    return Promise.race([
      new Promise((resolve) => setTimeout(resolve, 2000)),
      new Promise((resolve) => {
        listener = (event) => {
          if (event.data.action === processedAction) resolve();
        };
        window.addEventListener("message", listener);
      }),
    ]).finally(() => {
      window.removeEventListener("message", listener);
    });
  };

  // AJAX 请求发出前通知内容脚本（用于改 header 等）
  const onBeforeAjaxRequest = async (requestDetails) =>
    sendMessageToContentScript({ requestDetails }, "onBeforeAjaxRequest");

  // 请求出错时通知内容脚本
  const onErrorOccurred = async (requestDetails) =>
    sendMessageToContentScript({ requestDetails }, "onErrorOccurred");

  // ============================ 工具函数 ============================

  // 是否为 Promise（thenable）
  const isPromise = (val) =>
    !!val && (typeof val === "object" || typeof val === "function") && typeof val.then === "function";

  /**
   * 安全 JSON 解析。
   * @param {*} val
   * @param {boolean} emptyOnFail 解析失败时是否返回 {}（true）还是返回原值（false）
   */
  const safeJsonParse = (val, emptyOnFail) => {
    const fallback = emptyOnFail ? {} : val;
    if (typeof val !== "string") return fallback;
    try {
      return JSON.parse(val);
    } catch (e) {}
    return fallback;
  };

  // 字符串能否被解析成 JSON（解析结果不等于原值即表示是有效 JSON）
  const isJsonParseable = (val) => safeJsonParse(val) !== val;

  // 通知顶层窗口：某条响应规则已生效
  const notifyResponseRuleApplied = (detail) => {
    window.top.postMessage(
      {
        source: "requestly:client",
        action: "response_rule_applied",
        rule: detail.ruleDetails,
        requestDetails: detail.requestDetails,
      },
      window.location.href
    );
  };

  // 通知顶层窗口：某条请求规则已生效
  const notifyRequestRuleApplied = (detail) => {
    window.top.postMessage(
      {
        source: "requestly:client",
        action: "request_rule_applied",
        rule: detail.ruleDetails,
        requestDetails: detail.requestDetails,
      },
      window.location.href
    );
  };

  // 借助 <a> 元素把相对 URL 转成绝对 URL
  const toAbsoluteUrl = (url) => {
    const a = document.createElement("a");
    a.href = url;
    return a.href;
  };

  // 在已下发的规则集中查找命中当前请求的「请求改写」规则（取最后一条）
  const findMatchingRequestRule = (req) =>
    window[RQ_NAMESPACE]?.requestRules?.findLast(
      (rule) => getRuleMatch(rule, req)?.isApplied === true
    );

  // 查找命中的「响应改写」规则（取最后一条）
  const findMatchingResponseRule = (req) =>
    window[RQ_NAMESPACE]?.responseRules?.findLast(
      (rule) => getRuleMatch(rule, req)?.isApplied === true
    );

  // 查找命中的「延迟」规则，返回匹配到的 pair
  const findMatchingDelayRule = (req) => {
    if (!window[RQ_NAMESPACE]?.delayRules) return null;
    for (const rule of window[RQ_NAMESPACE]?.delayRules) {
      const { isApplied, matchedPair } = getRuleMatch(rule, req);
      return matchedPair;
    }
    return null;
  };

  // 该响应规则是否「无需真正发起请求即可返回」
  const shouldServeWithoutRequest = (rule) => {
    const response = rule.pairs[0].response;
    return response.type === "static" && response.serveWithoutRequest;
  };

  // content-type 是否为 JSON
  const isJsonContentType = (contentType) => !!contentType?.includes("application/json");

  // 简单延时
  const delay = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ============================ XMLHttpRequest 拦截器 ============================

  /**
   * 覆写全局 XMLHttpRequest，使其经过 Requestly 规则处理。
   * @param {boolean} debug 是否打印调试日志
   */
  const interceptXHR = (debug) => {
    // 强制设置 readyState 并派发 readystatechange 事件
    const setReadyState = (xhr, state) => {
      Object.defineProperty(xhr, "readyState", { writable: true });
      xhr.readyState = state;
      xhr.dispatchEvent(new CustomEvent("readystatechange"));
    };

    const NativeXHR = XMLHttpRequest;

    // 代理构造逻辑：facade 暴露给页面，internalXhr 实际发请求
    const setupProxy = function () {
      const facade = this;

      // 把内部 XHR 的进度事件转发到 facade
      const forwardEvent = (eventType, eventInit) => {
        if (debug) console.log("[RQ]", `on${eventType}`, eventInit);
        facade.dispatchEvent(
          new ProgressEvent(eventType, {
            lengthComputable: eventInit?.lengthComputable,
            loaded: eventInit?.loaded,
            total: eventInit?.total,
          })
        );
      };

      const syncReadyState = (state) => {
        setReadyState(facade, state);
      };

      const internalXhr = new NativeXHR;

      internalXhr.addEventListener(
        "readystatechange",
        async function () {
          if (debug)
            console.log("[RQ]", "onReadyStateChange", {
              state: this.readyState,
              status: this.status,
              response: this.response,
              xhr: this,
              url: this._requestURL,
            });

          if (!this.responseRule) return; // 没有命中响应规则则不接管

          const responseConfig = this.responseRule.pairs[0].response;

          if (this.readyState === this.HEADERS_RECEIVED) {
            // 用规则里的 status/statusText 覆盖 facade
            const status = parseInt(responseConfig.statusCode || this.status) || 200;
            const statusText = responseConfig.statusText || this.statusText;
            Object.defineProperties(facade, {
              status: { get: () => status },
              statusText: { get: () => statusText },
              getResponseHeader: { value: this.getResponseHeader.bind(this) },
              getAllResponseHeaders: { value: this.getAllResponseHeaders.bind(this) },
            });
            syncReadyState(this.HEADERS_RECEIVED);
          } else if (this.readyState === this.DONE) {
            const responseType = this.responseType;
            const contentType = this.getResponseHeader("content-type");
            let customResponse;

            if (responseConfig.type === "code") {
              // 动态响应：执行用户脚本，传入完整请求/响应上下文
              const context = {
                method: this._method,
                url: this._requestURL,
                requestHeaders: this._requestHeaders,
                requestData: safeJsonParse(this._requestData),
                responseType: contentType,
                response: this.response,
                responseJSON: safeJsonParse(this.response, true),
              };
              customResponse = buildUserFunction(responseConfig.value, "response")(context);
            } else {
              customResponse = responseConfig.value;
            }

            if (customResponse === undefined) return;
            if (isPromise(customResponse)) customResponse = await customResponse;

            if (debug)
              console.log("[RQ]", "Rule Applied - customResponse", {
                customResponse,
                responseType,
                contentType,
              });

            // 处理二进制/非文本 responseType
            const isBinaryResponseType = responseType && !["json", "text"].includes(responseType);
            if (responseConfig.type === "static" && isBinaryResponseType) {
              customResponse = this.response;
            }
            // json 类型需要序列化为字符串
            if (
              !isBinaryResponseType &&
              typeof customResponse === "object" &&
              !(customResponse instanceof Blob) &&
              (responseType === "json" || isJsonContentType(contentType))
            ) {
              customResponse = JSON.stringify(customResponse);
            }

            // 覆写 response
            Object.defineProperty(facade, "response", {
              get: function () {
                return responseConfig.type === "static" && responseType === "json"
                  ? typeof customResponse === "object"
                    ? customResponse
                    : safeJsonParse(customResponse)
                  : customResponse;
              },
            });
            // 覆写 responseText（仅 text/默认类型）
            if (responseType === "" || responseType === "text") {
              Object.defineProperty(facade, "responseText", {
                get: function () {
                  return customResponse;
                },
              });
            }

            const responseURL = this.responseURL;
            const responseXML = this.responseXML;
            Object.defineProperties(facade, {
              responseType: { get: function () { return responseType; } },
              responseURL: { get: function () { return responseURL; } },
              responseXML: { get: function () { return responseXML; } },
            });

            const requestDetails = {
              url: this._requestURL,
              method: this._method,
              type: "xmlhttprequest",
              timeStamp: Date.now(),
            };

            // 派发完成相关事件
            if (this._abort) {
              forwardEvent("abort");
              forwardEvent("loadend");
            } else {
              syncReadyState(this.DONE);
              forwardEvent("load");
              forwardEvent("loadend");
            }
            notifyResponseRuleApplied({ ruleDetails: this.responseRule, requestDetails });
          } else {
            syncReadyState(this.readyState);
          }
        }.bind(internalXhr),
        false
      );

      // 透传其余进度类事件
      internalXhr.addEventListener("abort", forwardEvent.bind(internalXhr, "abort"), false);
      internalXhr.addEventListener("error", forwardEvent.bind(internalXhr, "error"), false);
      internalXhr.addEventListener("timeout", forwardEvent.bind(internalXhr, "timeout"), false);
      internalXhr.addEventListener("loadstart", forwardEvent.bind(internalXhr, "loadstart"), false);
      internalXhr.addEventListener("progress", forwardEvent.bind(internalXhr, "progress"), false);

      // 同步 timeout 属性到内部 XHR
      const timeoutDescriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(this),
        "timeout"
      );
      if (timeoutDescriptor) {
        Object.defineProperty(facade, "timeout", {
          get: function () {
            return timeoutDescriptor.get.call(this);
          },
          set: function (val) {
            internalXhr.timeout = val;
            timeoutDescriptor.set.call(this, val);
          },
        });
      }

      // 同步 withCredentials 属性到内部 XHR
      const withCredentialsDescriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(this),
        "withCredentials"
      );
      if (withCredentialsDescriptor) {
        Object.defineProperty(facade, "withCredentials", {
          get: function () {
            return withCredentialsDescriptor.get.call(this);
          },
          set: function (val) {
            internalXhr.withCredentials = val;
            withCredentialsDescriptor.set.call(this, val);
          },
        });
      }

      this.rqProxyXhr = internalXhr;
    };

    // 用代理构造函数替换全局 XMLHttpRequest
    XMLHttpRequest = function () {
      const facade = new NativeXHR;
      setupProxy.call(facade);
      return facade;
    };
    XMLHttpRequest.prototype = NativeXHR.prototype;
    // 拷贝静态属性（UNSENT/OPENED 等常量）
    Object.entries(NativeXHR).map(([key, val]) => {
      XMLHttpRequest[key] = val;
    });

    // ---- 劫持 open：记录方法、URL、是否异步 ----
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, async = true) {
      nativeOpen.apply(this, arguments);
      try {
        this.rqProxyXhr._method = method;
        this.rqProxyXhr._requestURL = toAbsoluteUrl(url);
        this.rqProxyXhr._async = async;
        nativeOpen.apply(this.rqProxyXhr, arguments);
      } catch (err) {
        if (debug) console.log("[rqProxyXhr.open] error", err);
      }
    };

    // ---- 劫持 abort ----
    const nativeAbort = XMLHttpRequest.prototype.abort;
    XMLHttpRequest.prototype.abort = function () {
      if (debug) console.log("abort called");
      nativeAbort.apply(this, arguments);
      try {
        this.rqProxyXhr._abort = true;
        nativeAbort.apply(this.rqProxyXhr, arguments);
      } catch (err) {
        if (debug) console.log("[rqProxyXhr.abort] error", err);
      }
    };

    // ---- 劫持 setRequestHeader：记录请求头 ----
    const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      nativeSetRequestHeader.apply(this, arguments);
      try {
        this.rqProxyXhr._requestHeaders = this.rqProxyXhr._requestHeaders || {};
        this.rqProxyXhr._requestHeaders[name] = value;
        nativeSetRequestHeader.apply(this.rqProxyXhr, arguments);
      } catch (err) {
        if (debug) console.log("[rqProxyXhr.setRequestHeader] error", err);
      }
    };

    // ---- 劫持 send：应用延迟/请求改写/响应改写规则 ----
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = async function (body) {
      try {
        // 同步请求不接管
        if (!this.rqProxyXhr._async) {
          if (debug) console.log("Async disabled");
          return nativeSend.call(this, body);
        }
        this.rqProxyXhr._requestData = body;

        const baseReq = {
          url: this.rqProxyXhr._requestURL,
          method: this.rqProxyXhr._method,
          type: "xmlhttprequest",
          initiator: location.origin,
        };

        // 1) 延迟规则
        const delayPair = findMatchingDelayRule(baseReq);
        if (delayPair) {
          if (debug) console.log("[xhrInterceptor] matchedDelayRulePair", { matchedDelayRulePair: delayPair });
          await delay(delayPair.delay);
        }

        // 2) 请求体改写规则
        const requestRule = findMatchingRequestRule({ ...baseReq, requestData: safeJsonParse(body) });
        if (requestRule) {
          if (debug) console.log("[xhrInterceptor] matchedRequestRule", { requestRule });
          this.rqProxyXhr._requestData = resolveRequestBody(requestRule, {
            method: this.rqProxyXhr._method,
            url: this.rqProxyXhr._requestURL,
            body,
            bodyAsJson: safeJsonParse(body, true),
          });
          notifyRequestRuleApplied({
            ruleDetails: requestRule,
            requestDetails: {
              url: this.rqProxyXhr._requestURL,
              method: this.rqProxyXhr._method,
              type: "xmlhttprequest",
              timeStamp: Date.now(),
            },
          });
        }

        // 3) 发送前回调（改 header 等）
        await onBeforeAjaxRequest({
          url: this.rqProxyXhr._requestURL,
          method: this.rqProxyXhr._method,
          type: "xmlhttprequest",
          initiator: location.origin,
          requestHeaders: this.rqProxyXhr._requestHeaders ?? {},
        });

        // 4) 响应改写规则
        this.responseRule = findMatchingResponseRule({
          url: this.rqProxyXhr._requestURL,
          requestData: safeJsonParse(this.rqProxyXhr._requestData),
          method: this.rqProxyXhr._method,
        });
        this.rqProxyXhr.responseRule = this.responseRule;

        if (this.responseRule) {
          if (debug) console.log("[xhrInterceptor]", "send and response rule matched", this.responseRule);
          if (shouldServeWithoutRequest(this.responseRule)) {
            // 不真正发请求，直接模拟整个响应流程
            if (debug)
              console.log("[xhrInterceptor]", "send and response rule matched and serveWithoutRequest is true");
            ((xhr, responseValue) => {
              xhr.dispatchEvent(new ProgressEvent("loadstart"));
              const contentType = isJsonParseable(responseValue) ? "application/json" : "text/plain";
              xhr.getResponseHeader = (name) =>
                name.toLowerCase() === "content-type" ? contentType : null;
              setReadyState(xhr, xhr.HEADERS_RECEIVED);
              setReadyState(xhr, xhr.LOADING);
              setReadyState(xhr, xhr.DONE);
            })(this.rqProxyXhr, this.responseRule.pairs[0].response.value);
          } else {
            // 正常发请求，响应到达后再由 readystatechange 接管改写
            nativeSend.call(this.rqProxyXhr, this.rqProxyXhr._requestData);
          }
          return;
        }

        // 无响应规则：用（可能已改写的）请求体正常发送
        nativeSend.call(this, this.rqProxyXhr._requestData);
      } catch (err) {
        if (debug) console.log("[rqProxyXhr.send] error", err);
        nativeSend.call(this, body);
      }
    };
  };

  // ============================ 初始化 ============================

  (() => {
    // 读取调试开关
    let debug;
    try {
      debug = window && window.localStorage && localStorage.isDebugMode;
    } catch (e) {}

    // 安装 XHR 拦截器
    interceptXHR(debug);

    // 安装 fetch 拦截器
    ((debug) => {
      const nativeFetch = fetch;

      fetch = async (...args) => {
        const [resource, init = {}] = args;
        const callNativeFetch = () => nativeFetch(...args);

        try {
          // 统一封装成 Request 以便读取信息
          let request;
          request =
            resource instanceof Request
              ? resource.clone()
              : new Request(resource.toString(), init);

          const url = toAbsoluteUrl(request.url);
          const method = request.method;

          // 1) 延迟规则
          const delayPair = findMatchingDelayRule({
            url,
            method,
            type: "fetch",
            initiator: location.origin,
          });
          if (delayPair) await delay(delayPair.delay);

          // 仅非 GET/HEAD 请求才读取并匹配请求体
          const hasBody = !["GET", "HEAD"].includes(method);
          let requestBodyJson;
          if (hasBody) requestBodyJson = safeJsonParse(await request.clone().text());

          // 2) 请求体改写规则
          const requestRule =
            hasBody &&
            findMatchingRequestRule({
              url,
              method,
              type: "fetch",
              initiator: location.origin,
              requestData: requestBodyJson,
            });

          if (requestRule) {
            const originalBody = await request.text();
            const newBody =
              resolveRequestBody(requestRule, {
                method: request.method,
                url,
                body: originalBody,
                bodyAsJson: safeJsonParse(originalBody, true),
              }) || {};
            request = new Request(request.url, {
              method,
              body: newBody,
              headers: request.headers,
              referrer: request.referrer,
              referrerPolicy: request.referrerPolicy,
              mode: request.mode,
              credentials: request.credentials,
              cache: request.cache,
              redirect: request.redirect,
              integrity: request.integrity,
            });
            notifyRequestRuleApplied({
              ruleDetails: requestRule,
              requestDetails: { url, method: request.method, type: "fetch", timeStamp: Date.now() },
            });
          }

          // 3) 响应改写规则
          const responseRule = findMatchingResponseRule({ url, requestData: requestBodyJson, method });

          let responseHeaders;
          let fetchedResponse;
          let customResponse;

          if (responseRule && shouldServeWithoutRequest(responseRule)) {
            // 不发请求，直接构造响应头
            const contentType = isJsonParseable(responseRule.pairs[0].response.value)
              ? "application/json"
              : "text/plain";
            responseHeaders = new Headers({ "content-type": contentType });
          } else {
            try {
              // 发送前回调（改 header）
              const headerObj = {};
              if (request?.headers?.forEach) {
                request.headers.forEach((value, key) => {
                  headerObj[key] = value;
                });
              }
              await onBeforeAjaxRequest({
                url,
                method,
                type: "xmlhttprequest",
                initiator: location.origin,
                requestHeaders: headerObj,
              });

              // 实际发请求（改写过请求体则用新 request）
              fetchedResponse = requestRule ? await nativeFetch(request) : await callNativeFetch();
              // 无响应规则则直接返回真实响应
              if (!responseRule) return fetchedResponse;
              responseHeaders = fetchedResponse?.headers;
            } catch (err) {
              if (!responseRule) return Promise.reject(err);
            }
          }

          if (debug)
            console.log("RQ", "Inside the fetch block for url", {
              url,
              resource,
              initOptions: init,
              fetchedResponse,
            });

          const responseConfig = responseRule.pairs[0].response;

          if (responseConfig.type === "code") {
            // 动态响应：执行用户脚本
            let context = {
              method,
              url,
              requestHeaders:
                request.headers &&
                Array.from(request.headers).reduce((acc, [key, value]) => {
                  acc[key] = value;
                  return acc;
                }, {}),
              requestData: requestBodyJson,
            };
            if (fetchedResponse) {
              const text = await fetchedResponse.text();
              const contentType = fetchedResponse.headers.get("content-type");
              const responseJson = safeJsonParse(text, true);
              context = { ...context, responseType: contentType, response: text, responseJSON: responseJson };
            }
            customResponse = buildUserFunction(responseConfig.value, "response")(context);
            if (customResponse === undefined) return fetchedResponse;
            if (isPromise(customResponse)) customResponse = await customResponse;
            if (typeof customResponse === "object" && isJsonContentType(context?.responseType)) {
              customResponse = JSON.stringify(customResponse);
            }
          } else {
            customResponse = responseConfig.value;
          }

          notifyResponseRuleApplied({
            ruleDetails: responseRule,
            requestDetails: { url, method, type: "fetch", timeStamp: Date.now() },
          });

          // 构造并返回最终响应
          const status = parseInt(responseConfig.statusCode || fetchedResponse?.status) || 200;
          const isEmptyBodyStatus = [204, 205, 304].includes(status);
          return new Response(isEmptyBodyStatus ? null : new Blob([customResponse]), {
            status,
            statusText: responseConfig.statusText || fetchedResponse?.statusText,
            headers: responseHeaders,
          });
        } catch (err) {
          // 出错时回退到原生 fetch
          if (debug) console.log("[RQ.fetch] Error in fetch", err);
          return await callNativeFetch();
        }
      };
    })(debug);

    // 页面卸载时把共享状态回传给顶层窗口（仅顶层 frame 注册）
    if (window.top === window.self) {
      window.addEventListener("beforeunload", () => {
        window.top.postMessage(
          {
            source: "requestly:client",
            action: ACTION_CACHE_SHARED_STATE,
            sharedState: window[RQ_NAMESPACE]?.sharedState,
          },
          window.location.href
        );
      });
    }
  })();
}();