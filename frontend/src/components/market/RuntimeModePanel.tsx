import type { HealthResponse } from '../../api/system'
import { displayText } from '../../utils/display'

type Props = {
  health: HealthResponse | null
  error: string | null
}

export default function RuntimeModePanel({ health, error }: Props) {
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>运行模式</h3>
        <span>确认当前是否处于 core-only 模式</span>
      </div>
      {error ? <p className="warn-text">{error}</p> : null}
      <div className="status-grid compact-status-grid">
        <div className="status-row">
          <span>API 状态</span>
          <strong>{displayText(health?.status)}</strong>
        </div>
        <div className="status-row">
          <span>Research APIs</span>
          <strong>{health?.research_apis ? 'enabled' : 'disabled'}</strong>
        </div>
        <div className="status-row">
          <span>AI API</span>
          <strong>{health?.ai_api ? 'enabled' : 'disabled'}</strong>
        </div>
      </div>
    </section>
  )
}
