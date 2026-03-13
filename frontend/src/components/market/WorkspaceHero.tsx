type Props = {
  onResetWorkspace: () => void
}

export default function WorkspaceHero({ onResetWorkspace }: Props) {
  return (
    <div className="workspace-hero">
      <div>
        <p className="eyebrow">Single Source Of Truth</p>
        <h2>Market Workspace</h2>
        <p className="hero-copy">
          先选标的，再看实时行情与 K 线，同步本地历史，最后直接在同一页跑单标的回测。
        </p>
      </div>
      <div className="hero-actions">
        <button className="secondary-btn" type="button" onClick={onResetWorkspace}>
          恢复默认工作区
        </button>
      </div>
    </div>
  )
}
