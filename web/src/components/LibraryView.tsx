/**
 * Current file: web/src/components/LibraryView.tsx
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
import { useDeferredValue, useState } from 'react'
import type { MaterialSource, PublishedDeck } from '../types'

interface LibraryViewProps {
  materials: MaterialSource[]
  publishedDecks: PublishedDeck[]
  selectedDeckId: string
  selectedMaterialId: string
  onSelectDeck: (deckId: string) => void
  onSelectMaterial: (materialId: string) => void
  onOpenReview: (deckId: string) => void
  onOpenReader: (options?: { materialId?: string; cardId?: string }) => void
}

export const LibraryView = ({
  materials,
  publishedDecks,
  selectedDeckId,
  selectedMaterialId,
  onSelectDeck,
  onSelectMaterial,
  onOpenReview,
  onOpenReader,
}: LibraryViewProps) => {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()

  const filteredDecks = publishedDecks.filter((deck) => {
    if (!normalizedQuery) {
      return true
    }

    return [deck.title, deck.description, deck.tags.join(' '), deck.level]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  })

  const filteredMaterials = materials.filter((material) => {
    if (!normalizedQuery) {
      return true
    }

    return [material.title, material.summary, material.tags.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  })

  const selectedDeck =
    filteredDecks.find((deck) => deck.id === selectedDeckId) ?? filteredDecks[0]
  const selectedMaterial =
    filteredMaterials.find((material) => material.id === selectedMaterialId) ??
    filteredMaterials[0]

  return (
    <section className="view">
      <div className="panel view-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Kho deck và bài đọc được tổ chức để tìm lại thật nhanh.</h2>
          <p className="supporting-text">
            Chọn deck ở trái, xem preview ở phải rồi nhảy sang review hoặc reader
            mà không cần tìm lại thủ công.
          </p>
        </div>
        <label className="search-field">
          <span>Tìm theo chủ đề hoặc tag</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ví dụ: bệnh viện, OCR, hỏi đường"
          />
        </label>
      </div>

      <div className="library-grid">
        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Published decks</p>
              <h3>Bộ thẻ chính thức</h3>
            </div>
          </div>

          <div className="stack-list">
            {filteredDecks.map((deck) => (
              <button
                key={deck.id}
                type="button"
                className={`list-card ${deck.id === selectedDeck?.id ? 'is-selected' : ''}`}
                onClick={() => {
                  onSelectDeck(deck.id)
                  onSelectMaterial(deck.materialId)
                }}
              >
                <div className="list-card-head">
                  <strong>{deck.title}</strong>
                  <span className="tag-pill">{deck.level}</span>
                </div>
                <p>{deck.description}</p>
                <div className="tag-row">
                  {deck.tags.map((tag) => (
                    <span key={tag} className="tag-pill subdued">
                      {tag}
                    </span>
                  ))}
                </div>
                <span>{deck.cards.length} card</span>
              </button>
            ))}
          </div>

          {!filteredDecks.length && (
            <div className="empty-state subtle">
              Không có deck phù hợp với truy vấn hiện tại.
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Deck detail</p>
              <h3>{selectedDeck?.title ?? 'Chưa chọn deck'}</h3>
            </div>
            {selectedDeck && (
              <button
                type="button"
                className="primary-button"
                onClick={() => onOpenReview(selectedDeck.id)}
              >
                Review deck này
              </button>
            )}
          </div>

          {selectedDeck ? (
            <div className="stack-list">
              <div className="info-strip">
                <span>{selectedDeck.cards.length} thẻ</span>
                <span>{selectedDeck.tags.length} tag</span>
                <span>Material: {selectedDeck.materialId.replace('material-', '')}</span>
              </div>
              <p className="supporting-text">{selectedDeck.description}</p>
              {selectedDeck.cards.slice(0, 7).map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="list-row"
                  onClick={() => onOpenReader({ materialId: selectedDeck.materialId, cardId: card.id })}
                >
                  <div>
                    <strong>{card.hanzi}</strong>
                    <p>{card.meaningVi}</p>
                  </div>
                  <span>{card.pinyin}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state subtle">
              Chọn một deck để xem trước các flashcard chính thức.
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Materials</p>
              <h3>Tài liệu gốc</h3>
            </div>
          </div>

          <div className="stack-list">
            {filteredMaterials.map((material) => (
              <button
                key={material.id}
                type="button"
                className={`list-card ${
                  material.id === selectedMaterial?.id ? 'is-selected' : ''
                }`}
                onClick={() => onSelectMaterial(material.id)}
              >
                <div className="list-card-head">
                  <strong>{material.title}</strong>
                  <span className="tag-pill">{material.type}</span>
                </div>
                <p>{material.summary}</p>
                <span>
                  {material.sections.length} đoạn · {material.ocrMode}
                </span>
              </button>
            ))}
          </div>

          {!filteredMaterials.length && (
            <div className="empty-state subtle">
              Không tìm thấy tài liệu nào tương ứng.
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Material detail</p>
              <h3>{selectedMaterial?.title ?? 'Chưa chọn tài liệu'}</h3>
            </div>
            {selectedMaterial && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenReader({ materialId: selectedMaterial.id })}
              >
                Mở Reader
              </button>
            )}
          </div>

          {selectedMaterial ? (
            <div className="stack-list">
              <div className="info-strip">
                <span>{selectedMaterial.sections.length} đoạn</span>
                <span>{selectedMaterial.ocrMode}</span>
                <span>{selectedMaterial.linkedDeckIds.length} deck liên kết</span>
              </div>
              <p className="supporting-text">{selectedMaterial.summary}</p>
              {selectedMaterial.sections.map((section) => (
                <article key={section.id} className="section-preview">
                  <strong>{section.heading}</strong>
                  <p>{section.textZh}</p>
                  <span>{section.textVi}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state subtle">
              Chọn một tài liệu để xem nội dung và chuyển sang Reader.
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
