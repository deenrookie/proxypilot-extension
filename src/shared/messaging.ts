// Message source identifiers
export const SOURCE_CONTENT = 'PROXYPILOT_CONTENT'
export const SOURCE_INTERCEPTOR = 'PROXYPILOT_INTERCEPTOR'

// Message types: content → interceptor
export const MSG_RULES_UPDATE = 'RULES_UPDATE'

// Message types: interceptor → content
export const MSG_REQUEST_RULES = 'REQUEST_RULES'
export const MSG_RESPONSE_RULE_APPLIED = 'response_rule_applied'
export const MSG_REQUEST_RULE_APPLIED = 'request_rule_applied'
export const MSG_BEFORE_AJAX_REQUEST = 'onBeforeAjaxRequest'
export const MSG_ERROR_OCCURRED = 'onErrorOccurred'
export const MSG_CACHE_SHARED_STATE = 'cacheSharedState'

// Chrome runtime message actions (background ↔ popup/options/content)
export const ACTION_GET_STATE = 'GET_STATE'
export const ACTION_SET_MASTER = 'SET_MASTER'
export const ACTION_GET_RULES = 'GET_RULES'
export const ACTION_UPSERT_RULE = 'UPSERT_RULE'
export const ACTION_DELETE_RULE = 'DELETE_RULE'
export const ACTION_PUSH_RULES = 'PUSH_RULES'
export const ACTION_LOG_INTERCEPT = 'LOG_INTERCEPT'

export interface ChromeMessage {
  action: string
  payload?: unknown
}

export function sendToBackground<T = unknown>(msg: ChromeMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg)
}
