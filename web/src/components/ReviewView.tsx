import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatRelativeDue,
  isCardDue,
  isTroubleRecord,
  reviewTone,
} from '../lib/srs'
import type {
  MotionPreference,
  PhoneticMode,
  PublishedCard,
  PublishedDeck,
  ReviewMixMode,
  ReviewEase,
  ReviewSessionState,
  StudyRecordMap,
} from '../types'

interface ReviewViewProps {
  publishedDecks: PublishedDeck[]
  records: StudyRecordMap
  studyReady: boolean
  selectedDeckId: string
  sessionResetVersion: number
  immersiveMode: boolean
  themeMode: 'light' | 'dark'
  hasChineseVoice: boolean
  onSelectDeck: (deckId: string) => void
  onReview: (cardId: string, ease: ReviewEase, sessionContext?: { occurredAt?: string }) => void
  onSpeak: (text: string) => void
  onOpenReader: (options?: { materialId?: string; cardId?: string }) => void
  onResetSession: () => void
  onResetDeckProgress: (cardIds: string[]) => Promise<void>
  onResetAllProgress: () => Promise<void>
  onToggleImmersive: () => void
  onToggleTheme: () => void
}

const reviewActions: Array<{
  ease: ReviewEase
  label: string
  hint: string
  note: string
}> = [
  { ease: 'again', label: 'Chưa nhớ', hint: '1', note: 'Quay lại trong phiên' },
  { ease: 'hard',  label: 'Hơi nhớ',  hint: '2', note: 'Checkpoint cuối phiên' },
  { ease: 'good',  label: 'Nhớ được', hint: '3', note: 'Đúng nhịp SRS' },
]

type SoundCue = 'flip' | ReviewEase
type ResetAction = 'deck' | 'all' | null

const AGAIN_RELEARN_AFTER_CARDS = 3
const AGAIN_RELEARN_AFTER_MS = 90_000
const TROUBLE_SESSION_THRESHOLD = 2
const MILESTONE_STEP = 5
const DRILL_TARGET_STREAK = 2

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT')

const includeUnique = (items: string[], value: string) =>
  items.includes(value) ? items : [...items, value]

const removeValue = (items: string[], value: string) =>
  items.filter((item) => item !== value)

const getDefaultMotionPreference = (): MotionPreference => {
  if (
    typeof window !== 'undefined' &&
    'matchMedia' in window &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return 'reduced'
  }
  return 'full'
}

const createEmptySession = (motionPreference: MotionPreference): ReviewSessionState => ({
  initialCardIds: [],
  sessionQueue: [],
  relearnQueue: [],
  checkpointCardIds: [],
  pendingAgainCardIds: [],
  reviewedCardIds: [],
  completedCardIds: [],
  troubleCardIds: [],
  sessionAgainCounts: {},
  combo: 0,
  bestCombo: 0,
  answeredCount: 0,
  motionPreference,
  mixMode: 'random',
  phoneticMode: 'initial',
  focusDrillEnabled: false,
  drillQueue: [],
  drillStreakByCardId: {},
})

const sortCardsForSession = (cards: PublishedCard[], records: StudyRecordMap) =>
  [...cards].sort((l, r) => {
    const lr = records[l.id], rr = records[r.id]
    if (!lr && rr) return -1
    if (lr && !rr) return 1
    const d = (lr?.dueAt ?? '').localeCompare(rr?.dueAt ?? '')
    if (d !== 0) return d
    return l.hanzi.localeCompare(r.hanzi)
  })

const shuffleArray = <T,>(items: T[]) => {
  const output = [...items]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[output[index], output[swapIndex]] = [output[swapIndex], output[index]]
  }
  return output
}

const normalizePinyin = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const pinyinVowels = ['a', 'e', 'i', 'o', 'u', 'v']

const getPinyinInitialFinal = (rawPinyin: string) => {
  const token = normalizePinyin(rawPinyin).split(/\s+/)[0] ?? ''
  if (!token) {
    return { initial: 'other', final: 'other' }
  }
  const firstVowelIndex = [...token].findIndex((char) => pinyinVowels.includes(char))
  if (firstVowelIndex <= 0) {
    return {
      initial: firstVowelIndex === 0 ? 'zero-initial' : token,
      final: firstVowelIndex === 0 ? token : 'other',
    }
  }
  return {
    initial: token.slice(0, firstVowelIndex),
    final: token.slice(firstVowelIndex),
  }
}

const getLessonKey = (card: PublishedCard) =>
  card.tags.find((tag) => /^第.+课$/.test(tag)) ?? card.deckId

const buildInitialQueue = (
  cards: PublishedCard[],
  records: StudyRecordMap,
  mixMode: ReviewMixMode,
  phoneticMode: PhoneticMode,
  interleaveDecks: boolean,
  deckOrder: string[],
) => {
  const dueCards = sortCardsForSession(
    cards.filter((card) => isCardDue(records[card.id])),
    records,
  )
  if (mixMode === 'random') {
    return shuffleArray(dueCards).map((card) => card.id)
  }
  if (mixMode === 'by_lesson') {
    const groups = new Map<string, PublishedCard[]>()
    dueCards.forEach((card) => {
      const key = getLessonKey(card)
      const current = groups.get(key) ?? []
      current.push(card)
      groups.set(key, current)
    })
    const groupedQueue = [...groups.values()].flatMap((group) => group.map((card) => card.id))
    return groupedQueue
  }
  if (mixMode === 'by_phonetic') {
    const groups = new Map<string, PublishedCard[]>()
    dueCards.forEach((card) => {
      const { initial, final } = getPinyinInitialFinal(card.pinyin)
      const key = phoneticMode === 'initial' ? initial : final
      const current = groups.get(key) ?? []
      current.push(card)
      groups.set(key, current)
    })
    return [...groups.values()].flatMap((group) => group.map((card) => card.id))
  }
  if (!interleaveDecks) return dueCards.map((card) => card.id)
  const grouped = new Map<string, PublishedCard[]>()
  dueCards.forEach((card) => {
    const g = grouped.get(card.deckId) ?? []
    g.push(card)
    grouped.set(card.deckId, g)
  })
  const queue: string[] = []
  while (true) {
    let picked = false
    deckOrder.forEach((deckId) => {
      const g = grouped.get(deckId)
      if (!g?.length) return
      const next = g.shift()
      if (!next) return
      queue.push(next.id)
      picked = true
    })
    if (!picked) break
  }
  return queue
}

const buildCheckpointQueue = (checkpointCardIds: string[], troubleCardIds: string[]) => {
  const troubleSet = new Set(troubleCardIds)
  const trouble = checkpointCardIds.filter((id) => troubleSet.has(id))
  const stable = checkpointCardIds.filter((id) => !troubleSet.has(id))
  const queue: string[] = []
  while (trouble.length > 0 || stable.length > 0) {
    if (trouble.length > 0) queue.push(trouble.shift() as string)
    if (stable.length > 0) queue.push(stable.shift() as string)
  }
  return queue
}

const shouldPromptRecall = (lapseCount: number, sessionAgainCount: number, isTrouble: boolean) =>
  isTrouble || lapseCount >= 2 || sessionAgainCount > 0

const getRecallPrompt = (cardId: string, lapseCount: number, sessionAgainCount: number) => {
  const signal = cardId.length + lapseCount + sessionAgainCount
  return signal % 2 === 0
    ? 'Tự nhớ nghĩa tiếng Việt trước khi lật.'
    : 'Tự nhớ pinyin trước khi lật.'
}

export const ReviewView = ({
  publishedDecks,
  records,
  studyReady,
  selectedDeckId,
  sessionResetVersion,
  immersiveMode,
  themeMode,
  hasChineseVoice,
  onSelectDeck,
  onReview,
  onSpeak,
  onOpenReader,
  onResetSession,
  onResetDeckProgress,
  onResetAllProgress,
  onToggleImmersive,
  onToggleTheme,
}: ReviewViewProps) => {
  const deckOptions = useMemo(
    () => [
      { id: 'all', label: 'Tất cả deck' },
      ...publishedDecks.map((d) => ({ id: d.id, label: d.title })),
    ],
    [publishedDecks],
  )

  const deckOrder = useMemo(() => publishedDecks.map((d) => d.id), [publishedDecks])
  const deckById = useMemo(() => new Map(publishedDecks.map((d) => [d.id, d])), [publishedDecks])

  const activeCards = useMemo(() => {
    if (selectedDeckId === 'all') return publishedDecks.flatMap((d) => d.cards)
    return publishedDecks.find((d) => d.id === selectedDeckId)?.cards ?? []
  }, [publishedDecks, selectedDeckId])

  const cardsById = useMemo(() => new Map(activeCards.map((c) => [c.id, c])), [activeCards])

  const [revealed, setRevealed] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [motionPreference, setMotionPreference] = useState<MotionPreference>(getDefaultMotionPreference)
  const [mixMode, setMixMode] = useState<ReviewMixMode>(() => {
    const saved = window.localStorage.getItem('review-mix-mode')
    if (saved === 'random' || saved === 'by_lesson' || saved === 'by_phonetic') {
      return saved
    }
    return 'random'
  })
  const [phoneticMode, setPhoneticMode] = useState<PhoneticMode>(() => {
    const saved = window.localStorage.getItem('review-phonetic-mode')
    if (saved === 'initial' || saved === 'final') return saved
    return 'initial'
  })
  const [focusDrillEnabled, setFocusDrillEnabled] = useState<boolean>(() => {
    const saved = window.localStorage.getItem('review-focus-drill')
    return saved === 'true'
  })
  const [stageFeedback, setStageFeedback] = useState<ReviewEase | null>(null)
  const [activeMilestone, setActiveMilestone] = useState<number | null>(null)
  const [activeReset, setActiveReset] = useState<ResetAction>(null)
  const [sessionState, setSessionState] = useState<ReviewSessionState>(() =>
    createEmptySession(getDefaultMotionPreference()),
  )

  const audioContextRef = useRef<AudioContext | null>(null)
  const recordsRef = useRef(records)
  const motionPreferenceRef = useRef(motionPreference)

  useEffect(() => { recordsRef.current = records }, [records])
  useEffect(() => { motionPreferenceRef.current = motionPreference }, [motionPreference])
  useEffect(() => { window.localStorage.setItem('review-mix-mode', mixMode) }, [mixMode])
  useEffect(() => { window.localStorage.setItem('review-phonetic-mode', phoneticMode) }, [phoneticMode])
  useEffect(() => { window.localStorage.setItem('review-focus-drill', focusDrillEnabled ? 'true' : 'false') }, [focusDrillEnabled])

  useEffect(() => {
    if (!studyReady) {
      setSessionState(createEmptySession(motionPreferenceRef.current))
      setRevealed(false)
      return
    }
    const activeRecords = recordsRef.current
    const mp = motionPreferenceRef.current
    const initialQueue = buildInitialQueue(
      activeCards,
      activeRecords,
      mixMode,
      phoneticMode,
      selectedDeckId === 'all',
      deckOrder,
    )
    setSessionState({
      initialCardIds: initialQueue,
      sessionQueue: initialQueue,
      relearnQueue: [],
      checkpointCardIds: [],
      pendingAgainCardIds: [],
      reviewedCardIds: [],
      completedCardIds: [],
      troubleCardIds: initialQueue.filter((id) => isTroubleRecord(activeRecords[id])),
      sessionAgainCounts: {},
      combo: 0,
      bestCombo: 0,
      answeredCount: 0,
      motionPreference: mp,
      mixMode,
      phoneticMode,
      focusDrillEnabled,
      drillQueue: [],
      drillStreakByCardId: {},
    })
    setRevealed(false)
    setStageFeedback(null)
    setActiveMilestone(null)
  }, [activeCards, deckOrder, focusDrillEnabled, mixMode, phoneticMode, selectedDeckId, sessionResetVersion, studyReady])

  useEffect(() => {
    setSessionState((c) => ({ ...c, motionPreference }))
  }, [motionPreference])

  useEffect(() => {
    if (!stageFeedback) return
    const id = window.setTimeout(() => setStageFeedback(null), 260)
    return () => window.clearTimeout(id)
  }, [stageFeedback])

  useEffect(() => {
    if (activeMilestone === null) return
    const id = window.setTimeout(() => setActiveMilestone(null), 1600)
    return () => window.clearTimeout(id)
  }, [activeMilestone])

  const playFeedback = useCallback((cue: SoundCue) => {
    if (!soundEnabled || typeof window === 'undefined') return
    const BAC = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!BAC) return
    const ctx = audioContextRef.current ?? new BAC()
    audioContextRef.current = ctx
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, now)
    const osc = ctx.createOscillator()
    osc.connect(gain)
    const tones: Record<SoundCue, { f: number; d: number; c: number }> = {
      flip:  { f: 540, d: 0.07, c: 0.065 },
      again: { f: 230, d: 0.12, c: 0.09  },
      hard:  { f: 320, d: 0.10, c: 0.08  },
      good:  { f: 510, d: 0.12, c: 0.10  },
      easy:  { f: 690, d: 0.14, c: 0.12  },
    }
    const t = tones[cue]
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t.c)
    osc.frequency.setValueAtTime(t.f, now)
    osc.type = cue === 'again' ? 'sawtooth' : 'sine'
    osc.start(now)
    osc.stop(now + t.d)
  }, [soundEnabled])

  const queueCards = useMemo(
    () => sessionState.sessionQueue.map((id) => cardsById.get(id)).filter((c): c is PublishedCard => Boolean(c)),
    [cardsById, sessionState.sessionQueue],
  )

  const currentCard = queueCards[0]
  const selectedDeck = selectedDeckId === 'all' ? undefined : publishedDecks.find((d) => d.id === selectedDeckId)
  const currentDeck = currentCard ? deckById.get(currentCard.deckId) : selectedDeck
  const initialTotal = sessionState.initialCardIds.length
  const completedCount = sessionState.completedCardIds.length
  const progressPercent = initialTotal > 0 ? Math.round((completedCount / initialTotal) * 100) : 0

  const sessionComplete =
    studyReady &&
    initialTotal > 0 &&
    sessionState.sessionQueue.length === 0 &&
    sessionState.relearnQueue.length === 0 &&
    sessionState.pendingAgainCardIds.length === 0 &&
    sessionState.checkpointCardIds.length === 0

  const currentRecord = currentCard ? records[currentCard.id] : undefined
  const currentAgainCount = currentCard ? (sessionState.sessionAgainCounts[currentCard.id] ?? 0) : 0
  const needsRecallPrompt = Boolean(currentCard) &&
    shouldPromptRecall(currentRecord?.lapseCount ?? 0, currentAgainCount, isTroubleRecord(currentRecord))
  const recallPrompt = currentCard
    ? getRecallPrompt(currentCard.id, currentRecord?.lapseCount ?? 0, currentAgainCount)
    : ''

  const queueMeta = useMemo(() => ({
    pendingAgain: new Set(sessionState.pendingAgainCardIds),
    checkpoint: new Set(sessionState.checkpointCardIds),
    trouble: new Set(sessionState.troubleCardIds),
    drill: new Set(sessionState.drillQueue),
  }), [sessionState.checkpointCardIds, sessionState.drillQueue, sessionState.pendingAgainCardIds, sessionState.troubleCardIds])

  const troubleCards = useMemo(
    () => sessionState.troubleCardIds.map((id) => cardsById.get(id)).filter((c): c is PublishedCard => Boolean(c)),
    [cardsById, sessionState.troubleCardIds],
  )

  const recoveredCount = sessionState.reviewedCardIds.filter(
    (id) => (sessionState.sessionAgainCounts[id] ?? 0) > 0 && !sessionState.pendingAgainCardIds.includes(id),
  ).length

  const reviewInSession = useCallback((ease: ReviewEase) => {
    if (!currentCard) return
    const occurredAt = new Date().toISOString()
    const nowTs = Date.now()
    onReview(currentCard.id, ease, { occurredAt })
    playFeedback(ease)
    setRevealed(false)
    setStageFeedback(ease)

    setSessionState((cur) => {
      if (!cur.sessionQueue.includes(currentCard.id)) return cur
      const curAgain = cur.sessionAgainCounts[currentCard.id] ?? 0
      const wasCheckpoint = cur.checkpointCardIds.includes(currentCard.id)
      const wasPending = cur.pendingAgainCardIds.includes(currentCard.id)
      const wasNew = !records[currentCard.id]

      let nextQueue = cur.sessionQueue.filter((id) => id !== currentCard.id)
      let nextRelearn = cur.relearnQueue.filter((i) => i.cardId !== currentCard.id)
      let nextCheckpoint = cur.checkpointCardIds.filter((id) => id !== currentCard.id)
      let nextPending = [...cur.pendingAgainCardIds]
      let nextCompleted = removeValue(cur.completedCardIds, currentCard.id)
      let nextTrouble = [...cur.troubleCardIds]
      let nextDrillQueue = [...cur.drillQueue]
      const nextDrillStreakByCardId = { ...cur.drillStreakByCardId }
      const nextReviewed = includeUnique(cur.reviewedCardIds, currentCard.id)
      const nextAgainCounts = { ...cur.sessionAgainCounts }
      const nextAnswered = cur.answeredCount + 1
      const nextCombo = ease === 'again' ? 0 : cur.combo + 1

      if (ease === 'again') {
        nextAgainCounts[currentCard.id] = curAgain + 1
        nextPending = includeUnique(nextPending, currentCard.id)
        nextDrillQueue = includeUnique(nextDrillQueue, currentCard.id)
        nextDrillStreakByCardId[currentCard.id] = 0
        nextRelearn.push({
          cardId: currentCard.id,
          availableAfterReviews: cur.answeredCount + 1 + AGAIN_RELEARN_AFTER_CARDS,
          availableAt: nowTs + AGAIN_RELEARN_AFTER_MS,
          reason: 'again',
        })
      } else {
        nextPending = removeValue(nextPending, currentCard.id)
        if (nextDrillQueue.includes(currentCard.id)) {
          const streak = (nextDrillStreakByCardId[currentCard.id] ?? 0) + 1
          if (streak >= DRILL_TARGET_STREAK) {
            nextDrillQueue = removeValue(nextDrillQueue, currentCard.id)
            delete nextDrillStreakByCardId[currentCard.id]
          } else {
            nextDrillStreakByCardId[currentCard.id] = streak
          }
        }
        const needsCheckpoint = ease === 'hard' && !wasCheckpoint && (wasNew || wasPending || curAgain > 0)
        if (needsCheckpoint) {
          nextCheckpoint = includeUnique(nextCheckpoint, currentCard.id)
        } else {
          nextCompleted = includeUnique(nextCompleted, currentCard.id)
        }
      }

      if (isTroubleRecord(records[currentCard.id]) || (nextAgainCounts[currentCard.id] ?? 0) >= TROUBLE_SESSION_THRESHOLD) {
        nextTrouble = includeUnique(nextTrouble, currentCard.id)
      }

      const readyRelearn = nextRelearn
        .filter((i) => i.availableAfterReviews <= nextAnswered || i.availableAt <= nowTs)
        .map((i) => i.cardId)
      nextRelearn = nextRelearn.filter((i) => !(i.availableAfterReviews <= nextAnswered || i.availableAt <= nowTs))
      readyRelearn.forEach((id) => { if (!nextQueue.includes(id)) nextQueue.unshift(id) })

      if (nextQueue.length === 0 && nextPending.length > 0) {
        const forced = nextRelearn.map((i) => i.cardId)
        nextRelearn = []
        nextQueue = [...forced.filter((id) => !nextQueue.includes(id)), ...nextQueue]
      }

      if (nextQueue.length === 0 && nextPending.length === 0 && nextCheckpoint.length > 0) {
        nextQueue = buildCheckpointQueue(nextCheckpoint, nextTrouble)
      }

      if (cur.focusDrillEnabled && nextDrillQueue.length > 0) {
        nextDrillQueue.forEach((drillCardId) => {
          if (!nextQueue.includes(drillCardId)) {
            nextQueue.unshift(drillCardId)
          }
        })
      }

      const nextBest = Math.max(cur.bestCombo, nextCombo)
      if (nextCombo > 0 && nextCombo % MILESTONE_STEP === 0 && nextCombo !== cur.combo) {
        setActiveMilestone(nextCombo)
      }

      return {
        ...cur,
        sessionQueue: nextQueue,
        relearnQueue: nextRelearn,
        checkpointCardIds: nextCheckpoint,
        pendingAgainCardIds: nextPending,
        reviewedCardIds: nextReviewed,
        completedCardIds: nextCompleted,
        troubleCardIds: nextTrouble,
        sessionAgainCounts: nextAgainCounts,
        combo: nextCombo,
        bestCombo: nextBest,
        answeredCount: nextAnswered,
        drillQueue: nextDrillQueue,
        drillStreakByCardId: nextDrillStreakByCardId,
      }
    })
  }, [currentCard, onReview, playFeedback, records])

  const handleRestartSession = useCallback(() => {
    setRevealed(false)
    setStageFeedback(null)
    setActiveMilestone(null)
    onResetSession()
  }, [onResetSession])

  const focusCard = useCallback((cardId: string) => {
    setSessionState((cur) => {
      if (!cur.sessionQueue.includes(cardId)) return cur
      return { ...cur, sessionQueue: [cardId, ...cur.sessionQueue.filter((id) => id !== cardId)] }
    })
    setRevealed(false)
  }, [])

  const handleResetDeck = useCallback(async () => {
    if (!selectedDeck || activeReset) return
    if (!window.confirm(`Reset tiến độ local của deck "${selectedDeck.title}"?`)) return
    if (!window.confirm('Xác nhận lần hai: deck sẽ quay về trạng thái chưa học.')) return
    setActiveReset('deck')
    try {
      await onResetDeckProgress(selectedDeck.cards.map((c) => c.id))
      setRevealed(false)
    } finally { setActiveReset(null) }
  }, [activeReset, onResetDeckProgress, selectedDeck])

  const handleResetAll = useCallback(async () => {
    if (activeReset) return
    if (!window.confirm('Reset toàn bộ tiến độ học local?')) return
    if (!window.confirm('Xác nhận: mọi deck sẽ quay về trạng thái mới và không thể khôi phục.')) return
    setActiveReset('all')
    try {
      await onResetAllProgress()
      setRevealed(false)
    } finally { setActiveReset(null) }
  }, [activeReset, onResetAllProgress])

  const flipCard = useCallback(() => {
    if (!currentCard) return
    playFeedback('flip')
    setRevealed((v) => !v)
  }, [currentCard, playFeedback])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentCard || isEditableTarget(e.target)) return
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); return }
      if (e.shiftKey && (e.key === 'R' || e.key === 'r')) { e.preventDefault(); handleRestartSession(); return }
      if (revealed && (e.key === 'a' || e.key === 'A') && currentCard.audioText) {
        e.preventDefault(); onSpeak(currentCard.audioText); return
      }
      if (!revealed) return
      if (e.key === '1') { e.preventDefault(); reviewInSession('again') }
      else if (e.key === '2') { e.preventDefault(); reviewInSession('hard') }
      else if (e.key === '3') { e.preventDefault(); reviewInSession('good') }
      else if (e.key === '4') { e.preventDefault(); reviewInSession('easy') }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentCard, flipCard, handleRestartSession, onSpeak, revealed, reviewInSession])

  return (
    <section className={`view ${immersiveMode ? 'review-focus-mode' : ''}`}>
      {/* Header */}
      <div className={`review-header ${immersiveMode ? 'panel' : 'panel'}`}>
        <div className="review-header__lead">
          <p className="eyebrow">Review — SRS live</p>
          <h2>Lật thẻ, chấm điểm, đẩy nhịp.</h2>
        </div>
        <div className="review-header-controls">
          <button type="button" className="ghost-button compact-button" onClick={onToggleImmersive}>
            {immersiveMode ? 'Thoát focus' : 'Focus mode'}
          </button>
          <button type="button" className="ghost-button compact-button" onClick={onToggleTheme}>
            {themeMode === 'dark' ? 'Light' : 'Dark'}
          </button>
          <label className="filter-field" style={{ minWidth: '13rem' }}>
            <span>Deck đang ôn</span>
            <select value={selectedDeckId} onChange={(e) => { setRevealed(false); onSelectDeck(e.target.value) }}>
              {deckOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field" style={{ minWidth: '12rem' }}>
            <span>Kiểu trộn</span>
            <select
              value={mixMode}
              onChange={(event) => {
                setRevealed(false)
                setMixMode(event.target.value as ReviewMixMode)
              }}
            >
              <option value="random">Ngẫu nhiên</option>
              <option value="by_lesson">Theo bài đọc</option>
              <option value="by_phonetic">Theo âm</option>
            </select>
          </label>
          {mixMode === 'by_phonetic' && (
            <label className="filter-field" style={{ minWidth: '11rem' }}>
              <span>Nhóm âm</span>
              <select
                value={phoneticMode}
                onChange={(event) => setPhoneticMode(event.target.value as PhoneticMode)}
              >
                <option value="initial">Âm đầu</option>
                <option value="final">Âm cuối</option>
              </select>
            </label>
          )}
          <button
            type="button"
            className={`ghost-button compact-button ${focusDrillEnabled ? 'is-active' : ''}`}
            onClick={() => setFocusDrillEnabled((value) => !value)}
          >
            {focusDrillEnabled ? 'Focus Drill: Bật' : 'Focus Drill: Tắt'}
          </button>
        </div>
      </div>

      <div className={`review-grid ${immersiveMode ? 'is-immersive' : ''}`}>
        {/* Main stage */}
        <article
          className={`panel review-stage ${stageFeedback ? `stage-feedback stage-feedback--${stageFeedback}` : ''}`}
        >
          {/* Progress */}
          <div className="review-progress">
            <div className="progress-meta">
              <span className="eyebrow">Tiến độ phiên</span>
              <strong>{progressPercent}%</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="session-chips">
              <span className="tag-pill subdued">{initialTotal} thẻ tổng</span>
              {sessionState.pendingAgainCardIds.length > 0 && (
                <span className="tag-pill warn">
                  {sessionState.pendingAgainCardIds.length} cần hỏi lại
                </span>
              )}
              {sessionState.combo > 0 && (
                <span className="tag-pill">
                  Combo {sessionState.combo}
                </span>
              )}
              {focusDrillEnabled && (
                <span className="tag-pill danger">
                  Drill {sessionState.drillQueue.length}
                </span>
              )}
              {activeMilestone !== null && (
                <span className="tag-pill milestone-pill">
                  🎯 Mốc {activeMilestone} liên tiếp
                </span>
              )}
            </div>
          </div>

          {/* Loading */}
          {!studyReady && (
            <div className="empty-state">
              <h3>Đang nạp IndexedDB…</h3>
              <p>Chờ tiến độ học được tải trước khi dựng queue.</p>
            </div>
          )}

          {/* Active card */}
          {studyReady && currentCard && (
            <>
              <div className="review-status">
                <span className="tag-pill subdued">{queueCards.length} thẻ còn lại</span>
                <span className="tag-pill subdued">{currentDeck?.title ?? 'Deck tổng'}</span>
                {queueMeta.trouble.has(currentCard.id) && (
                  <span className="tag-pill danger">Trouble card</span>
                )}
                {queueMeta.pendingAgain.has(currentCard.id) && (
                  <span className="tag-pill warn">Quay lại trong phiên</span>
                )}
                {queueMeta.drill.has(currentCard.id) && (
                  <span className="tag-pill danger">Drill</span>
                )}
              </div>

              {/* Recall banner */}
              {needsRecallPrompt && !revealed && (
                <div className="recall-banner">
                  <span className="eyebrow">Recall prompt</span>
                  <strong>{recallPrompt}</strong>
                  <p>Thẻ này từng khó. Tự nhớ trước rồi mới lật để tránh ảo tưởng thuộc.</p>
                </div>
              )}

              {/* Flashcard */}
              <button
                key={currentCard.id}
                type="button"
                className={`flashcard-surface flashcard-surface--session ${revealed ? 'is-revealed' : ''} ${motionPreference === 'reduced' ? 'motion-reduced' : ''}`}
                onClick={flipCard}
                aria-pressed={revealed}
                aria-label={revealed ? `Mặt sau: ${currentCard.pinyin} — ${currentCard.meaningVi}` : `Mặt trước: ${currentCard.hanzi}`}
              >
                <span className="flashcard-label">{revealed ? 'Mặt sau' : 'Mặt trước'}</span>
                <span className="flip-hint-chip">{revealed ? 'Space úp lại' : 'Space lật'}</span>

                <span className="flashcard-scene" aria-hidden="true">
                  {/* Front */}
                  <span className="flashcard-face flashcard-face--front">
                    <span className="flashcard-status-line">
                      {/* status chips shown in review-status above */}
                    </span>
                    <h3>{currentCard.hanzi}</h3>
                    <p className="flashcard-instruction">
                      {needsRecallPrompt ? 'Tự nhớ trước, rồi chạm để kiểm tra.' : 'Chạm vào thẻ để lật đáp án.'}
                    </p>
                  </span>

                  {/* Back */}
                  <span className="flashcard-face flashcard-face--back">
                    <span className="answer-sheet">
                      <h3>{currentCard.hanzi}</h3>
                      <span className="answer-pinyin-row">
                        <span className="answer-label">Pinyin</span>
                        <strong>{currentCard.pinyin}</strong>
                      </span>
                      <span className="answer-meaning">{currentCard.meaningVi}</span>
                      {(currentCard.exampleZh || currentCard.exampleVi) && (
                        <span className="answer-example-block">
                          {currentCard.exampleZh && <span className="zh">{currentCard.exampleZh}</span>}
                          {currentCard.exampleVi && <span className="vi">{currentCard.exampleVi}</span>}
                        </span>
                      )}
                      {currentCard.imageUrl && (
                        <span className="answer-image-block">
                          <img src={currentCard.imageUrl} alt={currentCard.hanzi} loading="lazy" />
                          {currentCard.imageAttribution && (
                            <span className="image-attribution">{currentCard.imageAttribution}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </span>
              </button>

              {/* Score buttons & actions */}
              {revealed ? (
                <>
                  <div className="review-actions-grid">
                    {reviewActions.map((action) => (
                      <button
                        key={action.ease}
                        type="button"
                        className={`score-button ${reviewTone(action.ease)}`}
                        onClick={() => reviewInSession(action.ease)}
                        aria-label={`${action.label}: ${action.note}`}
                      >
                        <span className="score-label">{action.label}</span>
                        <span className="score-note">{action.note}</span>
                        <span className="score-key">{action.hint}</span>
                      </button>
                    ))}
                  </div>

                  <div className="answer-actions">
                    <button
                      type="button"
                      className="ghost-button utility-button compact-button"
                      onClick={() => onSpeak(currentCard.audioText)}
                    >
                      {hasChineseVoice ? 'Phát âm (A)' : 'Không có zh voice'}
                    </button>
                    {currentDeck && (
                      <button
                        type="button"
                        className="ghost-button utility-button compact-button"
                        onClick={() => onOpenReader({ materialId: currentDeck.materialId, cardId: currentCard.id })}
                      >
                        Xem ngữ cảnh
                      </button>
                    )}
                    <span className="review-shortcut-tip">
                      Space lật · A phát âm · 1–3 chấm · Shift+R restart
                    </span>
                  </div>
                </>
              ) : (
                <p className="review-shortcut-tip">Space để lật thẻ. Tự nhớ trước khi kiểm tra.</p>
              )}
            </>
          )}

          {/* Empty queue */}
          {studyReady && !currentCard && !sessionComplete && (
            <div className="empty-state">
              <h3>Queue trống.</h3>
              <p>Không còn thẻ đến hạn. Chuyển deck khác hoặc mở Reader để đọc lại tài liệu gốc.</p>
            </div>
          )}

          {/* Session complete */}
          {sessionComplete && (
            <div className="session-summary">
              <div>
                <p className="eyebrow">Session complete</p>
                <h3>Phiên này đã khép lại — nghỉ ngắn hoặc chuyển sang Reader.</h3>
              </div>

              <div className="session-summary__stats">
                <div className="mini-stat">
                  <span>Thẻ hoàn thành</span>
                  <strong>{completedCount}</strong>
                </div>
                <div className="mini-stat">
                  <span>Best combo</span>
                  <strong>{sessionState.bestCombo}</strong>
                </div>
                <div className="mini-stat">
                  <span>Thẻ cứu lại</span>
                  <strong>{recoveredCount}</strong>
                </div>
                <div className="mini-stat">
                  <span>Trouble cards</span>
                  <strong>{troubleCards.length}</strong>
                </div>
              </div>

              {troubleCards.length > 0 && (
                <div className="tag-row">
                  {troubleCards.slice(0, 6).map((card) => (
                    <span key={card.id} className="tag-pill subdued">{card.hanzi}</span>
                  ))}
                </div>
              )}

              <div className="hero-actions">
                <button type="button" className="primary-button" onClick={handleRestartSession}>
                  Ôn lại phiên này
                </button>
                {currentDeck && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onOpenReader({ materialId: currentDeck.materialId })}
                  >
                    Chuyển sang Reader
                  </button>
                )}
              </div>
            </div>
          )}
        </article>

        {/* Sidebar */}
        <div className="review-side">
          {/* Queue preview */}
          <article className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Up next</p>
                <h3>Queue — chỉ mặt trước</h3>
              </div>
            </div>
            <p className="queue-privacy-note">
              Không hiện nghĩa hay pinyin để tránh nhận mặt thay vì thực sự nhớ.
            </p>
            <div className="stack-list" style={{ marginTop: '0.5rem' }}>
              {queueCards.slice(0, 8).map((card, index) => (
                <button
                  key={card.id}
                  type="button"
                  className={`list-row queue-row ${card.id === currentCard?.id ? 'is-selected' : ''}`}
                  onClick={() => focusCard(card.id)}
                >
                  <div>
                    <strong>{index + 1}. {card.hanzi}</strong>
                    <p>{deckById.get(card.deckId)?.title ?? 'Deck'}</p>
                    <div className="queue-tags">
                      {queueMeta.pendingAgain.has(card.id) && <span className="tag-pill warn" style={{ fontSize: '0.7rem', padding: '0.18rem 0.45rem' }}>Lặp lại</span>}
                      {queueMeta.checkpoint.has(card.id) && <span className="tag-pill subdued" style={{ fontSize: '0.7rem', padding: '0.18rem 0.45rem' }}>Checkpoint</span>}
                      {queueMeta.trouble.has(card.id) && <span className="tag-pill danger" style={{ fontSize: '0.7rem', padding: '0.18rem 0.45rem' }}>Trouble</span>}
                      {queueMeta.drill.has(card.id) && <span className="tag-pill danger" style={{ fontSize: '0.7rem', padding: '0.18rem 0.45rem' }}>Drill</span>}
                    </div>
                  </div>
                  <span className="queue-row__meta">{formatRelativeDue(records[card.id])}</span>
                </button>
              ))}
              {queueCards.length === 0 && (
                <div className="empty-state subtle">Queue phiên hiện tại sạch.</div>
              )}
            </div>
          </article>

          {/* Study controls */}
          <article className="panel review-controls">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Controls</p>
                <h3>Điều khiển phiên</h3>
              </div>
            </div>

            <div className="review-controls__toggles">
              <button
                type="button"
                className={`sound-toggle ${soundEnabled ? 'is-enabled' : ''}`}
                onClick={() => setSoundEnabled((v) => !v)}
              >
                {soundEnabled ? '♪ Âm: Bật' : '♪ Âm: Tắt'}
              </button>
              <button
                type="button"
                className={`sound-toggle ${motionPreference === 'full' ? 'is-enabled' : ''}`}
                onClick={() => setMotionPreference((v) => v === 'full' ? 'reduced' : 'full')}
              >
                {motionPreference === 'full' ? '↻ Motion: Đầy đủ' : '↻ Motion: Giảm'}
              </button>
            </div>

            <div className="review-controls__actions">
              <button type="button" className="ghost-button" onClick={handleRestartSession} disabled={!studyReady}>
                Restart phiên
              </button>
              <button type="button" className="ghost-button" onClick={handleResetDeck} disabled={!selectedDeck || activeReset !== null}>
                {activeReset === 'deck' ? 'Đang reset…' : 'Reset deck'}
              </button>
              <button
                type="button"
                className="ghost-button danger-button"
                onClick={handleResetAll}
                disabled={activeReset !== null}
                style={{ gridColumn: '1 / -1' }}
              >
                {activeReset === 'all' ? 'Đang reset…' : 'Reset toàn bộ progress'}
              </button>
            </div>

            {!selectedDeck && (
              <p className="review-shortcut-tip">
                Chọn deck cụ thể để dùng "Reset deck".
              </p>
            )}

            <div className="session-summary__stats">
              <div className="mini-stat">
                <span>Pending again</span>
                <strong>{sessionState.pendingAgainCardIds.length}</strong>
              </div>
              <div className="mini-stat">
                <span>Checkpoint</span>
                <strong>{sessionState.checkpointCardIds.length}</strong>
              </div>
              <div className="mini-stat">
                <span>Trouble</span>
                <strong>{troubleCards.length}</strong>
              </div>
              <div className="mini-stat">
                <span>Best combo</span>
                <strong>{sessionState.bestCombo}</strong>
              </div>
              <div className="mini-stat">
                <span>Drill queue</span>
                <strong>{sessionState.drillQueue.length}</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
