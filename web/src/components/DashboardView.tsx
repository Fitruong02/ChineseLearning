import type { DraftDeck, MaterialSource, PublishedCard, PublishedDeck, StudyRecordMap } from '../types'
import { formatRelativeDue, isTroubleRecord } from '../lib/srs'

interface DashboardViewProps {
  materials: MaterialSource[]
  publishedDecks: PublishedDeck[]
  draftDecks: DraftDeck[]
  dueCards: PublishedCard[]
  records: StudyRecordMap
  onOpenReview: (deckId?: string) => void
  onOpenReader: (options?: { materialId?: string; cardId?: string }) => void
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

export const DashboardView = ({
  materials,
  publishedDecks,
  draftDecks,
  dueCards,
  records,
  onOpenReview,
  onOpenReader,
}: DashboardViewProps) => {
  const reviewedToday = Object.values(records).filter((r) =>
    sameDay(new Date(r.lastReviewedAt), new Date()),
  ).length

  const deckById = new Map(publishedDecks.map((d) => [d.id, d]))
  const troubleCards = publishedDecks
    .flatMap((d) => d.cards)
    .filter((c) => isTroubleRecord(records[c.id]))
    .slice(0, 5)

  const totalCards = publishedDecks.reduce((n, d) => n + d.cards.length, 0)
  const pendingDrafts = draftDecks.reduce(
    (n, d) => n + d.cards.filter((c) => c.status !== 'rejected').length,
    0,
  )
  const nextMaterial = materials[0]

  return (
    <section className="view view-dashboard">
      {/* Hero */}
      <div className="hero-panel panel">
        <div className="hero-panel__lead">
          <div>
            <p className="eyebrow">Study pulse</p>
            <h2>Học từ tài liệu thật, chốt trí nhớ bằng nhịp review gọn.</h2>
            <p className="supporting-text">
              Ba việc cốt lõi mỗi ngày: biết hôm nay cần ôn gì, quay lại ngữ cảnh gốc
              thật nhanh, và đẩy draft AI sang deck chính thức an toàn.
            </p>
          </div>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => onOpenReview()}>
              Bắt đầu ôn ngay
            </button>
            {nextMaterial && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenReader({ materialId: nextMaterial.id })}
              >
                Mở bài đọc gần nhất
              </button>
            )}
          </div>
        </div>

        <div className="hero-plan">
          <p className="eyebrow">Kế hoạch hôm nay</p>
          <ul className="hero-plan__list">
            <li>{dueCards.length} thẻ đang đến hạn để review.</li>
            <li>{reviewedToday} thẻ đã được chấm trong hôm nay.</li>
            <li>{pendingDrafts} draft đang chờ dọn trước khi publish.</li>
            <li>{troubleCards.length} thẻ cần cứu vì quên lặp lại.</li>
          </ul>
          {nextMaterial && (
            <button
              type="button"
              className="ghost-button"
              style={{ marginTop: '0.25rem' }}
              onClick={() => onOpenReader({ materialId: nextMaterial.id })}
            >
              Đọc tiếp: {nextMaterial.title}
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="metric-grid">
        <article className="metric-card panel accent">
          <span className="eyebrow">Đến hạn</span>
          <strong>{dueCards.length}</strong>
          <p>Flashcard đang chờ ôn trong phiên hiện tại.</p>
        </article>
        <article className="metric-card panel">
          <span className="eyebrow">Đã học hôm nay</span>
          <strong>{reviewedToday}</strong>
          <p>Card đã được chấm lại và lưu vào IndexedDB.</p>
        </article>
        <article className="metric-card panel">
          <span className="eyebrow">Published cards</span>
          <strong>{totalCards}</strong>
          <p>Deck chính thức sẵn sàng review.</p>
        </article>
        <article className="metric-card panel warn">
          <span className="eyebrow">AI draft</span>
          <strong>{pendingDrafts}</strong>
          <p>Thẻ đang chờ duyệt trước khi publish.</p>
        </article>
      </div>

      {/* Dashboard grid */}
      <div className="dashboard-grid">
        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h3>Phiên ôn kế tiếp</h3>
            </div>
            <button type="button" className="ghost-button compact-button" onClick={() => onOpenReview()}>
              Mở review
            </button>
          </div>
          <div className="stack-list">
            {dueCards.slice(0, 6).map((card) => (
              <button
                key={card.id}
                type="button"
                className="list-row"
                onClick={() => onOpenReview(card.deckId)}
              >
                <div>
                  <strong>{card.hanzi}</strong>
                  <p>{deckById.get(card.deckId)?.title ?? 'Deck'} · {card.tags.slice(0, 2).join(' · ')}</p>
                </div>
                <span>{formatRelativeDue(records[card.id])}</span>
              </button>
            ))}
            {dueCards.length === 0 && (
              <div className="empty-state subtle">
                Không còn thẻ đến hạn. Mở Reader hoặc duyệt thêm draft AI.
              </div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Cần cứu</p>
              <h3>Trouble cards phiên tới</h3>
            </div>
          </div>
          <div className="stack-list">
            {troubleCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className="list-row"
                onClick={() => onOpenReview(card.deckId)}
              >
                <div>
                  <strong>{card.hanzi}</strong>
                  <p>{deckById.get(card.deckId)?.title ?? 'Deck'}</p>
                </div>
                <span>{records[card.id]?.lapseCount ?? 0} lapse</span>
              </button>
            ))}
            {troubleCards.length === 0 && (
              <div className="empty-state subtle">Chưa có trouble card. Nhịp học đang ổn.</div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Materials</p>
              <h3>Tài liệu nên đọc lại</h3>
            </div>
          </div>
          <div className="stack-list">
            {materials.map((m) => (
              <button
                key={m.id}
                type="button"
                className="list-row"
                onClick={() => onOpenReader({ materialId: m.id })}
              >
                <div>
                  <strong>{m.title}</strong>
                  <p>{m.summary}</p>
                </div>
                <span>{m.ocrMode}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Decks</p>
              <h3>Bộ thẻ đang hoạt động</h3>
            </div>
          </div>
          <div className="deck-row-grid">
            {publishedDecks.slice(0, 3).map((deck) => (
              <button
                key={deck.id}
                type="button"
                className="deck-tile"
                onClick={() => onOpenReview(deck.id)}
              >
                <span className="eyebrow">{deck.level}</span>
                <strong>{deck.title}</strong>
                <p>{deck.description}</p>
                <span>{deck.cards.length} thẻ</span>
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}
