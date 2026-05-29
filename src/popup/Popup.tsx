import React, { useEffect, useState } from 'react'
import Logo from '../shared/Logo'
import type { GlobalState, Rule } from '../shared/types'
import { ACTION_GET_STATE, ACTION_SET_MASTER, ACTION_UPSERT_RULE } from '../shared/messaging'

const RULE_TYPE_LABELS: Record<string, string> = {
  redirect: 'Redirect',
  block: 'Block',
  modifyHeaders: 'Modify Headers',
  modifyResponse: 'Mock Response',
  insertScript: 'Insert Script',
  modifyQueryParams: 'Query Params',
  modifyRequestBody: 'Modify Request',
  replace: 'Replace',
  delay: 'Delay',
  userAgent: 'User Agent',
}

const TYPE_COLORS: Record<string, string> = {
  redirect: '#3b82f6',
  block: '#ef4444',
  modifyHeaders: '#8b5cf6',
  modifyResponse: '#10b981',
  insertScript: '#f59e0b',
  delay: '#6b7280',
  default: '#6b7280',
}

export default function Popup() {
  const [state, setState] = useState<GlobalState | null>(null)

  useEffect(() => {
    chrome.runtime.sendMessage({ action: ACTION_GET_STATE }).then(setState)
  }, [])

  const toggleMaster = async () => {
    if (!state) return
    const next = !state.masterEnabled
    await chrome.runtime.sendMessage({ action: ACTION_SET_MASTER, payload: next })
    setState((s) => s ? { ...s, masterEnabled: next } : s)
  }

  const toggleRule = async (rule: Rule) => {
    if (!state) return
    const updated: Rule = { ...rule, enabled: !rule.enabled, updatedAt: Date.now() }
    await chrome.runtime.sendMessage({ action: ACTION_UPSERT_RULE, payload: updated })
    setState((s) => s ? {
      ...s,
      rules: s.rules.map((r) => (r.id === updated.id ? updated : r)),
    } : s)
  }

  const openOptions = () => chrome.runtime.openOptionsPage()

  if (!state) return <div style={S.loading}>Loading…</div>

  const { masterEnabled, rules } = state

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.brand}>
          <Logo size={22} />
          <span style={S.title}>ProxyPilot</span>
        </div>
        <label style={S.toggle}>
          <input type="checkbox" checked={masterEnabled} onChange={toggleMaster} style={{ display: 'none' }} />
          <div style={{ ...S.track, background: masterEnabled ? '#111' : '#d1d5db' }}>
            <div style={{ ...S.thumb, transform: masterEnabled ? 'translateX(20px)' : 'translateX(0)' }} />
          </div>
        </label>
      </div>

      {/* Status badge */}
      {!masterEnabled && (
        <div style={S.disabledBanner}>All rules paused</div>
      )}

      {/* Rule list */}
      <div style={S.ruleList}>
        {rules.length === 0 ? (
          <div style={S.empty}>
            <div style={S.emptyIcon}>📋</div>
            <div>No rules yet</div>
            <button style={S.btnPrimary} onClick={openOptions}>Create a rule</button>
          </div>
        ) : (
          rules.map((rule) => (
            <div key={rule.id} style={{ ...S.ruleRow, opacity: (!masterEnabled || !rule.enabled) ? 0.5 : 1 }}>
              <div style={{ ...S.typeBadge, background: TYPE_COLORS[rule.type] ?? TYPE_COLORS.default }}>
                {RULE_TYPE_LABELS[rule.type] ?? rule.type}
              </div>
              <div style={S.ruleName}>{rule.name || rule.condition.urlValue}</div>
              <label style={S.ruleToggle}>
                <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule)} style={{ display: 'none' }} />
                <div style={{ ...S.smallTrack, background: rule.enabled ? '#111' : '#d1d5db' }}>
                  <div style={{ ...S.smallThumb, transform: rule.enabled ? 'translateX(14px)' : 'translateX(0)' }} />
                </div>
              </label>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div style={S.footer}>
        <button style={S.btnLink} onClick={openOptions}>Manage rules →</button>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  root: { width: 340, fontFamily: 'Inter, -apple-system, sans-serif', fontSize: 14, color: '#111' },
  loading: { padding: 24, textAlign: 'center', color: '#6b7280' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #f3f4f6' },
  brand: { display: 'flex', alignItems: 'center', gap: 8 },
  title: { fontWeight: 600, fontSize: 15 },
  toggle: { cursor: 'pointer' },
  track: { width: 40, height: 22, borderRadius: 9999, position: 'relative', transition: 'background 0.2s', display: 'flex', alignItems: 'center' },
  thumb: { width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', left: 3, transition: 'transform 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,.15)' },
  disabledBanner: { background: '#fef3c7', color: '#92400e', fontSize: 12, textAlign: 'center', padding: '6px 16px' },
  ruleList: { maxHeight: 320, overflowY: 'auto' },
  empty: { padding: '32px 16px', textAlign: 'center', color: '#6b7280', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  emptyIcon: { fontSize: 28 },
  ruleRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f3f4f6', transition: 'opacity 0.2s' },
  typeBadge: { fontSize: 11, fontWeight: 600, color: '#fff', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' },
  ruleName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#374151' },
  ruleToggle: { cursor: 'pointer', flexShrink: 0 },
  smallTrack: { width: 30, height: 17, borderRadius: 9999, position: 'relative', transition: 'background 0.2s', display: 'flex', alignItems: 'center' },
  smallThumb: { width: 12, height: 12, borderRadius: '50%', background: '#fff', position: 'absolute', left: 2, transition: 'transform 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,.15)' },
  footer: { padding: '10px 16px', borderTop: '1px solid #f3f4f6', textAlign: 'right' },
  btnLink: { background: 'none', border: 'none', cursor: 'pointer', color: '#374151', fontSize: 13, fontWeight: 500, padding: 0 },
  btnPrimary: { background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
}
