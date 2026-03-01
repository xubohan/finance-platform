import { useRef, useState } from 'react'

import { getAIResult, runAI, subscribeAI } from '../api/ai'
import AgentProgress from '../components/ai/AgentProgress'
import AIReportPanel from '../components/ai/AIReportPanel'

export default function AIAnalysisPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [taskId, setTaskId] = useState('')
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [report, setReport] = useState<Record<string, any> | null>(null)
  const [running, setRunning] = useState(false)

  const sourceRef = useRef<EventSource | null>(null)

  const start = async () => {
    setRunning(true)
    setReport(null)
    try {
      const { task_id } = await runAI(symbol)
      setTaskId(task_id)
      setStatus('running')

      sourceRef.current?.close()
      sourceRef.current = subscribeAI(task_id, async (payload) => {
        setStatus(payload.status || 'running')
        setMessage(payload.message || '')

        if (payload.status === 'done') {
          sourceRef.current?.close()
          const data = await getAIResult(task_id)
          setReport(data)
          setRunning(false)
        }
        if (payload.status === 'failed') {
          sourceRef.current?.close()
          setRunning(false)
        }
      })
    } catch {
      setStatus('failed')
      setMessage('Failed to start AI analysis')
      setRunning(false)
    }
  }

  return (
    <section className="page-card">
      <h2>AI Analysis</h2>
      <p style={{ marginBottom: 12 }}>Run agent workflow and stream progress in real time.</p>

      <div className="form-row">
        <input className="text-input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <button className="primary-btn" type="button" onClick={start} disabled={running}>
          {running ? 'Running...' : 'Run AI'}
        </button>
      </div>

      {taskId ? <p style={{ marginTop: 10, color: '#4d6485' }}>Task ID: {taskId}</p> : null}
      <AgentProgress status={status} message={message} />
      <AIReportPanel report={report} />
    </section>
  )
}
