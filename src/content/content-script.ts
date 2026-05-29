// Inline constants to avoid shared chunk in content script build
const SOURCE_CONTENT = 'PROXYPILOT_CONTENT'
const SOURCE_INTERCEPTOR = 'PROXYPILOT_INTERCEPTOR'
const MSG_RULES_UPDATE = 'RULES_UPDATE'
const MSG_REQUEST_RULES = 'REQUEST_RULES'
const MSG_BEFORE_AJAX_REQUEST = 'onBeforeAjaxRequest'
const MSG_CACHE_SHARED_STATE = 'cacheSharedState'
const ACTION_PUSH_RULES = 'PUSH_RULES'
const ACTION_LOG_INTERCEPT = 'LOG_INTERCEPT'

console.log('[ProxyPilot] Content script loaded')

let currentPayload: Record<string, unknown> = {}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === ACTION_PUSH_RULES) {
    currentPayload = msg.payload ?? {}
    broadcastRules(currentPayload)
    sendResponse({ ok: true })
  }
  return false
})

function broadcastRules(payload: Record<string, unknown>): void {
  window.postMessage({
    source: SOURCE_CONTENT,
    type: MSG_RULES_UPDATE,
    payload,
  }, '*')
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const msg = event.data
  if (!msg || msg.source !== SOURCE_INTERCEPTOR) return

  switch (msg.type ?? msg.action) {
    case MSG_REQUEST_RULES:
      broadcastRules(currentPayload)
      break

    case MSG_BEFORE_AJAX_REQUEST:
      window.postMessage({ action: `${msg.action}:processed` }, '*')
      break

    case MSG_CACHE_SHARED_STATE:
      try {
        sessionStorage.setItem('__pp_shared_state', JSON.stringify(msg.sharedState ?? {}))
      } catch {}
      break

    case 'response_rule_applied':
    case 'request_rule_applied':
      chrome.runtime.sendMessage({ action: ACTION_LOG_INTERCEPT, payload: msg }).catch(() => {})
      break
  }
})
