/**
 * ProxyPilot page-layer interceptor
 * ------------------------------------------------------------------
 * Runs in MAIN world. Overrides XMLHttpRequest and fetch so that
 * response-body / request-body / delay rules can be applied.
 *
 * Derived from Requestly open-source interceptor (AGPL-3.0).
 * Original copyright: Requestly contributors.
 * Modifications: Requestly identifiers replaced with ProxyPilot
 * identifiers; external-reporting code removed; postMessage listener
 * added for rule delivery; idempotency guard added.
 */
!function () {
  "use strict";

  // Idempotency: don't install twice (SPA navigation, repeated injection)
  if (window.__PROXYPILOT_INSTALLED__) return;
  window.__PROXYPILOT_INSTALLED__ = true;

  const PP_NAMESPACE = "__PROXYPILOT__";
  // Whether XHR/fetch hooks have been installed on this page
  let _hooksInstalled = false;

  // ============================ Enum constants ============================

  const RuleObjectType = {
    GROUP: "group",
    RULE: "rule",
  };

  const RuleStatus = {
    ACTIVE: "Active",
    INACTIVE: "Inactive",
  };

  const RuleType = {
    REDIRECT: "Redirect",
    CANCEL: "Cancel",
    REPLACE: "Replace",
    HEADERS: "Headers",
    USERAGENT: "UserAgent",
    SCRIPT: "Script",
    QUERYPARAM: "QueryParam",
    RESPONSE: "Response",
    REQUEST: "Request",
    DELAY: "Delay",
  };

  const SourceKey = {
    URL: "Url",
    HOST: "host",
    PATH: "path",
  };

  const SourceOperator = {
    EQUALS: "Equals",
    CONTAINS: "Contains",
    MATCHES: "Matches",
    WILDCARD_MATCHES: "Wildcard_Matches",
  };

  const SourceFilterKey = {
    PAGE_DOMAINS: "pageDomains",
    REQUEST_METHOD: "requestMethod",
    RESOURCE_TYPE: "resourceType",
    REQUEST_PAYLOAD: "requestPayload",
  };

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

  const ScriptPageScope = {
    CUSTOM: "custom",
    ALL_PAGES: "allPages",
  };

  const ScriptLang = {
    JS: "js",
    CSS: "css",
  };

  const ScriptValueType = {
    URL: "url",
    CODE: "code",
  };

  // ============================ URL matching ============================

  const parseRegexString = (regexStr) => {
    const matched = regexStr.match(new RegExp("^/(.+)/(|i|g|ig|gi)$"));
    if (!matched) return null;
    try {
      return new RegExp(matched[1], matched[2]);
    } catch (e) {
      return null;
    }
  };

  const testRegexPattern = (pattern, target) => {
    if (!pattern.startsWith("/")) pattern = `/${pattern}/`;
    const regex = parseRegexString(pattern);
    return regex?.test(target);
  };

  const wildcardToRegexString = (wildcard) =>
    "/^" + wildcard.replace(/([?.-])/g, "\\$1").replace(/(\*)/g, "(.*)") + "$/";

  const matchUrlCondition = (condition, url) => {
    const subject = ((targetUrl, key) => {
      let parsed = null;
      try { parsed = new URL(targetUrl); } catch (e) {}
      if (parsed) {
        switch (key) {
          case SourceKey.URL: return targetUrl;
          case SourceKey.HOST: return parsed.host;
          case SourceKey.PATH: return parsed.pathname;
        }
      }
    })(url, condition.key);

    const value = condition.value;
    if (!(condition.isActive ?? true)) return false;
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
        return testRegexPattern(wildcardToRegexString(value), subject);
    }
    return false;
  };

  const matchFilters = function (filters, requestDetails) {
    if (!filters || !requestDetails || (Array.isArray(filters) && filters.length === 0)) return true;
    const filter = Array.isArray(filters) ? filters[0] : filters;
    return Object.entries(filter).every(([key, expected]) => {
      switch (key) {
        case SourceFilterKey.PAGE_DOMAINS:
          return expected.some((domain) => {
            const parsed = (() => { try { return new URL(requestDetails.initiator); } catch (e) { return null; } })();
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

  const getRuleMatch = function (rule, requestDetails) {
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

  const substituteCaptureGroups = function (template, captureGroups) {
    captureGroups.forEach((group, index) => {
      if (index !== 0) {
        group = group || "";
        template = template.replace(new RegExp("[$]" + index, "g"), group);
      }
    });
    return template;
  };

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

  const getValueByPath = (obj, path) => {
    if (!path) return;
    const segments = path.split(".");
    try {
      for (let i = 0; i < segments.length - 1; i++) obj = obj[segments[i]];
      return obj[segments[segments.length - 1]];
    } catch (e) {}
  };

  // ============================ User function execution ============================

  let reloadWarningShown = false;

  const buildUserFunction = (code, ruleType) => {
    try {
      return compileUserFunction(code);
    } catch (e) {
      onErrorOccurred({ initiator: location.origin, url: location.href }).then(() => {
        if (!reloadWarningShown) {
          reloadWarningShown = true;
          console.log(
            `%cProxyPilot%c Please reload the page for ${ruleType} rule to take effect`,
            "color: #3b82f6; padding: 1px 5px; border-radius: 4px; border: 1px solid #93c5fd;",
            "color: red; font-style: italic"
          );
        }
      });
      return () => {};
    }
  };

  const compileUserFunction = function (code) {
    const SHARED_STATE_VAR = "$sharedState";
    let sharedState;
    try {
      sharedState = window.top[PP_NAMESPACE]?.sharedState ?? {};
    } catch (e) {
      sharedState = window[PP_NAMESPACE]?.sharedState ?? {};
    }
    const { func, updatedSharedState } = new Function(
      `${SHARED_STATE_VAR}`,
      `return { func: ${code}, updatedSharedState: ${SHARED_STATE_VAR}}`
    )(sharedState);
    return func;
  };

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

  // ============================ Messaging with content script ============================

  const sendMessageToContentScript = async (payload, action) => {
    let listener;
    window.postMessage(
      { ...payload, action, source: "PROXYPILOT_INTERCEPTOR" },
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

  const onBeforeAjaxRequest = async (requestDetails) =>
    sendMessageToContentScript({ requestDetails }, "onBeforeAjaxRequest");

  const onErrorOccurred = async (requestDetails) =>
    sendMessageToContentScript({ requestDetails }, "onErrorOccurred");

  // ============================ Utility functions ============================

  const isPromise = (val) =>
    !!val && (typeof val === "object" || typeof val === "function") && typeof val.then === "function";

  const safeJsonParse = (val, emptyOnFail) => {
    const fallback = emptyOnFail ? {} : val;
    if (typeof val !== "string") return fallback;
    try { return JSON.parse(val); } catch (e) {}
    return fallback;
  };

  const isJsonParseable = (val) => safeJsonParse(val) !== val;

  const notifyResponseRuleApplied = (detail) => {
    window.top.postMessage(
      {
        source: "PROXYPILOT_INTERCEPTOR",
        action: "response_rule_applied",
        rule: detail.ruleDetails,
        requestDetails: detail.requestDetails,
      },
      window.location.href
    );
  };

  const notifyRequestRuleApplied = (detail) => {
    window.top.postMessage(
      {
        source: "PROXYPILOT_INTERCEPTOR",
        action: "request_rule_applied",
        rule: detail.ruleDetails,
        requestDetails: detail.requestDetails,
      },
      window.location.href
    );
  };

  const toAbsoluteUrl = (url) => {
    const a = document.createElement("a");
    a.href = url;
    return a.href;
  };

  const findMatchingRequestRule = (req) =>
    window[PP_NAMESPACE]?.requestRules?.findLast(
      (rule) => getRuleMatch(rule, req)?.isApplied === true
    );

  const findMatchingResponseRule = (req) =>
    window[PP_NAMESPACE]?.responseRules?.findLast(
      (rule) => getRuleMatch(rule, req)?.isApplied === true
    );

  const findMatchingDelayRule = (req) => {
    if (!window[PP_NAMESPACE]?.delayRules) return null;
    for (const rule of window[PP_NAMESPACE]?.delayRules) {
      const { isApplied, matchedPair } = getRuleMatch(rule, req);
      if (isApplied) return matchedPair;
    }
    return null;
  };

  const shouldServeWithoutRequest = (rule) => {
    const response = rule.pairs[0].response;
    return response.type === "static" && response.serveWithoutRequest;
  };

  const isJsonContentType = (contentType) => !!contentType?.includes("application/json");

  const delay = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ============================ Response-body replace helper ============================

  /**
   * Apply a search-and-replace on rawText according to a "replace" response config.
   * Supports plain-string (replaces ALL occurrences) and regex with optional flags.
   * Returns the original text untouched if the pattern is an invalid regex.
   */
  const applyBodyReplace = (rawText, responseConfig) => {
    try {
      const pat = responseConfig.useRegex
        ? new RegExp(responseConfig.search, 'g')
        : new RegExp((responseConfig.search ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      return rawText.replace(pat, responseConfig.replacement ?? '');
    } catch (e) {
      return rawText; // invalid regex — pass through unchanged
    }
  };

  // ============================ XHR interceptor ============================

  const interceptXHR = (debug) => {
    const setReadyState = (xhr, state) => {
      Object.defineProperty(xhr, "readyState", { writable: true });
      xhr.readyState = state;
      xhr.dispatchEvent(new CustomEvent("readystatechange"));
    };

    const NativeXHR = XMLHttpRequest;

    const setupProxy = function () {
      const facade = this;

      const forwardEvent = (eventType, eventInit) => {
        if (debug) console.log("[PP]", `on${eventType}`, eventInit);
        facade.dispatchEvent(
          new ProgressEvent(eventType, {
            lengthComputable: eventInit?.lengthComputable,
            loaded: eventInit?.loaded,
            total: eventInit?.total,
          })
        );
      };

      const syncReadyState = (state) => { setReadyState(facade, state); };

      const internalXhr = new NativeXHR;

      internalXhr.addEventListener(
        "readystatechange",
        async function () {
          if (debug)
            console.log("[PP]", "onReadyStateChange", {
              state: this.readyState, status: this.status,
              response: this.response, xhr: this, url: this._requestURL,
            });

          if (!this.responseRule) return;

          const responseConfig = this.responseRule.pairs[0].response;

          if (this.readyState === this.HEADERS_RECEIVED) {
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
            } else if (responseConfig.type === "replace") {
              const rawText = typeof this.response === "string"
                ? this.response
                : (this.response != null ? JSON.stringify(this.response) : "");
              customResponse = applyBodyReplace(rawText, responseConfig);
            } else {
              customResponse = responseConfig.value;
            }

            if (customResponse === undefined) return;
            if (isPromise(customResponse)) customResponse = await customResponse;

            if (debug)
              console.log("[PP]", "Rule Applied - customResponse", { customResponse, responseType, contentType });

            const isBinaryResponseType = responseType && !["json", "text"].includes(responseType);
            if (responseConfig.type === "static" && isBinaryResponseType) {
              customResponse = this.response;
            }
            if (
              !isBinaryResponseType &&
              typeof customResponse === "object" &&
              !(customResponse instanceof Blob) &&
              (responseType === "json" || isJsonContentType(contentType))
            ) {
              customResponse = JSON.stringify(customResponse);
            }

            Object.defineProperty(facade, "response", {
              get: function () {
                return responseConfig.type === "static" && responseType === "json"
                  ? typeof customResponse === "object"
                    ? customResponse
                    : safeJsonParse(customResponse)
                  : customResponse;
              },
            });
            if (responseType === "" || responseType === "text") {
              Object.defineProperty(facade, "responseText", { get: function () { return customResponse; } });
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

      internalXhr.addEventListener("abort", forwardEvent.bind(internalXhr, "abort"), false);
      internalXhr.addEventListener("error", forwardEvent.bind(internalXhr, "error"), false);
      internalXhr.addEventListener("timeout", forwardEvent.bind(internalXhr, "timeout"), false);
      internalXhr.addEventListener("loadstart", forwardEvent.bind(internalXhr, "loadstart"), false);
      internalXhr.addEventListener("progress", forwardEvent.bind(internalXhr, "progress"), false);

      const timeoutDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), "timeout");
      if (timeoutDescriptor) {
        Object.defineProperty(facade, "timeout", {
          get: function () { return timeoutDescriptor.get.call(this); },
          set: function (val) {
            internalXhr.timeout = val;
            timeoutDescriptor.set.call(this, val);
          },
        });
      }

      const withCredentialsDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), "withCredentials");
      if (withCredentialsDescriptor) {
        Object.defineProperty(facade, "withCredentials", {
          get: function () { return withCredentialsDescriptor.get.call(this); },
          set: function (val) {
            internalXhr.withCredentials = val;
            withCredentialsDescriptor.set.call(this, val);
          },
        });
      }

      this._ppProxyXhr = internalXhr;
    };

    XMLHttpRequest = function () {
      const facade = new NativeXHR;
      setupProxy.call(facade);
      return facade;
    };
    XMLHttpRequest.prototype = NativeXHR.prototype;
    Object.entries(NativeXHR).map(([key, val]) => { XMLHttpRequest[key] = val; });

    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, async = true) {
      nativeOpen.apply(this, arguments);
      try {
        this._ppProxyXhr._method = method;
        this._ppProxyXhr._requestURL = toAbsoluteUrl(url);
        this._ppProxyXhr._async = async;
        nativeOpen.apply(this._ppProxyXhr, arguments);
      } catch (err) {
        if (debug) console.log("[PP._ppProxyXhr.open] error", err);
      }
    };

    const nativeAbort = XMLHttpRequest.prototype.abort;
    XMLHttpRequest.prototype.abort = function () {
      if (debug) console.log("[PP] abort called");
      nativeAbort.apply(this, arguments);
      try {
        this._ppProxyXhr._abort = true;
        nativeAbort.apply(this._ppProxyXhr, arguments);
      } catch (err) {
        if (debug) console.log("[PP._ppProxyXhr.abort] error", err);
      }
    };

    const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      nativeSetRequestHeader.apply(this, arguments);
      try {
        this._ppProxyXhr._requestHeaders = this._ppProxyXhr._requestHeaders || {};
        this._ppProxyXhr._requestHeaders[name] = value;
        nativeSetRequestHeader.apply(this._ppProxyXhr, arguments);
      } catch (err) {
        if (debug) console.log("[PP._ppProxyXhr.setRequestHeader] error", err);
      }
    };

    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = async function (body) {
      // Fast path: pass through untouched when disabled
      if (!window[PP_NAMESPACE]?.enabled) return nativeSend.call(this, body);
      try {
        if (!this._ppProxyXhr._async) {
          if (debug) console.log("[PP] Async disabled");
          return nativeSend.call(this, body);
        }
        this._ppProxyXhr._requestData = body;

        const baseReq = {
          url: this._ppProxyXhr._requestURL,
          method: this._ppProxyXhr._method,
          type: "xmlhttprequest",
          initiator: location.origin,
        };

        const delayPair = findMatchingDelayRule(baseReq);
        if (delayPair) {
          if (debug) console.log("[PP xhrInterceptor] matchedDelayRulePair", delayPair);
          await delay(delayPair.delay);
        }

        const requestRule = findMatchingRequestRule({ ...baseReq, requestData: safeJsonParse(body) });
        if (requestRule) {
          if (debug) console.log("[PP xhrInterceptor] matchedRequestRule", requestRule);
          this._ppProxyXhr._requestData = resolveRequestBody(requestRule, {
            method: this._ppProxyXhr._method,
            url: this._ppProxyXhr._requestURL,
            body,
            bodyAsJson: safeJsonParse(body, true),
          });
          notifyRequestRuleApplied({
            ruleDetails: requestRule,
            requestDetails: {
              url: this._ppProxyXhr._requestURL,
              method: this._ppProxyXhr._method,
              type: "xmlhttprequest",
              timeStamp: Date.now(),
            },
          });
        }

        await onBeforeAjaxRequest({
          url: this._ppProxyXhr._requestURL,
          method: this._ppProxyXhr._method,
          type: "xmlhttprequest",
          initiator: location.origin,
          requestHeaders: this._ppProxyXhr._requestHeaders ?? {},
        });

        this.responseRule = findMatchingResponseRule({
          url: this._ppProxyXhr._requestURL,
          requestData: safeJsonParse(this._ppProxyXhr._requestData),
          method: this._ppProxyXhr._method,
        });
        this._ppProxyXhr.responseRule = this.responseRule;

        if (this.responseRule) {
          if (debug) console.log("[PP xhrInterceptor] response rule matched", this.responseRule);
          if (shouldServeWithoutRequest(this.responseRule)) {
            if (debug) console.log("[PP xhrInterceptor] serveWithoutRequest=true");
            ((xhr, responseValue) => {
              xhr.dispatchEvent(new ProgressEvent("loadstart"));
              const contentType = isJsonParseable(responseValue) ? "application/json" : "text/plain";
              xhr.getResponseHeader = (name) =>
                name.toLowerCase() === "content-type" ? contentType : null;
              setReadyState(xhr, xhr.HEADERS_RECEIVED);
              setReadyState(xhr, xhr.LOADING);
              setReadyState(xhr, xhr.DONE);
            })(this._ppProxyXhr, this.responseRule.pairs[0].response.value);
          } else {
            nativeSend.call(this._ppProxyXhr, this._ppProxyXhr._requestData);
          }
          return;
        }

        nativeSend.call(this, this._ppProxyXhr._requestData);
      } catch (err) {
        if (debug) console.log("[PP._ppProxyXhr.send] error", err);
        nativeSend.call(this, body);
      }
    };
  };

  // ============================ Initialise ============================

  (() => {
    let debug;
    try { debug = window && window.localStorage && localStorage.isDebugMode; } catch (e) {}

    // Install XHR + fetch hooks exactly once, only when extension is enabled.
    function installHooks() {
      if (_hooksInstalled) return;
      _hooksInstalled = true;

      // XHR interceptor (patches XMLHttpRequest global + prototype methods)
      interceptXHR(debug);

      // fetch interceptor
      const nativeFetch = fetch;
      fetch = async (...args) => {
        const [resource, init = {}] = args;
        const callNativeFetch = () => nativeFetch(...args);

        // Fast path when disabled after hooks were already installed
        if (!window[PP_NAMESPACE]?.enabled) return callNativeFetch();

        try {
          let request;
          request =
            resource instanceof Request
              ? resource.clone()
              : new Request(resource.toString(), init);

          const url = toAbsoluteUrl(request.url);
          const method = request.method;

          const delayPair = findMatchingDelayRule({ url, method, type: "fetch", initiator: location.origin });
          if (delayPair) await delay(delayPair.delay);

          const hasBody = !["GET", "HEAD"].includes(method);
          let requestBodyJson;
          if (hasBody) requestBodyJson = safeJsonParse(await request.clone().text());

          const requestRule =
            hasBody &&
            findMatchingRequestRule({ url, method, type: "fetch", initiator: location.origin, requestData: requestBodyJson });

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
              method, body: newBody, headers: request.headers,
              referrer: request.referrer, referrerPolicy: request.referrerPolicy,
              mode: request.mode, credentials: request.credentials,
              cache: request.cache, redirect: request.redirect, integrity: request.integrity,
            });
            notifyRequestRuleApplied({
              ruleDetails: requestRule,
              requestDetails: { url, method: request.method, type: "fetch", timeStamp: Date.now() },
            });
          }

          const responseRule = findMatchingResponseRule({ url, requestData: requestBodyJson, method });

          let responseHeaders;
          let fetchedResponse;
          let customResponse;

          if (responseRule && shouldServeWithoutRequest(responseRule)) {
            const contentType = isJsonParseable(responseRule.pairs[0].response.value) ? "application/json" : "text/plain";
            responseHeaders = new Headers({ "content-type": contentType });
          } else {
            try {
              const headerObj = {};
              if (request?.headers?.forEach) {
                request.headers.forEach((value, key) => { headerObj[key] = value; });
              }
              await onBeforeAjaxRequest({ url, method, type: "xmlhttprequest", initiator: location.origin, requestHeaders: headerObj });

              fetchedResponse = requestRule ? await nativeFetch(request) : await callNativeFetch();
              if (!responseRule) return fetchedResponse;
              responseHeaders = fetchedResponse?.headers;
            } catch (err) {
              if (!responseRule) return Promise.reject(err);
            }
          }

          if (debug) console.log("[PP] fetch block", { url, fetchedResponse });

          const responseConfig = responseRule.pairs[0].response;

          if (responseConfig.type === "code") {
            let context = {
              method, url,
              requestHeaders: request.headers && Array.from(request.headers).reduce((acc, [k, v]) => {
                acc[k] = v; return acc;
              }, {}),
              requestData: requestBodyJson,
            };
            if (fetchedResponse) {
              const text = await fetchedResponse.text();
              const contentType = fetchedResponse.headers.get("content-type");
              context = { ...context, responseType: contentType, response: text, responseJSON: safeJsonParse(text, true) };
            }
            customResponse = buildUserFunction(responseConfig.value, "response")(context);
            if (customResponse === undefined) return fetchedResponse;
            if (isPromise(customResponse)) customResponse = await customResponse;
            if (typeof customResponse === "object" && isJsonContentType(context?.responseType)) {
              customResponse = JSON.stringify(customResponse);
            }
          } else if (responseConfig.type === "replace") {
            const rawText = fetchedResponse ? await fetchedResponse.text() : "";
            customResponse = applyBodyReplace(rawText, responseConfig);
          } else {
            customResponse = responseConfig.value;
          }

          notifyResponseRuleApplied({
            ruleDetails: responseRule,
            requestDetails: { url, method, type: "fetch", timeStamp: Date.now() },
          });

          const status = parseInt(responseConfig.statusCode || fetchedResponse?.status) || 200;
          const isEmptyBodyStatus = [204, 205, 304].includes(status);
          return new Response(isEmptyBodyStatus ? null : new Blob([customResponse]), {
            status,
            statusText: responseConfig.statusText || fetchedResponse?.statusText,
            headers: responseHeaders,
          });
        } catch (err) {
          if (debug) console.log("[PP.fetch] Error", err);
          return await callNativeFetch();
        }
      };

      if (debug) console.log("[ProxyPilot] Hooks installed");
    }

    // On page unload, cache shared state up to top frame
    if (window.top === window.self) {
      window.addEventListener("beforeunload", () => {
        window.top.postMessage(
          {
            source: "PROXYPILOT_INTERCEPTOR",
            action: "cacheSharedState",
            sharedState: window[PP_NAMESPACE]?.sharedState,
          },
          window.location.href
        );
      });
    }

    // Receive rules + enabled flag from content script.
    // installHooks() is called lazily here so that a disabled extension
    // never touches XMLHttpRequest or fetch at all.
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const msg = event.data;
      if (!msg || msg.source !== "PROXYPILOT_CONTENT") return;
      if (msg.type === "RULES_UPDATE") {
        const payload = msg.payload || {};
        const enabled = payload.enabled !== false; // absent/true → enabled

        window[PP_NAMESPACE] = window[PP_NAMESPACE] || {};
        window[PP_NAMESPACE].enabled = enabled;
        if (Array.isArray(payload.requestRules)) window[PP_NAMESPACE].requestRules = payload.requestRules;
        if (Array.isArray(payload.responseRules)) window[PP_NAMESPACE].responseRules = payload.responseRules;
        if (Array.isArray(payload.delayRules)) window[PP_NAMESPACE].delayRules = payload.delayRules;

        // Only install hooks when first enabled — never when disabled
        if (enabled) installHooks();

        if (debug) console.log("[PP] Rules updated, enabled:", enabled, window[PP_NAMESPACE]);
      }
    });

    // Cold start: ask content script for current rules + enabled state
    window.postMessage({ source: "PROXYPILOT_INTERCEPTOR", type: "REQUEST_RULES" }, "*");

    console.log("[ProxyPilot] Interceptor ready");
  })();
}();
