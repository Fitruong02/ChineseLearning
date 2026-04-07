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
import type { MaterialSource, PublishedCard, StudyRecordMap } from '../types'

interface ReaderViewProps {
  materials: MaterialSource[]
  cardsById: Map<string, PublishedCard>
  selectedMaterialId: string
  highlightedCardId: string | null
  records: StudyRecordMap
  onSelectMaterial: (materialId: string) => void
  onHighlightCard: (cardId: string | null) => void
  onOpenReview: (deckId?: string) => void
}

export const ReaderView = ({
  materials,
  cardsById,
  selectedMaterialId,
  highlightedCardId,
  records,
  onSelectMaterial,
  onHighlightCard,
  onOpenReview,
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
      </div>

      <div className="reader-grid">
        <aside className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Material list</p>
              <h3>Tài liệu đang có</h3>
            </div>
          </div>

          <div className="stack-list">
            {materials.map((material) => (
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
                    <p className="reader-translation">{section.textVi}</p>

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
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenReview(selectedCard.deckId)}
              >
                Review deck
              </button>
            )}
          </div>

          {selectedCard ? (
            <div className="card-context">
              <div className="answer-grid">
                <div>
                  <span className="answer-label">Pinyin</span>
                  <strong>{selectedCard.pinyin}</strong>
                </div>
                <div>
                  <span className="answer-label">Nghĩa</span>
                  <strong>{selectedCard.meaningVi}</strong>
                </div>
              </div>
              <p className="answer-example">{selectedCard.exampleZh}</p>
              <p className="answer-translation">{selectedCard.exampleVi}</p>
              {selectedCard.imageUrl && (
                <div className="answer-image-block">
                  <img src={selectedCard.imageUrl} alt={selectedCard.hanzi} loading="lazy" />
                  {selectedCard.imageAttribution && (
                    <span className="image-attribution">{selectedCard.imageAttribution}</span>
                  )}
                </div>
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
