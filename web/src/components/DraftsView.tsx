/**
 * Current file: web/src/components/DraftsView.tsx
 *
 * UI/UX related files (for redesign handoff):
 * - web/src/index.css
 * - web/src/main.tsx
 * - web/src/App.tsx
 * - web/src/components/NavigationRail.tsx
 * - web/src/components/DashboardView.tsx
 * - web/src/components/LibraryView.tsx
 * - web/src/components/ReviewView.tsx
 * - web/src/components/ReaderView.tsx
 * - web/src/components/DraftsView.tsx
 */
import { useEffect, useMemo, useState } from 'react'
import {
  applyDraftOverrides,
  buildAnkiCsv,
  buildPublishedDeckFromDraft,
  type DraftCardOverride,
} from '../lib/exporters'
import type { DraftDeck } from '../types'

interface DraftsViewProps {
  draftDecks: DraftDeck[]
  selectedDraftDeckId: string
  onSelectDraftDeck: (deckId: string) => void
}

const readDraftOverrides = (deckId: string | undefined) => {
  if (!deckId) {
    return {}
  }

  const persisted = window.localStorage.getItem(`draft-overrides:${deckId}`)

  return persisted ? (JSON.parse(persisted) as Record<string, DraftCardOverride>) : {}
}

const downloadTextFile = (
  filename: string,
  content: string,
  contentType: string,
) => {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  anchor.click()

  URL.revokeObjectURL(url)
}

export const DraftsView = ({
  draftDecks,
  selectedDraftDeckId,
  onSelectDraftDeck,
}: DraftsViewProps) => {
  const activeDeck =
    draftDecks.find((deck) => deck.id === selectedDraftDeckId) ?? draftDecks[0]
  const [overrides, setOverrides] = useState<Record<string, DraftCardOverride>>(() =>
    readDraftOverrides(activeDeck?.id),
  )

  useEffect(() => {
    if (!activeDeck) {
      return
    }

    window.localStorage.setItem(
      `draft-overrides:${activeDeck.id}`,
      JSON.stringify(overrides),
    )
  }, [activeDeck, overrides])

  const resolvedCards = useMemo(
    () => (activeDeck ? applyDraftOverrides(activeDeck.cards, overrides) : []),
    [activeDeck, overrides],
  )

  const publishDeck = useMemo(
    () => (activeDeck ? buildPublishedDeckFromDraft(activeDeck, overrides) : null),
    [activeDeck, overrides],
  )

  const duplicateCount = useMemo(() => {
    const seen = new Set<string>()
    let duplicates = 0

    for (const card of resolvedCards) {
      if (seen.has(card.hanzi)) {
        duplicates += 1
      } else {
        seen.add(card.hanzi)
      }
    }

    return duplicates
  }, [resolvedCards])

  const updateOverride = (cardId: string, patch: DraftCardOverride) => {
    setOverrides((current) => ({
      ...current,
      [cardId]: {
        ...current[cardId],
        ...patch,
      },
    }))
  }

  const approveAll = () => {
    if (!activeDeck) {
      return
    }

    setOverrides((current) =>
      activeDeck.cards.reduce<Record<string, DraftCardOverride>>(
        (accumulator, card) => {
          accumulator[card.id] = {
            ...current[card.id],
            status: 'approved',
          }
          return accumulator
        },
        { ...current },
      ),
    )
  }

  const mergeDuplicates = () => {
    if (!activeDeck) {
      return
    }

    const ownerByHanzi = new Map<string, string>()

    setOverrides((current) =>
      activeDeck.cards.reduce<Record<string, DraftCardOverride>>(
        (accumulator, card) => {
          const ownerId = ownerByHanzi.get(card.hanzi)

          if (!ownerId) {
            ownerByHanzi.set(card.hanzi, card.id)
            accumulator[card.id] = {
              ...current[card.id],
              mergedInto: null,
            }
            return accumulator
          }

          accumulator[card.id] = {
            ...current[card.id],
            mergedInto: ownerId,
            status: 'approved',
          }
          return accumulator
        },
        { ...current },
      ),
    )
  }

  return (
    <section className="view">
      <div className="panel view-header">
        <div>
          <p className="eyebrow">Draft review</p>
          <h2>Duyệt thẻ AI theo kiểu hàng chờ, để publish an toàn hơn.</h2>
          <p className="supporting-text">
            Mục này ưu tiên thao tác biên tập: xem confidence, sửa nghĩa, gộp
            trùng và xuất JSON hoặc CSV sau khi ổn.
          </p>
        </div>

        <label className="filter-field">
          <span>Draft deck</span>
          <select
            value={activeDeck?.id ?? ''}
            onChange={(event) => onSelectDraftDeck(event.target.value)}
          >
            {draftDecks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeDeck ? (
        <>
          <div className="draft-toolbar panel">
            <div>
              <p className="eyebrow">Pipeline</p>
              <h3>{activeDeck.title}</h3>
              <p className="supporting-text">
                {activeDeck.description} · Model: {activeDeck.model}
              </p>
              <div className="info-strip">
                <span>{activeDeck.cards.length} draft card</span>
                <span>{activeDeck.notes.length} ghi chú</span>
                <span>{activeDeck.level}</span>
              </div>
            </div>

            <div className="toolbar-actions">
              <button type="button" className="secondary-button" onClick={approveAll}>
                Duyệt nhanh toàn bộ
              </button>
              <button type="button" className="secondary-button" onClick={mergeDuplicates}>
                Gộp thẻ trùng
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  publishDeck &&
                  downloadTextFile(
                    `${publishDeck.id}.json`,
                    JSON.stringify(publishDeck, null, 2),
                    'application/json',
                  )
                }
              >
                Tải JSON publish
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  publishDeck &&
                  downloadTextFile(
                    `${publishDeck.id}.csv`,
                    buildAnkiCsv(publishDeck.cards),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                Tải CSV Anki
              </button>
            </div>
          </div>

          <div className="metric-grid">
            <article className="metric-card panel">
              <span className="eyebrow">Draft cards</span>
              <strong>{resolvedCards.length}</strong>
              <p>Tổng số thẻ AI đã sinh từ tài liệu nguồn.</p>
            </article>
            <article className="metric-card panel">
              <span className="eyebrow">Publishable</span>
              <strong>{publishDeck?.cards.length ?? 0}</strong>
              <p>Số thẻ sẽ đi vào deck chính thức sau khi export.</p>
            </article>
            <article className="metric-card panel">
              <span className="eyebrow">Duplicates</span>
              <strong>{duplicateCount}</strong>
              <p>Ứng viên có hanzi lặp, nên gộp trước khi publish.</p>
            </article>
          </div>

          <div className="draft-list">
            {resolvedCards.map((card) => (
              <article key={card.id} className="panel draft-card">
                <div className="draft-card-head">
                  <div>
                    <span className="eyebrow">confidence {card.confidence.toFixed(2)}</span>
                    <h3>{card.hanzi}</h3>
                    <p>{card.pinyin}</p>
                  </div>
                  <div className="status-toggle">
                    {(['draft', 'approved', 'rejected'] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={card.status === status ? 'is-active' : ''}
                        onClick={() => updateOverride(card.id, { status })}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="draft-form-grid">
                  <label>
                    <span>Nghĩa tiếng Việt</span>
                    <textarea
                      value={card.meaningVi}
                      onChange={(event) =>
                        updateOverride(card.id, { meaningVi: event.target.value })
                      }
                    />
                  </label>

                  <label>
                    <span>Ví dụ tiếng Trung</span>
                    <textarea
                      value={card.exampleZh}
                      onChange={(event) =>
                        updateOverride(card.id, { exampleZh: event.target.value })
                      }
                    />
                  </label>

                  <label>
                    <span>Dịch câu ví dụ</span>
                    <textarea
                      value={card.exampleVi}
                      onChange={(event) =>
                        updateOverride(card.id, { exampleVi: event.target.value })
                      }
                    />
                  </label>

                  <label>
                    <span>Gộp vào card ID</span>
                    <input
                      type="text"
                      value={card.mergedInto ?? ''}
                      onChange={(event) =>
                        updateOverride(card.id, {
                          mergedInto: event.target.value || null,
                        })
                      }
                      placeholder="để trống nếu giữ riêng"
                    />
                  </label>
                </div>

                <p className="supporting-text">Nguồn: {card.sourceSnippet}</p>
                <div className="info-strip">
                  <span>ID: {card.id}</span>
                  <span>{card.status}</span>
                </div>
                <div className="tag-row">
                  {card.tags.map((tag) => (
                    <span key={tag} className="tag-pill subdued">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="panel empty-state">Chưa có draft deck để duyệt.</div>
      )}
    </section>
  )
}
