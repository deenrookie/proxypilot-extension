import type { GlobalState, Rule } from './types'

const STORAGE_KEY = 'proxypilot_state'

export const DEFAULT_STATE: GlobalState = {
  masterEnabled: true,
  rules: [],
}

export async function getState(): Promise<GlobalState> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return result[STORAGE_KEY] ?? DEFAULT_STATE
}

export async function setState(state: GlobalState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state })
}

export async function updateState(updater: (s: GlobalState) => GlobalState): Promise<GlobalState> {
  const current = await getState()
  const next = updater(current)
  await setState(next)
  return next
}

export async function getRules(): Promise<Rule[]> {
  const state = await getState()
  return state.rules
}

export async function upsertRule(rule: Rule): Promise<void> {
  await updateState((s) => {
    const idx = s.rules.findIndex((r) => r.id === rule.id)
    const rules = idx >= 0
      ? s.rules.map((r) => (r.id === rule.id ? rule : r))
      : [...s.rules, rule]
    return { ...s, rules }
  })
}

export async function deleteRule(id: string): Promise<void> {
  await updateState((s) => ({ ...s, rules: s.rules.filter((r) => r.id !== id) }))
}

export async function getMasterEnabled(): Promise<boolean> {
  const state = await getState()
  return state.masterEnabled
}

export async function setMasterEnabled(enabled: boolean): Promise<void> {
  await updateState((s) => ({ ...s, masterEnabled: enabled }))
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function onStateChanged(callback: (state: GlobalState) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes[STORAGE_KEY]) {
      callback(changes[STORAGE_KEY].newValue ?? DEFAULT_STATE)
    }
  }
  chrome.storage.local.onChanged.addListener(listener)
  return () => chrome.storage.local.onChanged.removeListener(listener)
}
