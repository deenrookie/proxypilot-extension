import { getState, onStateChanged } from '../shared/storage'
import { splitRules, toInterceptorRules } from './rule-router'
import { compileToDNR } from './dnr-compiler'
import type { GlobalState } from '../shared/types'
import {
  ACTION_GET_STATE, ACTION_SET_MASTER, ACTION_UPSERT_RULE,
  ACTION_DELETE_RULE, ACTION_PUSH_RULES, ACTION_LOG_INTERCEPT,
} from '../shared/messaging'
import { getState as _getState, setMasterEnabled, upsertRule, deleteRule } from '../shared/storage'

console.log('[ProxyPilot] Service worker started')

// Apply DNR rules from current state
async function applyDNR(state: GlobalState): Promise<void> {
  if (!state.masterEnabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: await getExistingDNRIds() })
    return
  }
  const { dnrRules } = splitRules(state.rules)
  const compiled = compileToDNR(dnrRules)
  const removeRuleIds = await getExistingDNRIds()
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: compiled })
  console.log(`[ProxyPilot] DNR: removed ${removeRuleIds.length}, added ${compiled.length} rules`)
}

async function getExistingDNRIds(): Promise<number[]> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  return existing.map((r) => r.id)
}

// Push page-level rules to all matching tabs
async function pushPageRules(state: GlobalState): Promise<void> {
  const enabled = state.masterEnabled
  const { pageRules } = splitRules(state.rules)
  const payload = enabled ? toInterceptorRules(pageRules) : { requestRules: [], responseRules: [], delayRules: [] }

  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue
    chrome.tabs.sendMessage(tab.id, { action: ACTION_PUSH_RULES, payload }).catch(() => {
      // Tab may not have content script loaded yet — ignore
    })
  }
}

async function syncAll(): Promise<void> {
  const state = await getState()
  await Promise.all([applyDNR(state), pushPageRules(state)])
}

// Listen for storage changes
onStateChanged((state) => {
  applyDNR(state).catch(console.error)
  pushPageRules(state).catch(console.error)
})

// Initial sync on startup
syncAll().catch(console.error)

// Runtime message handler (popup / options / content-script)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    switch (msg.action) {
      case ACTION_GET_STATE: {
        const state = await _getState()
        sendResponse(state)
        break
      }
      case ACTION_SET_MASTER: {
        await setMasterEnabled(msg.payload as boolean)
        sendResponse({ ok: true })
        break
      }
      case ACTION_UPSERT_RULE: {
        await upsertRule(msg.payload)
        sendResponse({ ok: true })
        break
      }
      case ACTION_DELETE_RULE: {
        await deleteRule(msg.payload as string)
        sendResponse({ ok: true })
        break
      }
      case ACTION_LOG_INTERCEPT: {
        console.log('[ProxyPilot] intercepted', msg.payload)
        sendResponse({ ok: true })
        break
      }
      default:
        sendResponse({ error: 'unknown action' })
    }
  })()
  return true // keep channel open for async response
})

// When a new tab finishes loading, push its rules
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    getState().then((state) => {
      if (!tab.id) return
      const { pageRules } = splitRules(state.rules)
      const payload = state.masterEnabled
        ? toInterceptorRules(pageRules)
        : { requestRules: [], responseRules: [], delayRules: [] }
      chrome.tabs.sendMessage(tab.id, { action: ACTION_PUSH_RULES, payload }).catch(() => {})
    })
  }
})
