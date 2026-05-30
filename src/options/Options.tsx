import React, { useEffect, useState, useCallback } from 'react'
import Logo from '../shared/Logo'
import type { Rule, RuleType, RuleAction, MatchCondition, UrlOperator } from '../shared/types'
import {
  ACTION_GET_STATE, ACTION_SET_MASTER, ACTION_UPSERT_RULE, ACTION_DELETE_RULE,
} from '../shared/messaging'
import { matchUrl } from '../shared/matcher'

type View = 'list' | 'edit'

const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: 'redirect', label: 'Redirect' },
  { value: 'block', label: 'Block / Cancel' },
  { value: 'modifyHeaders', label: 'Modify Headers' },
  { value: 'modifyResponse', label: 'Mock Response' },
  { value: 'replaceInResponse', label: 'Replace in Response' },
  { value: 'insertScript', label: 'Insert Script' },
  { value: 'modifyQueryParams', label: 'Modify Query Params' },
  { value: 'modifyRequestBody', label: 'Modify Request Body' },
  { value: 'replace', label: 'Replace String' },
  { value: 'delay', label: 'Delay' },
  { value: 'userAgent', label: 'User Agent' },
]

const URL_OPERATORS: { value: UrlOperator; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'matches', label: 'Regex Matches' },
  { value: 'wildcard', label: 'Wildcard' },
]

function makeDefaultAction(type: RuleType): RuleAction {
  switch (type) {
    case 'redirect': return { type: 'redirect', redirectUrl: '' }
    case 'block': return { type: 'block' }
    case 'modifyHeaders': return { type: 'modifyHeaders', request: [], response: [] }
    case 'modifyResponse': return { type: 'modifyResponse', body: '{}', bodyType: 'static', statusCode: 200, serveWithoutRequest: true }
    case 'replaceInResponse': return { type: 'replaceInResponse', search: '', replacement: '', useRegex: false }
    case 'insertScript': return { type: 'insertScript', code: '', lang: 'js', runAt: 'document_end' }
    case 'modifyQueryParams': return { type: 'modifyQueryParams', add: {}, remove: [] }
    case 'modifyRequestBody': return { type: 'modifyRequestBody', body: '', bodyType: 'static' }
    case 'replace': return { type: 'replace', from: '', to: '' }
    case 'delay': return { type: 'delay', ms: 1000 }
    case 'userAgent': return { type: 'userAgent', ua: '' }
  }
}

function makeNewRule(type: RuleType): Rule {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: '',
    type,
    enabled: true,
    condition: { urlOperator: 'contains', urlValue: '' },
    action: makeDefaultAction(type),
    createdAt: now,
    updatedAt: now,
  }
}

// ─── Action editors ────────────────────────────────────────────────────────

function ActionEditor({ action, onChange }: { action: RuleAction; onChange: (a: RuleAction) => void }) {
  switch (action.type) {
    case 'redirect':
      return (
        <label style={S.field}>
          <span style={S.label}>Redirect URL</span>
          <input style={S.input} value={action.redirectUrl}
            onChange={(e) => onChange({ ...action, redirectUrl: e.target.value })}
            placeholder="https://example.com/new-path" />
        </label>
      )
    case 'block':
      return <p style={{ color: '#6b7280', fontSize: 13 }}>Matching requests will be blocked (no action config needed).</p>

    case 'modifyResponse':
      return (
        <>
          <div style={S.row}>
            <label style={{ ...S.field, flex: 1 }}>
              <span style={S.label}>Status Code</span>
              <input style={S.input} type="number" value={action.statusCode ?? 200}
                onChange={(e) => onChange({ ...action, statusCode: parseInt(e.target.value) || 200 })} />
            </label>
            <label style={{ ...S.field, flex: 1 }}>
              <span style={S.label}>Body Type</span>
              <select style={S.input} value={action.bodyType}
                onChange={(e) => onChange({ ...action, bodyType: e.target.value as 'static' | 'jsFunction' })}>
                <option value="static">Static</option>
                <option value="jsFunction">JS Function</option>
              </select>
            </label>
          </div>
          <label style={S.field}>
            <span style={S.label}>{action.bodyType === 'jsFunction' ? 'Function body (receives: {method,url,requestHeaders,requestData,responseType,response,responseJSON})' : 'Response body'}</span>
            <textarea style={{ ...S.input, minHeight: 100, fontFamily: 'monospace', fontSize: 12 }}
              value={action.body}
              onChange={(e) => onChange({ ...action, body: e.target.value })}
              placeholder={action.bodyType === 'jsFunction' ? 'return { status: "ok" }' : '{"status":"ok"}'} />
          </label>
          <label style={S.checkRow}>
            <input type="checkbox" checked={action.serveWithoutRequest ?? true}
              onChange={(e) => onChange({ ...action, serveWithoutRequest: e.target.checked })} />
            <span>Serve without sending actual request (pure mock)</span>
          </label>
        </>
      )

    case 'replaceInResponse':
      return (
        <>
          <label style={S.field}>
            <span style={S.label}>{action.useRegex ? 'Search pattern (regex)' : 'Search text'}</span>
            <input
              style={S.input}
              value={action.search}
              onChange={(e) => onChange({ ...action, search: e.target.value })}
              placeholder={action.useRegex ? 'true|enabled' : 'true'}
              spellCheck={false}
            />
          </label>
          <label style={S.field}>
            <span style={S.label}>Replace with</span>
            <input
              style={S.input}
              value={action.replacement}
              onChange={(e) => onChange({ ...action, replacement: e.target.value })}
              placeholder="false"
              spellCheck={false}
            />
          </label>
          <label style={S.checkRow}>
            <input
              type="checkbox"
              checked={action.useRegex}
              onChange={(e) => onChange({ ...action, useRegex: e.target.checked })}
            />
            <span>Use regular expression — replaces all matches globally</span>
          </label>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
            The actual request is still sent; only the response body text is rewritten.
          </p>
        </>
      )

    case 'modifyRequestBody':
      return (
        <>
          <label style={S.field}>
            <span style={S.label}>Body Type</span>
            <select style={S.input} value={action.bodyType}
              onChange={(e) => onChange({ ...action, bodyType: e.target.value as 'static' | 'jsFunction' })}>
              <option value="static">Static</option>
              <option value="jsFunction">JS Function</option>
            </select>
          </label>
          <label style={S.field}>
            <span style={S.label}>Request body</span>
            <textarea style={{ ...S.input, minHeight: 80, fontFamily: 'monospace', fontSize: 12 }}
              value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })}
              placeholder='{"key":"value"}' />
          </label>
        </>
      )

    case 'modifyHeaders': {
      const addHeader = (side: 'request' | 'response') => {
        const arr = [...(action[side] ?? []), { op: 'set' as const, header: '', value: '' }]
        onChange({ ...action, [side]: arr })
      }
      const removeHeader = (side: 'request' | 'response', idx: number) => {
        const arr = (action[side] ?? []).filter((_, i) => i !== idx)
        onChange({ ...action, [side]: arr })
      }
      const updateHeader = (side: 'request' | 'response', idx: number, field: string, val: string) => {
        const arr = (action[side] ?? []).map((h, i) => i === idx ? { ...h, [field]: val } : h)
        onChange({ ...action, [side]: arr })
      }
      return (
        <>
          {(['request', 'response'] as const).map((side) => (
            <div key={side} style={{ marginBottom: 12 }}>
              <div style={{ ...S.label, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{side === 'request' ? 'Request Headers' : 'Response Headers'}</span>
                <button style={S.btnSmall} onClick={() => addHeader(side)}>+ Add</button>
              </div>
              {(action[side] ?? []).map((h, i) => (
                <div key={i} style={{ ...S.row, marginBottom: 6 }}>
                  <select style={{ ...S.input, width: 90, flexShrink: 0 }} value={h.op}
                    onChange={(e) => updateHeader(side, i, 'op', e.target.value)}>
                    <option value="set">Set</option>
                    <option value="append">Append</option>
                    <option value="remove">Remove</option>
                  </select>
                  <input style={{ ...S.input, flex: 1 }} placeholder="Header name" value={h.header}
                    onChange={(e) => updateHeader(side, i, 'header', e.target.value)} />
                  {h.op !== 'remove' && (
                    <input style={{ ...S.input, flex: 2 }} placeholder="Value" value={h.value ?? ''}
                      onChange={(e) => updateHeader(side, i, 'value', e.target.value)} />
                  )}
                  <button style={S.btnDanger} onClick={() => removeHeader(side, i)}>✕</button>
                </div>
              ))}
            </div>
          ))}
        </>
      )
    }

    case 'insertScript':
      return (
        <>
          <div style={S.row}>
            <label style={{ ...S.field, flex: 1 }}>
              <span style={S.label}>Language</span>
              <select style={S.input} value={action.lang}
                onChange={(e) => onChange({ ...action, lang: e.target.value as 'js' | 'css' })}>
                <option value="js">JavaScript</option>
                <option value="css">CSS</option>
              </select>
            </label>
            <label style={{ ...S.field, flex: 1 }}>
              <span style={S.label}>Run At</span>
              <select style={S.input} value={action.runAt}
                onChange={(e) => onChange({ ...action, runAt: e.target.value as 'document_start' | 'document_end' })}>
                <option value="document_start">document_start</option>
                <option value="document_end">document_end</option>
              </select>
            </label>
          </div>
          <label style={S.field}>
            <span style={S.label}>Code</span>
            <textarea style={{ ...S.input, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }}
              value={action.code} onChange={(e) => onChange({ ...action, code: e.target.value })}
              placeholder="document.body.style.background = 'red'" />
          </label>
        </>
      )

    case 'replace':
      return (
        <>
          <label style={S.field}>
            <span style={S.label}>Find (substring)</span>
            <input style={S.input} value={action.from} onChange={(e) => onChange({ ...action, from: e.target.value })} placeholder="old.api.com" />
          </label>
          <label style={S.field}>
            <span style={S.label}>Replace with</span>
            <input style={S.input} value={action.to} onChange={(e) => onChange({ ...action, to: e.target.value })} placeholder="new.api.com" />
          </label>
        </>
      )

    case 'delay':
      return (
        <label style={S.field}>
          <span style={S.label}>Delay (ms)</span>
          <input style={S.input} type="number" min={0} value={action.ms}
            onChange={(e) => onChange({ ...action, ms: parseInt(e.target.value) || 0 })} />
        </label>
      )

    case 'modifyQueryParams': {
      const addEntries = Object.entries(action.add ?? {})
      const removeList = action.remove ?? []

      const setAdd = (entries: [string, string][]) =>
        onChange({ ...action, add: Object.fromEntries(entries) })

      const setAddEntry = (idx: number, field: 'key' | 'value', val: string) => {
        const next = [...addEntries]
        next[idx] = field === 'key'
          ? [val, next[idx]?.[1] ?? '']
          : [next[idx]?.[0] ?? '', val]
        setAdd(next)
      }

      const addAddEntry = () => setAdd([...addEntries, ['', '']])
      const removeAddEntry = (idx: number) => setAdd(addEntries.filter((_, i) => i !== idx))

      const addRemoveEntry = () =>
        onChange({ ...action, remove: [...removeList, ''] })
      const setRemoveEntry = (idx: number, val: string) =>
        onChange({ ...action, remove: removeList.map((v, i) => (i === idx ? val : v)) })
      const deleteRemoveEntry = (idx: number) =>
        onChange({ ...action, remove: removeList.filter((_, i) => i !== idx) })

      return (
        <>
          {/* Add / override params */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...S.label, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Add / Override Params</span>
              <button style={S.btnSmall} onClick={addAddEntry}>+ Add param</button>
            </div>
            {addEntries.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>No params to add yet.</p>
            )}
            {addEntries.map(([k, v], i) => (
              <div key={i} style={{ ...S.row, marginBottom: 6 }}>
                <input style={{ ...S.input, flex: 1 }} placeholder="param name"
                  value={k} onChange={(e) => setAddEntry(i, 'key', e.target.value)} />
                <span style={{ color: '#9ca3af', flexShrink: 0 }}>=</span>
                <input style={{ ...S.input, flex: 2 }} placeholder="value"
                  value={v} onChange={(e) => setAddEntry(i, 'value', e.target.value)} />
                <button style={S.btnDanger} onClick={() => removeAddEntry(i)}>✕</button>
              </div>
            ))}
          </div>

          {/* Remove params */}
          <div>
            <div style={{ ...S.label, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Remove Params</span>
              <button style={S.btnSmall} onClick={addRemoveEntry}>+ Add param</button>
            </div>
            {removeList.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af' }}>No params to remove yet.</p>
            )}
            {removeList.map((name, i) => (
              <div key={i} style={{ ...S.row, marginBottom: 6 }}>
                <input style={{ ...S.input, flex: 1 }} placeholder="param name to remove"
                  value={name} onChange={(e) => setRemoveEntry(i, e.target.value)} />
                <button style={S.btnDanger} onClick={() => deleteRemoveEntry(i)}>✕</button>
              </div>
            ))}
          </div>
        </>
      )
    }

    case 'userAgent':
      return (
        <label style={S.field}>
          <span style={S.label}>User Agent string</span>
          <input style={S.input} value={action.ua}
            onChange={(e) => onChange({ ...action, ua: e.target.value })}
            placeholder="Mozilla/5.0 …" />
        </label>
      )

    default:
      return null
  }
}

// ─── Rule editor ─────────────────────────────────────────────────────────────

function RuleEditor({ rule: initial, onSave, onCancel }: {
  rule: Rule
  onSave: (r: Rule) => void
  onCancel: () => void
}) {
  const [rule, setRule] = useState<Rule>(initial)
  const [testUrl, setTestUrl] = useState('')

  const updateCond = (patch: Partial<MatchCondition>) =>
    setRule((r) => ({ ...r, condition: { ...r.condition, ...patch } }))

  const changeType = (type: RuleType) =>
    setRule((r) => ({ ...r, type, action: makeDefaultAction(type) }))

  const testMatch = testUrl ? matchUrl(rule.condition, testUrl) : null

  return (
    <div style={S.editorWrap}>
      <div style={S.editorHeader}>
        <button style={S.btnLink} onClick={onCancel}>← Back</button>
        <h2 style={S.editorTitle}>{initial.name ? `Edit: ${initial.name}` : 'New Rule'}</h2>
        <button style={S.btnPrimary} onClick={() => onSave(rule)}>Save</button>
      </div>

      <div style={S.section}>
        <h3 style={S.sectionTitle}>General</h3>
        <label style={S.field}>
          <span style={S.label}>Rule name</span>
          <input style={S.input} value={rule.name} placeholder="My rule"
            onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))} />
        </label>
        <label style={S.field}>
          <span style={S.label}>Rule type</span>
          <select style={S.input} value={rule.type} onChange={(e) => changeType(e.target.value as RuleType)}>
            {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div style={S.section}>
        <h3 style={S.sectionTitle}>URL Condition</h3>
        <div style={S.row}>
          <label style={{ ...S.field, width: 160, flexShrink: 0 }}>
            <span style={S.label}>Operator</span>
            <select style={S.input} value={rule.condition.urlOperator}
              onChange={(e) => updateCond({ urlOperator: e.target.value as UrlOperator })}>
              {URL_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={{ ...S.field, flex: 1 }}>
            <span style={S.label}>Value</span>
            <input style={S.input} value={rule.condition.urlValue} placeholder="https://api.example.com"
              onChange={(e) => updateCond({ urlValue: e.target.value })} />
          </label>
        </div>

        {/* URL tester */}
        <label style={S.field}>
          <span style={S.label}>Test URL</span>
          <div style={S.row}>
            <input style={{ ...S.input, flex: 1 }} value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)} placeholder="Enter URL to test match…" />
            {testUrl && (
              <span style={{ ...S.badge, background: testMatch ? '#d1fae5' : '#fee2e2', color: testMatch ? '#065f46' : '#991b1b' }}>
                {testMatch ? '✓ Match' : '✗ No match'}
              </span>
            )}
          </div>
        </label>
      </div>

      <div style={S.section}>
        <h3 style={S.sectionTitle}>Action</h3>
        <ActionEditor action={rule.action} onChange={(a) => setRule((r) => ({ ...r, action: a }))} />
      </div>
    </div>
  )
}

// ─── Main options page ────────────────────────────────────────────────────────

export default function Options() {
  const [rules, setRules] = useState<Rule[]>([])
  const [masterEnabled, setMasterEnabled] = useState(true)
  const [view, setView] = useState<View>('list')
  const [editing, setEditing] = useState<Rule | null>(null)
  const [newType, setNewType] = useState<RuleType>('redirect')
  const [importExportModal, setImportExportModal] = useState(false)
  const [exportText, setExportText] = useState('')

  useEffect(() => {
    chrome.runtime.sendMessage({ action: ACTION_GET_STATE }).then((state) => {
      setRules(state.rules)
      setMasterEnabled(state.masterEnabled)
    })
  }, [])

  const toggleMaster = async () => {
    const next = !masterEnabled
    await chrome.runtime.sendMessage({ action: ACTION_SET_MASTER, payload: next })
    setMasterEnabled(next)
  }

  const saveRule = async (rule: Rule) => {
    const updated = { ...rule, updatedAt: Date.now() }
    await chrome.runtime.sendMessage({ action: ACTION_UPSERT_RULE, payload: updated })
    setRules((rs) => {
      const idx = rs.findIndex((r) => r.id === updated.id)
      return idx >= 0 ? rs.map((r) => r.id === updated.id ? updated : r) : [...rs, updated]
    })
    setView('list')
    setEditing(null)
  }

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this rule?')) return
    await chrome.runtime.sendMessage({ action: ACTION_DELETE_RULE, payload: id })
    setRules((rs) => rs.filter((r) => r.id !== id))
  }

  const openNew = () => {
    setEditing(makeNewRule(newType))
    setView('edit')
  }

  const exportRules = () => {
    setExportText(JSON.stringify({ masterEnabled, rules }, null, 2))
    setImportExportModal(true)
  }

  const importRules = async (json: string) => {
    try {
      const data = JSON.parse(json)
      for (const rule of data.rules ?? []) {
        await chrome.runtime.sendMessage({ action: ACTION_UPSERT_RULE, payload: rule })
      }
      setRules((rs) => {
        const merged = [...rs]
        for (const rule of data.rules ?? []) {
          const idx = merged.findIndex((r) => r.id === rule.id)
          if (idx >= 0) merged[idx] = rule; else merged.push(rule)
        }
        return merged
      })
      setImportExportModal(false)
      alert('Rules imported successfully')
    } catch {
      alert('Invalid JSON')
    }
  }

  if (view === 'edit' && editing) {
    return (
      <RuleEditor
        rule={editing}
        onSave={saveRule}
        onCancel={() => { setView('list'); setEditing(null) }}
      />
    )
  }

  return (
    <div style={S.page}>
      {/* Top nav */}
      <div style={S.topNav}>
        <div style={S.navBrand}>
          <Logo size={32} />
          <span style={S.navTitle}>ProxyPilot</span>
        </div>
        <div style={S.navRight}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span style={{ fontSize: 13, color: '#374151' }}>
              {masterEnabled ? 'Enabled' : 'Paused'}
            </span>
            <input type="checkbox" checked={masterEnabled} onChange={toggleMaster} style={{ display: 'none' }} />
            <div style={{ ...S.track, background: masterEnabled ? '#111' : '#d1d5db' }}>
              <div style={{ ...S.thumb, transform: masterEnabled ? 'translateX(20px)' : 'translateX(0)' }} />
            </div>
          </label>
          <button style={S.btnSecondary} onClick={exportRules}>Export</button>
        </div>
      </div>

      {/* Content */}
      <div style={S.content}>
        <div style={S.contentHeader}>
          <h1 style={S.h1}>Rules</h1>
          <div style={S.row}>
            <select style={{ ...S.input, width: 160 }} value={newType}
              onChange={(e) => setNewType(e.target.value as RuleType)}>
              {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button style={S.btnPrimary} onClick={openNew}>+ New Rule</button>
          </div>
        </div>

        {rules.length === 0 ? (
          <div style={S.emptyState}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
            <h2 style={{ fontWeight: 600, marginBottom: 8 }}>No rules yet</h2>
            <p style={{ color: '#6b7280', marginBottom: 20 }}>Create your first rule to start intercepting requests.</p>
            <button style={S.btnPrimary} onClick={openNew}>Create Rule</button>
          </div>
        ) : (
          <div style={S.ruleTable}>
            <div style={S.tableHead}>
              <span style={{ flex: 1 }}>Name / URL</span>
              <span style={{ width: 120 }}>Type</span>
              <span style={{ width: 80, textAlign: 'center' }}>Enabled</span>
              <span style={{ width: 80 }}>Actions</span>
            </div>
            {rules.map((rule) => (
              <div key={rule.id} style={S.tableRow}>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.name || '(unnamed)'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.condition.urlOperator}: {rule.condition.urlValue}
                  </div>
                </div>
                <div style={{ width: 120 }}>
                  <span style={{ ...S.badge, background: '#f3f4f6', color: '#374151' }}>
                    {RULE_TYPES.find((t) => t.value === rule.type)?.label ?? rule.type}
                  </span>
                </div>
                <div style={{ width: 80, textAlign: 'center' }}>
                  <label style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={rule.enabled}
                      onChange={async () => {
                        const updated = { ...rule, enabled: !rule.enabled, updatedAt: Date.now() }
                        await chrome.runtime.sendMessage({ action: ACTION_UPSERT_RULE, payload: updated })
                        setRules((rs) => rs.map((r) => r.id === updated.id ? updated : r))
                      }}
                      style={{ display: 'none' }} />
                    <div style={{ ...S.smallTrack, background: rule.enabled ? '#111' : '#d1d5db', margin: '0 auto' }}>
                      <div style={{ ...S.smallThumb, transform: rule.enabled ? 'translateX(14px)' : 'translateX(0)' }} />
                    </div>
                  </label>
                </div>
                <div style={{ width: 80, display: 'flex', gap: 4 }}>
                  <button style={S.btnSmall}
                    onClick={() => { setEditing(rule); setView('edit') }}>Edit</button>
                  <button style={{ ...S.btnSmall, color: '#ef4444' }}
                    onClick={() => deleteRule(rule.id)}>Del</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import/Export modal */}
      {importExportModal && (
        <div style={S.overlay} onClick={() => setImportExportModal(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12, fontWeight: 600 }}>Export / Import Rules</h3>
            <textarea style={{ ...S.input, width: '100%', minHeight: 200, fontFamily: 'monospace', fontSize: 12 }}
              value={exportText} onChange={(e) => setExportText(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button style={S.btnSecondary} onClick={() => setImportExportModal(false)}>Cancel</button>
              <button style={S.btnPrimary} onClick={() => importRules(exportText)}>Import</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f8f9fa', fontFamily: 'Inter, -apple-system, sans-serif', fontSize: 14, color: '#111' },
  topNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 64, background: '#fff', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10 },
  navBrand: { display: 'flex', alignItems: 'center', gap: 10 },
  navTitle: { fontWeight: 700, fontSize: 18, letterSpacing: -0.5 },
  navRight: { display: 'flex', alignItems: 'center', gap: 16 },
  content: { maxWidth: 900, margin: '0 auto', padding: '32px 24px' },
  contentHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  h1: { fontWeight: 700, fontSize: 24, letterSpacing: -0.5 },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff', color: '#111' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, width: '100%' },
  label: { fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer', marginBottom: 8 },
  badge: { fontSize: 12, borderRadius: 6, padding: '3px 8px', fontWeight: 500, whiteSpace: 'nowrap' },
  btnPrimary: { background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' },
  btnSecondary: { background: '#fff', color: '#111', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  btnSmall: { background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 500 },
  btnDanger: { background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 },
  btnLink: { background: 'none', border: 'none', cursor: 'pointer', color: '#374151', fontSize: 14, fontWeight: 500, padding: 0 },
  emptyState: { textAlign: 'center', padding: '80px 24px', color: '#374151' },
  ruleTable: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' },
  tableHead: { display: 'flex', gap: 16, padding: '10px 16px', background: '#f8f9fa', borderBottom: '1px solid #e5e7eb', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  tableRow: { display: 'flex', gap: 16, padding: '12px 16px', borderBottom: '1px solid #f3f4f6', alignItems: 'center' },
  section: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '20px 24px', marginBottom: 20 },
  sectionTitle: { fontWeight: 600, fontSize: 15, marginBottom: 16 },
  editorWrap: { maxWidth: 720, margin: '0 auto', padding: '24px 24px', fontFamily: 'Inter, -apple-system, sans-serif', fontSize: 14, color: '#111' },
  editorHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  editorTitle: { fontWeight: 700, fontSize: 20 },
  track: { width: 40, height: 22, borderRadius: 9999, position: 'relative', transition: 'background 0.2s', display: 'flex', alignItems: 'center', cursor: 'pointer' },
  thumb: { width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', left: 3, transition: 'transform 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,.15)' },
  smallTrack: { width: 30, height: 17, borderRadius: 9999, position: 'relative', transition: 'background 0.2s', display: 'flex', alignItems: 'center' },
  smallThumb: { width: 12, height: 12, borderRadius: '50%', background: '#fff', position: 'absolute', left: 2, transition: 'transform 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,.15)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#fff', borderRadius: 12, padding: 24, width: 560, maxWidth: '95vw' },
}
