import { useState } from 'react'
import type { SiteSettingsView } from '../shared/messages'
import { runStatusLine, stopNotices } from './format'
import { orderedSiteList, SITES_TAB_LABEL, type SiteInfo } from './sites'

interface Props {
  state: SiteSettingsView
  busy: boolean
  canCollect: boolean
  /** Resolves once saved, or throws a Korean message (turning off the last site is refused). */
  onToggle: (id: string, on: boolean) => Promise<void>
  onMove: (id: string, direction: 'up' | 'down') => Promise<void>
  onCollectSite: (id: string) => void
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function SitesView({ state, busy, canCollect, onToggle, onMove, onCollectSite }: Props) {
  const [message, setMessage] = useState<string | null>(null)
  const ordered = orderedSiteList(state.settings.siteOrder)
  const availableCount = ordered.filter((site) => site.availability === 'available').length

  async function toggle(id: string, on: boolean) {
    setMessage(null)
    try {
      await onToggle(id, on)
    } catch (e) {
      setMessage(errorText(e))
    }
  }

  async function move(id: string, direction: 'up' | 'down') {
    setMessage(null)
    try {
      await onMove(id, direction)
    } catch (e) {
      setMessage(errorText(e))
    }
  }

  return (
    <section aria-label={SITES_TAB_LABEL} className="sites">
      <p className="hint">켜 둔 사이트만 "지금 수집"으로 위에서 아래 순서대로 모읍니다. 꺼도 이미 모은 공고는 그대로 남습니다.</p>
      <ul className="site-list">
        {ordered.map((site, index) => (
          <SiteRow
            key={site.id}
            site={site}
            state={state}
            isFirst={index === 0}
            isLast={index === availableCount - 1}
            busy={busy}
            canCollect={canCollect}
            onToggle={toggle}
            onMove={move}
            onCollectSite={onCollectSite}
          />
        ))}
      </ul>
      {message && (
        <p role="alert" className="warn">
          {message}
        </p>
      )}
      <p className="hint">로그인이 필요한 사이트는 이 크롬에서 직접 로그인해 두면 그 상태로 수집합니다. 아이디·비밀번호는 이 확장에 저장하지 않습니다.</p>
    </section>
  )
}

interface RowProps extends Pick<Props, 'busy' | 'canCollect' | 'onCollectSite'> {
  site: SiteInfo
  state: SiteSettingsView
  isFirst: boolean
  isLast: boolean
  onToggle: (id: string, on: boolean) => void
  onMove: (id: string, direction: 'up' | 'down') => void
}

function SiteRow({ site, state, isFirst, isLast, busy, canCollect, onToggle, onMove, onCollectSite }: RowProps) {
  const link = (
    <a href={site.homeUrl} target="_blank" rel="noopener noreferrer">
      {site.homeUrl}
    </a>
  )
  if (site.availability === 'planned') {
    return (
      <li className="site-row planned" data-site={site.id}>
        <div className="site-head">
          <h3>
            {site.name} <span className="state">준비 중</span>
          </h3>
          <label className="switch">
            <input type="checkbox" checked={false} disabled />
            <span className="track" aria-hidden="true" />
            <span className="switch-label">{site.name} 사용</span>
          </label>
        </div>
        <p className="site-url">{link}</p>
      </li>
    )
  }

  const enabled = state.settings.enabledSites.includes(site.id)
  const run = state.runs[site.id]
  return (
    <li className="site-row" data-site={site.id}>
      <div className="site-head">
        <h3>{site.name}</h3>
        <div className="site-controls">
          <div className="move-buttons" role="group" aria-label={`${site.name} 순서 변경`}>
            <button type="button" className="move-btn" disabled={isFirst} aria-label={`${site.name} 위로 이동`} title="위로 이동" onClick={() => onMove(site.id, 'up')}>
              ↑
            </button>
            <button type="button" className="move-btn" disabled={isLast} aria-label={`${site.name} 아래로 이동`} title="아래로 이동" onClick={() => onMove(site.id, 'down')}>
              ↓
            </button>
          </div>
          <label className="switch">
            <input type="checkbox" checked={enabled} onChange={(e) => onToggle(site.id, e.target.checked)} />
            <span className="track" aria-hidden="true" />
            <span className="switch-label">{site.name} 사용</span>
          </label>
        </div>
      </div>
      <p className="site-url">{link}</p>
      <dl className="facts">
        <div>
          <dt>로그인</dt>
          <dd>{site.requiresLogin ? '필요' : '필요 없음'}</dd>
        </div>
        <div>
          <dt>최근 수집</dt>
          <dd data-testid={`run-${site.id}`}>{runStatusLine(run)}</dd>
        </div>
      </dl>
      {run?.result.kind === 'ok' &&
        stopNotices(run.result.summary).map((notice) => (
          <p key={notice} className="warn">
            {notice}
          </p>
        ))}
      <button type="button" onClick={() => onCollectSite(site.id)} disabled={busy || !canCollect || !enabled}>
        이 사이트만 수집
      </button>
    </li>
  )
}
