/**
 * Current file: web/src/components/ReaderView.tsx
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

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChineseVoiceOption, VoiceGenderMode } from '../hooks/useSpeech'
import { getCardExampleDisplayState } from '../lib/cardExample'
import type {
  MaterialSource,
  PublishedCard,
  ReviewNavigationOptions,
  StudyRecordMap,
} from '../types'

interface ReaderViewProps {
  materials: MaterialSource[]
  cardsById: Map<string, PublishedCard>
  selectedMaterialId: string
  highlightedCardId: string | null
  records: StudyRecordMap
  hasChineseVoice: boolean
  hasMaleChineseVoice: boolean
  hasFemaleChineseVoice: boolean
  voiceMode: VoiceGenderMode
  selectedVoiceUri: string
  voiceOptions: ChineseVoiceOption[]
  onSelectMaterial: (materialId: string) => void
  onHighlightCard: (cardId: string | null) => void
  onChangeVoiceMode: (mode: VoiceGenderMode) => void
  onChangeSelectedVoiceUri: (voiceUri: string) => void
  onOpenReview: (options?: ReviewNavigationOptions) => void
  onSpeak: (text: string) => void
}

export const ReaderView = ({
  materials,
  cardsById,
  selectedMaterialId,
  highlightedCardId,
  records,
  hasChineseVoice,
  hasMaleChineseVoice,
  hasFemaleChineseVoice,
  voiceMode,
  selectedVoiceUri,
  voiceOptions,
  onSelectMaterial,
  onHighlightCard,
  onChangeVoiceMode,
  onChangeSelectedVoiceUri,
  onOpenReview,
  onSpeak,
}: ReaderViewProps) => {
  const cardContextRef = useRef<HTMLElement | null>(null)
  const sectionRefMap = useRef<Record<string, HTMLElement | null>>({})
  const sentenceRefMap = useRef<Record<string, HTMLButtonElement | null>>({})
  const activeTokenRef = useRef<HTMLButtonElement | null>(null)
  const readingRunRef = useRef(0)
  const [activeReadingSectionId, setActiveReadingSectionId] = useState<string | null>(null)
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isShadowing, setIsShadowing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [cardSearchQuery, setCardSearchQuery] = useState('')
  const [showSectionPinyin, setShowSectionPinyin] = useState<boolean>(() => {
    const saved = window.localStorage.getItem('reader-show-section-pinyin')
    return saved === 'true'
  })
  const [showSectionMeaning, setShowSectionMeaning] = useState<boolean>(() => {
    const saved = window.localStorage.getItem('reader-show-section-meaning')
    return saved === 'true'
  })
  const [shadowingWaitSeconds, setShadowingWaitSeconds] = useState<number>(() => {
    const raw = window.localStorage.getItem('reader-shadowing-wait-seconds')
    const parsed = raw ? Number(raw) : 1.8
    if (Number.isFinite(parsed)) {
      return Math.max(0.5, Math.min(6, parsed))
    }
    return 1.8
  })
  const [autoFollowReading, setAutoFollowReading] = useState<boolean>(() => {
    const raw = window.localStorage.getItem('reader-auto-follow')
    if (raw === 'false') return false
    return true
  })

  const selectedMaterial =
    materials.find((material) => material.id === selectedMaterialId) ?? materials[0]
  const focusCardIds = useMemo(
    () => selectedMaterial?.sections.flatMap((section) => section.focusCardIds) ?? [],
    [selectedMaterial],
  )
  const highlightedCard = highlightedCardId
    ? cardsById.get(highlightedCardId)
    : undefined
  const fallbackCard = focusCardIds[0] ? cardsById.get(focusCardIds[0]) : undefined
  const selectedCard = highlightedCard ?? fallbackCard
  const selectedCardExampleState = selectedCard
    ? getCardExampleDisplayState(selectedCard)
    : {
        hasDistinctExample: false,
        showExampleZh: false,
        showExamplePinyin: false,
        showExampleVi: false,
      }
  const normalizedCardQuery = cardSearchQuery.trim().toLowerCase()
  const contextCards = useMemo(
    () =>
      focusCardIds
        .map((cardId) => cardsById.get(cardId))
        .filter((card): card is PublishedCard => Boolean(card)),
    [cardsById, focusCardIds],
  )
  const filteredContextCards = useMemo(() => {
    if (!normalizedCardQuery) {
      return contextCards
    }
    return contextCards.filter((card) =>
      [card.hanzi, card.pinyin, card.meaningVi, card.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalizedCardQuery),
    )
  }, [contextCards, normalizedCardQuery])
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredMaterials = useMemo(() => {
    if (!normalizedQuery) {
      return materials
    }
    return materials.filter((material) =>
      [material.title, material.summary, material.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  }, [materials, normalizedQuery])

  const getSectionSentences = (text: string) => {
    const compact = text.replace(/\n+/g, '')
    const matches = compact.match(/[^。！？；!?;]+[。！？；!?;]?/g) ?? []
    return matches.map((sentence) => sentence.trim()).filter(Boolean)
  }

  const getChineseVoice = () => {
    const voices = window.speechSynthesis?.getVoices?.() ?? []
    return (
      voices.find((voice) => voice.lang === 'zh-CN') ??
      voices.find((voice) => voice.lang === 'zh-TW') ??
      voices.find((voice) => voice.lang.startsWith('zh')) ??
      null
    )
  }

  const speakZh = (text: string, runId: number) =>
    new Promise<void>((resolve) => {
      if (!text || !('speechSynthesis' in window)) {
        resolve()
        return
      }

      const utterance = new SpeechSynthesisUtterance(text)
      const voice = getChineseVoice()
      utterance.lang = voice?.lang ?? 'zh-CN'
      if (voice) {
        utterance.voice = voice
      }

      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()

      if (readingRunRef.current !== runId) {
        resolve()
        return
      }

      window.speechSynthesis.speak(utterance)
    })

  const sleep = (ms: number, runId: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(() => {
        if (readingRunRef.current === runId) {
          resolve()
          return
        }
        resolve()
      }, ms)
    })

  const stopReading = () => {
    readingRunRef.current += 1
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setIsReading(false)
    setIsShadowing(false)
    setActiveReadingSectionId(null)
    setActiveSentenceIndex(null)
  }

  const runSectionReading = async (sectionId: string, shadowing: boolean) => {
    const section = selectedMaterial?.sections.find((item) => item.id === sectionId)
    if (!section) {
      return
    }

    const sentences = getSectionSentences(section.textZh)
    if (sentences.length === 0) {
      return
    }

    const runId = readingRunRef.current + 1
    readingRunRef.current = runId
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    setIsReading(true)
    setIsShadowing(shadowing)
    setActiveReadingSectionId(sectionId)

    for (let index = 0; index < sentences.length; index += 1) {
      if (readingRunRef.current !== runId) {
        return
      }

      setActiveSentenceIndex(index)
      await speakZh(sentences[index], runId)

      if (shadowing) {
        await sleep(Math.round(shadowingWaitSeconds * 1000), runId)
      } else {
        await sleep(180, runId)
      }
    }

    if (readingRunRef.current === runId) {
      setIsReading(false)
      setIsShadowing(false)
      setActiveSentenceIndex(null)
    }
  }

  const speakSentence = (sectionId: string, sentenceIndex: number) => {
    const section = selectedMaterial?.sections.find((item) => item.id === sectionId)
    if (!section) {
      return
    }

    const sentences = getSectionSentences(section.textZh)
    const sentence = sentences[sentenceIndex]
    if (!sentence) {
      return
    }

    const runId = readingRunRef.current + 1
    readingRunRef.current = runId
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }

    setIsReading(true)
    setIsShadowing(false)
    setActiveReadingSectionId(sectionId)
    setActiveSentenceIndex(sentenceIndex)

    void speakZh(sentence, runId).then(() => {
      if (readingRunRef.current === runId) {
        setIsReading(false)
      }
    })
  }

  useEffect(() => {
    if (!selectedMaterial) {
      return
    }

    if (highlightedCardId && cardsById.has(highlightedCardId)) {
      return
    }

    onHighlightCard(focusCardIds[0] ?? null)
  }, [cardsById, focusCardIds, highlightedCardId, onHighlightCard, selectedMaterial])

  useEffect(() => {
    if (!cardContextRef.current || !highlightedCardId) {
      return
    }

    cardContextRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [highlightedCardId])

  useEffect(() => {
    window.localStorage.setItem(
      'reader-shadowing-wait-seconds',
      shadowingWaitSeconds.toFixed(1),
    )
  }, [shadowingWaitSeconds])

  useEffect(() => {
    window.localStorage.setItem('reader-auto-follow', autoFollowReading ? 'true' : 'false')
  }, [autoFollowReading])
  useEffect(() => {
    window.localStorage.setItem('reader-show-section-pinyin', showSectionPinyin ? 'true' : 'false')
  }, [showSectionPinyin])
  useEffect(() => {
    window.localStorage.setItem('reader-show-section-meaning', showSectionMeaning ? 'true' : 'false')
  }, [showSectionMeaning])

  useEffect(() => {
    if (!autoFollowReading || !activeReadingSectionId) {
      return
    }
    const sectionNode = sectionRefMap.current[activeReadingSectionId]
    if (sectionNode) {
      sectionNode.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [activeReadingSectionId, autoFollowReading])

  useEffect(() => {
    if (!autoFollowReading || !activeReadingSectionId || activeSentenceIndex === null) {
      return
    }
    const sentenceNode =
      sentenceRefMap.current[`${activeReadingSectionId}-${activeSentenceIndex}`]
    if (sentenceNode) {
      sentenceNode.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [activeReadingSectionId, activeSentenceIndex, autoFollowReading])

  useEffect(() => {
    if (!autoFollowReading || !activeTokenRef.current) {
      return
    }
    activeTokenRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [highlightedCardId, autoFollowReading])

  useEffect(
    () => () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    },
    [],
  )

  return (
    <section className="view">
      <div className="panel view-header">
        <div>
          <p className="eyebrow">Reader</p>
          <h2>Đọc tài liệu như một bài thật, nhưng mọi từ trọng tâm đều chạm được.</h2>
          <p className="supporting-text">
            Chọn tài liệu ở trái, đọc phần giữa và xem card ngữ cảnh ở phải để
            tránh học tách rời khỏi bài gốc.
          </p>
        </div>
        <div className="review-header-controls">
          <label className="filter-field" style={{ minWidth: '10rem' }}>
            <span>Giọng đọc tiếng Trung</span>
            <select
              value={voiceMode}
              onChange={(event) => onChangeVoiceMode(event.target.value as VoiceGenderMode)}
              disabled={!hasChineseVoice}
            >
              <option value="auto">Tự động</option>
              <option value="male">Nam (ưu tiên)</option>
              <option value="female">Nữ (ưu tiên)</option>
            </select>
          </label>
          <label className="filter-field" style={{ minWidth: '14rem' }}>
            <span>Giọng cụ thể</span>
            <select
              value={selectedVoiceUri}
              onChange={(event) => onChangeSelectedVoiceUri(event.target.value)}
              disabled={!hasChineseVoice}
            >
              <option value="">Mặc định theo chế độ</option>
              {voiceOptions.map((voice) => (
                <option key={voice.uri} value={voice.uri}>
                  {voice.label}
                </option>
              ))}
            </select>
          </label>
          {voiceMode === 'male' && !hasMaleChineseVoice && (
            <p className="review-shortcut-tip">Thiết bị chưa có giọng nam tiếng Trung, đang fallback sang giọng khả dụng.</p>
          )}
          {voiceMode === 'female' && !hasFemaleChineseVoice && (
            <p className="review-shortcut-tip">Thiết bị chưa có giọng nữ tiếng Trung, đang fallback sang giọng khả dụng.</p>
          )}
          <button
            type="button"
            className={`ghost-button compact-button ${showSectionPinyin ? 'is-active' : ''}`}
            onClick={() => setShowSectionPinyin((value) => !value)}
          >
            {showSectionPinyin ? 'Phiên âm: Hiện' : 'Phiên âm: Ẩn'}
          </button>
          <button
            type="button"
            className={`ghost-button compact-button ${showSectionMeaning ? 'is-active' : ''}`}
            onClick={() => setShowSectionMeaning((value) => !value)}
          >
            {showSectionMeaning ? 'Nghĩa: Hiện' : 'Nghĩa: Ẩn'}
          </button>
        </div>
      </div>

      <div className="reader-grid">
        <aside className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Material list</p>
              <h3>Tài liệu đang có</h3>
            </div>
          </div>

          <label className="search-field">
            <span>Tìm tài liệu / chủ đề</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="ví dụ: y tế, du lịch, blog"
            />
          </label>

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
                  <span className="tag-pill">{material.ocrMode}</span>
                </div>
                <p>{material.summary}</p>
              </button>
            ))}
          </div>
        </aside>

        <article className="panel reader-stage">
          {selectedMaterial ? (
            <>
              <header className="reader-header">
                <div>
                  <p className="eyebrow">{selectedMaterial.type}</p>
                  <h3>{selectedMaterial.title}</h3>
                  <p className="supporting-text">{selectedMaterial.summary}</p>
                </div>
                <div className="tag-row">
                  {selectedMaterial.tags.map((tag) => (
                    <span key={tag} className="tag-pill subdued">
                      {tag}
                    </span>
                  ))}
                </div>
              </header>

              <div className="info-strip">
                <span>{selectedMaterial.sections.length} đoạn</span>
                <span>{selectedMaterial.linkedDeckIds.length} deck liên kết</span>
                <span>{selectedMaterial.ocrMode}</span>
              </div>

              <div className="reader-sections">
                {selectedMaterial.sections.map((section) => (
                  <section
                    key={section.id}
                    className="reader-section"
                    ref={(node) => {
                      sectionRefMap.current[section.id] = node
                    }}
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">Section</p>
                        <h4>{section.heading}</h4>
                      </div>
                    </div>

                    <div className="reader-zh">
                      {(section.segments ?? [{ text: section.textZh }]).map((segment, index) => {
                        const card = segment.cardId ? cardsById.get(segment.cardId) : undefined
                        const studied = card ? Boolean(records[card.id]) : false

                        if (!card) {
                          return <span key={`${section.id}-${index}`}>{segment.text}</span>
                        }

                        return (
                          <button
                            key={`${section.id}-${index}`}
                            type="button"
                            className={`reader-token ${
                              highlightedCardId === card.id ? 'is-active' : ''
                            } ${studied ? 'is-studied' : ''}`}
                            ref={(node) => {
                              if (highlightedCardId === card.id) {
                                activeTokenRef.current = node
                              }
                            }}
                            onClick={() => onHighlightCard(card.id)}
                          >
                            {segment.text}
                          </button>
                        )
                      })}
                    </div>
                    {showSectionPinyin && section.textPinyin && (
                      <p className="reader-pinyin">{section.textPinyin}</p>
                    )}
                    {showSectionMeaning && (
                      <p className="reader-translation">{section.textVi}</p>
                    )}

                      <div className="reading-practice">
                      <div className="reading-practice__header">
                        <p className="eyebrow">Tập đọc</p>
                        <div className="reading-controls">
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => runSectionReading(section.id, false)}
                          >
                            Đọc toàn đoạn
                          </button>
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => runSectionReading(section.id, true)}
                          >
                            Shadowing
                          </button>
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={stopReading}
                          >
                            Dừng
                          </button>
                        </div>
                      </div>

                      <div className="reading-settings">
                        <label>
                          <span>Shadowing chờ: {shadowingWaitSeconds.toFixed(1)}s</span>
                          <input
                            type="range"
                            min={0.5}
                            max={6}
                            step={0.5}
                            value={shadowingWaitSeconds}
                            onChange={(event) =>
                              setShadowingWaitSeconds(Number(event.target.value))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className={`ghost-button compact-button ${
                            autoFollowReading ? 'is-active' : ''
                          }`}
                          onClick={() => setAutoFollowReading((value) => !value)}
                        >
                          {autoFollowReading ? 'Auto-follow: Bật' : 'Auto-follow: Tắt'}
                        </button>
                      </div>

                      <p className="supporting-text">
                        {isReading && activeReadingSectionId === section.id
                          ? isShadowing
                            ? 'Shadowing đang chạy: nghe 1 câu rồi nhại lại trước khi sang câu tiếp.'
                            : 'Đang đọc toàn đoạn. Câu đang phát được highlight bên dưới.'
                          : 'Gợi ý: bấm Shadowing để nghe theo cụm câu và nhại lại ngay.'}
                      </p>

                      <div className="reading-sentences">
                        {getSectionSentences(section.textZh).map((sentence, sentenceIndex) => (
                          <button
                            key={`${section.id}-sentence-${sentenceIndex}`}
                            type="button"
                            className={`reading-sentence ${
                              activeReadingSectionId === section.id &&
                              activeSentenceIndex === sentenceIndex
                                ? 'is-active'
                                : ''
                            }`}
                            ref={(node) => {
                              sentenceRefMap.current[`${section.id}-${sentenceIndex}`] = node
                            }}
                            onClick={() => speakSentence(section.id, sentenceIndex)}
                          >
                            {sentence}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">Không có tài liệu để hiển thị.</div>
          )}
        </article>

        <aside className="panel reader-context-panel" ref={cardContextRef}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Card context</p>
              <h3>{selectedCard?.hanzi ?? 'Chọn một từ trong bài'}</h3>
            </div>
            {selectedCard && (
              <div className="reading-controls">
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() =>
                    onOpenReview({
                      deckId: selectedCard.deckId,
                      startCardId: selectedCard.id,
                    })
                  }
                >
                  Review deck
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => onSpeak(selectedCard.audioText)}
                >
                  Nghe từ này
                </button>
              </div>
            )}
          </div>
          <label className="search-field" style={{ marginBottom: '0.7rem' }}>
            <span>Tìm nhanh từ trong bài</span>
            <input
              type="search"
              value={cardSearchQuery}
              onChange={(event) => setCardSearchQuery(event.target.value)}
              placeholder="Hanzi / pinyin / nghĩa"
            />
          </label>
          {filteredContextCards.length > 0 && (
            <div className="stack-list" style={{ marginBottom: '0.9rem', maxHeight: '13.5rem', overflowY: 'auto' }}>
              {filteredContextCards.slice(0, 12).map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className={`list-row ${selectedCard?.id === card.id ? 'is-selected' : ''}`}
                  onClick={() => onHighlightCard(card.id)}
                  style={{ padding: '0.55rem 0.75rem' }}
                >
                  <div>
                    <strong>{card.hanzi}</strong>
                    {showSectionPinyin && <p style={{ marginTop: '0.05rem' }}>{card.pinyin}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedCard ? (
            <div className="card-context">
              {(showSectionPinyin || showSectionMeaning) && (
                <div className="answer-grid">
                  {showSectionPinyin && (
                    <div>
                      <span className="answer-label">Pinyin</span>
                      <strong>{selectedCard.pinyin}</strong>
                    </div>
                  )}
                  {showSectionMeaning && (
                    <div>
                      <span className="answer-label">Nghĩa</span>
                      <strong>{selectedCard.meaningVi}</strong>
                    </div>
                  )}
                </div>
              )}
              {selectedCardExampleState.showExampleZh && (
                <p className="answer-example">{selectedCard.exampleZh}</p>
              )}
              {showSectionPinyin &&
                selectedCardExampleState.showExamplePinyin &&
                selectedCard.examplePinyin && (
                <p className="answer-translation" style={{ color: 'var(--jade)', borderLeftColor: 'var(--jade-border)' }}>
                  {selectedCard.examplePinyin}
                </p>
              )}
              {showSectionMeaning && selectedCardExampleState.showExampleVi && (
                <p className="answer-translation">{selectedCard.exampleVi}</p>
              )}
              <div className="info-strip">
                <span>{selectedCard.tags.join(' · ')}</span>
              </div>
              <span className="tag-pill subdued">
                {records[selectedCard.id] ? 'Đã có lịch ôn' : 'Chưa bắt đầu review'}
              </span>
            </div>
          ) : (
            <div className="empty-state subtle">
              Bấm vào một token được đánh dấu để xem flashcard tương ứng.
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
