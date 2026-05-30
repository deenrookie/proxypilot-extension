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

// ── Icon management ──────────────────────────────────────────────────────────

async function updateActionIcon(enabled: boolean): Promise<void> {
  const s = enabled ? '' : '-disabled'
  await chrome.action.setIcon({
    path: { 16: `icon16${s}.png`, 32: `icon32${s}.png`, 48: `icon48${s}.png`, 128: `icon128${s}.png` },
  })
}

// ── DNR rules ────────────────────────────────────────────────────────────────

async function applyDNR(state: GlobalState): Promise<void> {
  const removeRuleIds = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id)
  if (!state.masterEnabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds })
    return
  }
  const { dnrRules } = splitRules(state.rules)
  const addRules = compileToDNR(dnrRules)
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules })
  console.log(`[ProxyPilot] DNR: removed ${removeRuleIds.length}, added ${addRules.length} rules`)
}

// ── Page-layer rules ─────────────────────────────────────────────────────────

function buildPagePayload(state: GlobalState): Record<string, unknown> {
  if (!state.masterEnabled) {
    return { enabled: false, requestRules: [], responseRules: [], delayRules: [] }
  }
  const { pageRules } = splitRules(state.rules)
  return { enabled: true, ...toInterceptorRules(pageRules) }
}

async function pushPageRules(state: GlobalState): Promise<void> {
  const payload = buildPagePayload(state)
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue
    chrome.tabs.sendMessage(tab.id, { action: ACTION_PUSH_RULES, payload }).catch(() => {})
  }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function syncAll(): Promise<void> {
  const state = await getState()
  await Promise.all([applyDNR(state), pushPageRules(state), updateActionIcon(state.masterEnabled)])
}

onStateChanged((state) => {
  applyDNR(state).catch(console.error)
  pushPageRules(state).catch(console.error)
  updateActionIcon(state.masterEnabled).catch(console.error)
})

syncAll().catch(console.error)

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    switch (msg.action) {
      case ACTION_GET_STATE:    sendResponse(await _getState()); break
      case ACTION_SET_MASTER:   await setMasterEnabled(msg.payload as boolean); sendResponse({ ok: true }); break
      case ACTION_UPSERT_RULE:  await upsertRule(msg.payload); sendResponse({ ok: true }); break
      case ACTION_DELETE_RULE:  await deleteRule(msg.payload as string); sendResponse({ ok: true }); break
      case ACTION_LOG_INTERCEPT: console.log('[ProxyPilot] intercepted', msg.payload); sendResponse({ ok: true }); break
      default: sendResponse({ error: 'unknown action' })
    }
  })()
  return true
})

// ── Tab lifecycle ─────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || tab.url.startsWith('chrome://')) return
  getState().then((state) => {
    if (!tab.id) return
    chrome.tabs.sendMessage(tab.id, { action: ACTION_PUSH_RULES, payload: buildPagePayload(state) }).catch(() => {})
  })
})
