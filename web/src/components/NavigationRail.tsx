import type { TabId } from '../types'

interface NavigationRailProps {
  activeTab: TabId
  dueCount: number
  draftCount: number
  audioReady: boolean
  lastUpdatedLabel: string
  onSelect: (tab: TabId) => void
}

const navItems: Array<{
  id: TabId
  icon: string
  label: string
  description: string
}> = [
  { id: 'dashboard', icon: '◈', label: 'Dashboard', description: 'Nhịp học hôm nay' },
  { id: 'library',   icon: '▤',  label: 'Library',   description: 'Deck & tài liệu' },
  { id: 'review',    icon: '⬡',  label: 'Review',    description: 'Phiên ôn tập' },
  { id: 'reader',    icon: '⊞',  label: 'Reader',    description: 'Đọc ngữ cảnh' },
  { id: 'drafts',    icon: '⊛',  label: 'Drafts',    description: 'Duyệt AI cards' },
]

export const NavigationRail = ({
  activeTab,
  dueCount,
  draftCount,
  audioReady,
  lastUpdatedLabel,
  onSelect,
}: NavigationRailProps) => (
  <aside className="navigation-rail">
    {/* Brand */}
    <div className="brand-block">
      <div className="brand-mark">汉</div>
      <div className="brand-name">
        <strong>Hanzi Lens</strong>
        <span>SRS · Reader · Drafts</span>
      </div>
    </div>

    {/* Navigation */}
    <nav>
      <ul className="nav-list" aria-label="Điều hướng chính">
        {navItems.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`nav-item ${item.id === activeTab ? 'is-active' : ''}`}
              onClick={() => onSelect(item.id)}
              aria-current={item.id === activeTab ? 'page' : undefined}
            >
              <span className="nav-item__icon" aria-hidden="true">
                {item.icon}
              </span>
              <div className="nav-item__text">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
              {item.id === 'review' && dueCount > 0 && (
                <span className="nav-badge" aria-label={`${dueCount} thẻ đến hạn`}>
                  {dueCount}
                </span>
              )}
              {item.id === 'drafts' && draftCount > 0 && (
                <span className="nav-badge" aria-label={`${draftCount} draft chờ duyệt`}>
                  {draftCount}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>

    {/* Footer stats */}
    <div className="rail-footer">
      <div className="rail-stat-row">
        <div className="rail-stat is-accent">
          <span>Đến hạn</span>
          <strong>{dueCount}</strong>
        </div>
        <div className="rail-stat">
          <span>Draft</span>
          <strong>{draftCount}</strong>
        </div>
      </div>
      <div className="rail-stat">
        <span>Audio</span>
        <strong style={{ fontSize: '0.82rem', fontFamily: 'inherit' }}>
          {audioReady ? '✓ zh voice' : '✗ unavail'}
        </strong>
      </div>
      <div className="rail-stat">
        <span>Cập nhật</span>
        <strong style={{ fontSize: '0.8rem', fontFamily: 'inherit', lineHeight: 1.35 }}>
          {lastUpdatedLabel}
        </strong>
      </div>
    </div>
  </aside>
)
