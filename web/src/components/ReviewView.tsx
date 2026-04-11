import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCardExampleDisplayState } from '../lib/cardExample'
import {
  BATCH_SIZE,
  applyBatchAction,
  buildInitialQueue,
  createReviewSession,
  getPromptFields,
  normalizeHanzi,
  normalizeMeaning,
  normalizePinyin,
} from '../lib/reviewSession'
import { reviewTone } from '../lib/srs'
import type { ChineseVoiceOption, VoiceGenderMode } from '../hooks/useSpeech'
import type {
  MotionPreference,
  PhoneticMode,
  PromptField,
  PublishedCard,
  PublishedDeck,
  ReviewEase,
  ReviewMixMode,
  ReviewPracticeMode,
  ReviewSessionState,
  StudyRecordMap,
} from '../types'

interface ReviewViewProps {
  publishedDecks: PublishedDeck[]
  records: StudyRecordMap
  studyReady: boolean
  selectedDeckId: string
  startCardId: string | null
  requestedPracticeMode: ReviewPracticeMode
  sessionResetVersion: number
  hasChineseVoice: boolean
  hasMaleChineseVoice: boolean
  hasFemaleChineseVoice: boolean
  voiceMode: VoiceGenderMode
  selectedVoiceUri: string
  voiceOptions: ChineseVoiceOption[]
  onSelectDeck: (deckId: string) => void
  onReview: (cardId: string, ease: ReviewEase, sessionContext?: { occurredAt?: string }) => void
  onSpeak: (text: string) => void
  onChangeVoiceMode: (mode: VoiceGenderMode) => void
  onChangeSelectedVoiceUri: (voiceUri: string) => void
  onOpenReader: (options?: { materialId?: string; cardId?: string }) => void
  onResetSession: () => void
  onResetDeckProgress: (cardIds: string[]) => Promise<void>
  onResetAllProgress: () => Promise<void>
}

const reviewActions: Array<{
  ease: ReviewEase
  label: string
  hint: string
  note: string
}> = [
  { ease: 'again', label: 'Chưa nhớ', hint: '1', note: 'Qua vòng sau của batch' },
  { ease: 'hard', label: 'Hơi nhớ', hint: '2', note: 'Checkpoint cuối batch' },
  { ease: 'good', label: 'Nhớ được', hint: '3', note: 'Hoàn thành trong batch' },
]

type SoundCue = 'flip' | ReviewEase
type ResetAction = 'deck' | 'all' | null
type BatchAction = ReviewEase | 'skip'
type TypeAnswerResolution = 'correct' | 'again'
type TypeAnswerFieldStatus = 'correct' | 'partial' | 'missing' | 'incorrect'

interface TypeAnswerFieldFeedback {
  field: PromptField
  status: TypeAnswerFieldStatus
  summary: string
  detail: string
  expectedValue: string
}

type TypeAnswerFeedbackMap = Partial<Record<PromptField, TypeAnswerFieldFeedback>>

interface ResolvedCardState {
  card: PublishedCard
  promptField: PromptField
  resolution: TypeAnswerResolution
}

const MILESTONE_STEP = 5

const EMPTY_INPUTS = {
  hanzi: '',
  pinyin: '',
  meaningVi: '',
}

const TYPE_ANSWER_STATUS_LABEL: Record<TypeAnswerFieldStatus, string> = {
  correct: 'Đúng',
  partial: 'Gần đúng',
  missing: 'Thiếu',
  incorrect: 'Sai',
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT')

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

const fieldLabel = (field: PromptField) => {
  if (field === 'hanzi') return 'Tiếng Trung'
  if (field === 'pinyin') return 'Pinyin'
  return 'Nghĩa'
}

const getCardFieldValue = (card: PublishedCard, field: PromptField) => {
  if (field === 'hanzi') return card.hanzi
  if (field === 'pinyin') return card.pinyin
  return card.meaningVi
}

const diffUnits = (actualUnits: string[], expectedUnits: string[]) => {
  let prefix = 0
  while (
    prefix < actualUnits.length &&
    prefix < expectedUnits.length &&
    actualUnits[prefix] === expectedUnits[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < actualUnits.length - prefix &&
    suffix < expectedUnits.length - prefix &&
    actualUnits[actualUnits.length - 1 - suffix] ===
      expectedUnits[expectedUnits.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    prefix,
    suffix,
    actualDiff: actualUnits.slice(prefix, actualUnits.length - suffix),
    expectedDiff: expectedUnits.slice(prefix, expectedUnits.length - suffix),
  }
}

const formatDiffChunk = (field: PromptField, units: string[]) =>
  `“${field === 'hanzi' ? units.join('') : units.join(' ')}”`

const buildHanziFeedback = (
  field: PromptField,
  actualValue: string,
  expectedValue: string,
): TypeAnswerFieldFeedback => {
  const normalizedActual = normalizeHanzi(actualValue)
  const normalizedExpected = normalizeHanzi(expectedValue)

  if (!normalizedActual) {
    return {
      field,
      status: 'missing',
      summary: 'Chưa nhập tiếng Trung.',
      detail: 'Ô này đang trống, nên hệ thống chưa thể chấm được.',
      expectedValue,
    }
  }

  if (normalizedActual === normalizedExpected) {
    return {
      field,
      status: 'correct',
      summary: 'Khớp hoàn toàn với đáp án.',
      detail: 'Tiếng Trung đã đúng toàn bộ.',
      expectedValue,
    }
  }

  const { prefix, suffix, actualDiff, expectedDiff } = diffUnits(
    Array.from(normalizedActual),
    Array.from(normalizedExpected),
  )

  let detail = `Đáp án đúng là “${expectedValue}”.`
  if (actualDiff.length === 0 && expectedDiff.length > 0) {
    detail = `Bạn còn thiếu đoạn ${formatDiffChunk(field, expectedDiff)}.`
  } else if (actualDiff.length > 0 && expectedDiff.length === 0) {
    detail = `Bạn đang dư đoạn ${formatDiffChunk(field, actualDiff)}.`
  } else if (actualDiff.length > 0 && expectedDiff.length > 0) {
    detail = `Đoạn ${formatDiffChunk(field, actualDiff)} chưa đúng, đáp án cần là ${formatDiffChunk(field, expectedDiff)}.`
  }

  return {
    field,
    status: prefix > 0 || suffix > 0 ? 'partial' : 'incorrect',
    summary:
      prefix > 0 || suffix > 0
        ? 'Đúng một phần, nhưng vẫn còn đoạn sai.'
        : 'Chưa khớp với đáp án.',
    detail,
    expectedValue,
  }
}

const buildTokenFeedback = (
  field: PromptField,
  actualValue: string,
  expectedValue: string,
): TypeAnswerFieldFeedback => {
  const normalize =
    field === 'pinyin'
      ? normalizePinyin
      : normalizeMeaning
  const normalizedActual = normalize(actualValue)
  const normalizedExpected = normalize(expectedValue)
  const unitLabel = field === 'pinyin' ? 'âm tiết' : 'từ khóa'

  if (!normalizedActual) {
    return {
      field,
      status: 'missing',
      summary: `Chưa nhập ${fieldLabel(field).toLowerCase()}.`,
      detail: 'Ô này đang trống, nên hệ thống chưa thể chấm được.',
      expectedValue,
    }
  }

  if (normalizedActual === normalizedExpected) {
    return {
      field,
      status: 'correct',
      summary:
        field === 'pinyin'
          ? 'Pinyin đã khớp sau khi chuẩn hóa dấu thanh và khoảng trắng.'
          : 'Nghĩa đã khớp với đáp án hiện tại.',
      detail:
        field === 'pinyin'
          ? 'Pinyin đúng, kể cả khi bạn nhập không dấu hoặc khác khoảng trắng.'
          : 'Phần nghĩa đã đúng.',
      expectedValue,
    }
  }

  const actualUnits = normalizedActual.split(' ').filter(Boolean)
  const expectedUnits = normalizedExpected.split(' ').filter(Boolean)
  const { prefix, suffix, actualDiff, expectedDiff } = diffUnits(actualUnits, expectedUnits)
  const matchedCount = prefix + suffix

  let detail = `Đáp án đúng là “${expectedValue}”.`
  if (actualDiff.length === 0 && expectedDiff.length > 0) {
    detail = `Bạn đã đúng ${matchedCount}/${expectedUnits.length} ${unitLabel}, nhưng còn thiếu ${formatDiffChunk(field, expectedDiff)}.`
  } else if (actualDiff.length > 0 && expectedDiff.length === 0) {
    detail = `Bạn đang dư ${formatDiffChunk(field, actualDiff)} nên chưa khớp.`
  } else if (actualDiff.length > 0 && expectedDiff.length > 0) {
    detail =
      matchedCount > 0
        ? `Bạn đã đúng ${matchedCount}/${expectedUnits.length} ${unitLabel}. Phần ${formatDiffChunk(field, actualDiff)} cần sửa thành ${formatDiffChunk(field, expectedDiff)}.`
        : `Chưa khớp. Phần bạn nhập ${formatDiffChunk(field, actualDiff)} khác với đáp án ${formatDiffChunk(field, expectedDiff)}.`
  }

  return {
    field,
    status: matchedCount > 0 ? 'partial' : 'incorrect',
    summary:
      matchedCount > 0
        ? `Đã đúng ${matchedCount}/${expectedUnits.length} ${unitLabel}.`
        : `Chưa có ${unitLabel} nào khớp.`,
    detail,
    expectedValue,
  }
}

const evaluateTypeAnswerField = (
  field: PromptField,
  actualValue: string,
  expectedValue: string,
): TypeAnswerFieldFeedback =>
  field === 'hanzi'
    ? buildHanziFeedback(field, actualValue, expectedValue)
    : buildTokenFeedback(field, actualValue, expectedValue)

const evaluateTypeAnswerAttempt = (
  card: PublishedCard,
  inputs: typeof EMPTY_INPUTS,
  fields: PromptField[],
) => {
  const feedbackByField = fields.reduce<TypeAnswerFeedbackMap>((accumulator, field) => {
    accumulator[field] = evaluateTypeAnswerField(
      field,
      inputs[field],
      getCardFieldValue(card, field),
    )
    return accumulator
  }, {})

  return {
    feedbackByField,
    allCorrect: fields.every((field) => feedbackByField[field]?.status === 'correct'),
  }
}

const buildTypeAnswerFailureMessage = (
  feedbackByField: TypeAnswerFeedbackMap,
  fields: PromptField[],
) => {
  const correctFields = fields
    .filter((field) => feedbackByField[field]?.status === 'correct')
    .map((field) => fieldLabel(field))
  const pendingFields = fields
    .filter((field) => feedbackByField[field]?.status !== 'correct')
    .map((field) => fieldLabel(field))

  return [
    correctFields.length > 0 ? `${correctFields.join(', ')} đã đúng.` : null,
    pendingFields.length > 0 ? `${pendingFields.join(', ')} cần sửa theo gợi ý bên dưới.` : null,
    'Bạn có thể chỉnh tiếp, bật gợi ý hoặc chọn Không nhớ.',
  ]
    .filter(Boolean)
    .join(' ')
}

const getHintQuality = (card: PublishedCard) => {
  const normalizedExamplePinyin = card.examplePinyin ? normalizePinyin(card.examplePinyin) : ''
  const normalizedCardPinyin = normalizePinyin(card.pinyin)
  const containsHanzi = card.exampleZh.includes(card.hanzi)
  const containsPinyin =
    !card.examplePinyin || normalizedExamplePinyin.includes(normalizedCardPinyin)
  const isFallbackExample =
    card.exampleZh.startsWith('课文常见词：') ||
    card.exampleVi.startsWith("Từ '")

  if (containsHanzi && containsPinyin && !isFallbackExample) {
    return {
      tone: 'ok',
      text: 'Gợi ý này đang bám trực tiếp vào từ/câu của thẻ hiện tại.',
    }
  }

  return {
    tone: 'warn',
    text: 'Gợi ý này đang dùng fallback, nên đối chiếu thêm với Reader nếu thấy chưa khớp.',
  }
}

const sortCardsForPicker = (cards: PublishedCard[], records: StudyRecordMap) =>
  [...cards].sort((left, right) => {
    const leftDue = records[left.id]?.dueAt ?? ''
    const rightDue = records[right.id]?.dueAt ?? ''
    const dueCompare = leftDue.localeCompare(rightDue)
    if (dueCompare !== 0) return dueCompare
    return left.hanzi.localeCompare(right.hanzi)
  })

const createEmptySession = (
  motionPreference: MotionPreference,
  practiceMode: ReviewPracticeMode,
  records: StudyRecordMap,
): ReviewSessionState =>
  createReviewSession([], {
    motionPreference,
    mixMode: 'random',
    phoneticMode: 'initial',
    practiceMode,
    records,
  })

export const ReviewView = ({
  publishedDecks,
  records,
  studyReady,
  selectedDeckId,
  startCardId,
  requestedPracticeMode,
  sessionResetVersion,
  hasChineseVoice,
  hasMaleChineseVoice,
  hasFemaleChineseVoice,
  voiceMode,
  selectedVoiceUri,
  voiceOptions,
  onSelectDeck,
  onReview,
  onSpeak,
  onChangeVoiceMode,
  onChangeSelectedVoiceUri,
  onOpenReader,
  onResetSession,
  onResetDeckProgress,
  onResetAllProgress,
}: ReviewViewProps) => {
  const deckOptions = useMemo(
    () => [
      { id: 'all', label: 'Tất cả deck' },
      ...publishedDecks.map((deck) => ({ id: deck.id, label: deck.title })),
    ],
    [publishedDecks],
  )
  const deckOrder = useMemo(() => publishedDecks.map((deck) => deck.id), [publishedDecks])
  const deckById = useMemo(() => new Map(publishedDecks.map((deck) => [deck.id, deck])), [publishedDecks])

  const [revealed, setRevealed] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [motionPreference, setMotionPreference] = useState<MotionPreference>(getDefaultMotionPreference)
  const [practiceMode, setPracticeMode] = useState<ReviewPracticeMode>(() => {
    const saved = window.localStorage.getItem('review-practice-mode')
    if (saved === 'flashcard' || saved === 'type_answer') {
      return saved
    }
    return requestedPracticeMode
  })
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
  const [stageFeedback, setStageFeedback] = useState<ReviewEase | null>(null)
  const [activeMilestone, setActiveMilestone] = useState<number | null>(null)
  const [activeReset, setActiveReset] = useState<ResetAction>(null)
  const [sessionStartCardId, setSessionStartCardId] = useState<string | null>(startCardId)
  const [startCardPickerValue, setStartCardPickerValue] = useState(startCardId ?? '')
  const [startCardSearch, setStartCardSearch] = useState('')
  const [sessionState, setSessionState] = useState<ReviewSessionState>(() =>
    createEmptySession(getDefaultMotionPreference(), requestedPracticeMode, records),
  )
  const [answerInputs, setAnswerInputs] = useState(EMPTY_INPUTS)
  const [typeAnswerFeedback, setTypeAnswerFeedback] = useState<TypeAnswerFeedbackMap>({})
  const [typeAnswerMessage, setTypeAnswerMessage] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [resolvedCardState, setResolvedCardState] = useState<ResolvedCardState | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const recordsRef = useRef(records)
  const motionPreferenceRef = useRef(motionPreference)

  useEffect(() => {
    recordsRef.current = records
  }, [records])

  useEffect(() => {
    motionPreferenceRef.current = motionPreference
  }, [motionPreference])

  useEffect(() => {
    setPracticeMode(requestedPracticeMode)
  }, [requestedPracticeMode])

  useEffect(() => {
    setSessionStartCardId(startCardId)
    setStartCardPickerValue(startCardId ?? '')
  }, [startCardId])

  useEffect(() => {
    window.localStorage.setItem('review-practice-mode', practiceMode)
  }, [practiceMode])

  useEffect(() => {
    window.localStorage.setItem('review-mix-mode', mixMode)
  }, [mixMode])

  useEffect(() => {
    window.localStorage.setItem('review-phonetic-mode', phoneticMode)
  }, [phoneticMode])

  const activeCards = useMemo(() => {
    if (selectedDeckId === 'all') return publishedDecks.flatMap((deck) => deck.cards)
    return publishedDecks.find((deck) => deck.id === selectedDeckId)?.cards ?? []
  }, [publishedDecks, selectedDeckId])

  const cardsById = useMemo(() => new Map(activeCards.map((card) => [card.id, card])), [activeCards])
  const selectedDeck = selectedDeckId === 'all'
    ? undefined
    : publishedDecks.find((deck) => deck.id === selectedDeckId)

  const startableCards = useMemo(
    () => sortCardsForPicker(activeCards, records).filter((card) => !records[card.id] || new Date(records[card.id].dueAt).getTime() <= Date.now()),
    [activeCards, records],
  )

  const filteredStartCards = useMemo(() => {
    const normalizedQuery = startCardSearch.trim().toLowerCase()
    if (!normalizedQuery) {
      return startableCards
    }

    return startableCards.filter((card) =>
      [card.hanzi, card.pinyin, card.meaningVi, card.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  }, [startCardSearch, startableCards])

  useEffect(() => {
    if (!studyReady) {
      setSessionState(createEmptySession(motionPreferenceRef.current, practiceMode, recordsRef.current))
      setRevealed(false)
      return
    }

    const initialQueue = buildInitialQueue(
      activeCards,
      recordsRef.current,
      mixMode,
      phoneticMode,
      selectedDeckId === 'all',
      deckOrder,
      sessionStartCardId,
    )

    setSessionState(createReviewSession(initialQueue, {
      motionPreference: motionPreferenceRef.current,
      mixMode,
      phoneticMode,
      practiceMode,
      startCardId: sessionStartCardId,
      records: recordsRef.current,
    }))
    setResolvedCardState(null)
    setAnswerInputs(EMPTY_INPUTS)
    setTypeAnswerMessage(null)
    setShowHint(false)
    setRevealed(false)
    setStageFeedback(null)
    setActiveMilestone(null)
  }, [
    activeCards,
    deckOrder,
    mixMode,
    phoneticMode,
    practiceMode,
    selectedDeckId,
    sessionResetVersion,
    sessionStartCardId,
    studyReady,
  ])

  useEffect(() => {
    setSessionState((current) => ({ ...current, motionPreference, practiceMode }))
  }, [motionPreference, practiceMode])

  useEffect(() => {
    if (!stageFeedback) return
    const timeoutId = window.setTimeout(() => setStageFeedback(null), 280)
    return () => window.clearTimeout(timeoutId)
  }, [stageFeedback])

  useEffect(() => {
    if (activeMilestone === null) return
    const timeoutId = window.setTimeout(() => setActiveMilestone(null), 1600)
    return () => window.clearTimeout(timeoutId)
  }, [activeMilestone])

  const playFeedback = useCallback((cue: SoundCue) => {
    if (!soundEnabled || typeof window === 'undefined') return

    const BaseAudioContext =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!BaseAudioContext) return

    const context = audioContextRef.current ?? new BaseAudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') {
      void context.resume()
    }

    const now = context.currentTime
    const gain = context.createGain()
    gain.connect(context.destination)
    gain.gain.setValueAtTime(0.0001, now)

    const oscillator = context.createOscillator()
    oscillator.connect(gain)

    const tones: Record<SoundCue, { frequency: number; duration: number; cutoff: number }> = {
      flip: { frequency: 540, duration: 0.07, cutoff: 0.065 },
      again: { frequency: 230, duration: 0.12, cutoff: 0.09 },
      hard: { frequency: 320, duration: 0.1, cutoff: 0.08 },
      good: { frequency: 510, duration: 0.12, cutoff: 0.1 },
      easy: { frequency: 690, duration: 0.14, cutoff: 0.12 },
    }

    const tone = tones[cue]
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.cutoff)
    oscillator.frequency.setValueAtTime(tone.frequency, now)
    oscillator.type = cue === 'again' ? 'sawtooth' : 'sine'
    oscillator.start(now)
    oscillator.stop(now + tone.duration)
  }, [soundEnabled])

  const queueCards = useMemo(
    () =>
      sessionState.currentRoundCardIds
        .map((cardId) => cardsById.get(cardId))
        .filter((card): card is PublishedCard => Boolean(card)),
    [cardsById, sessionState.currentRoundCardIds],
  )

  const queuedCard = queueCards[0]
  const currentCard = resolvedCardState?.card ?? queuedCard
  const currentDeck = currentCard ? deckById.get(currentCard.deckId) : selectedDeck
  const currentPromptField = currentCard
    ? sessionState.promptFieldByCardId[currentCard.id] ?? 'meaningVi'
    : 'meaningVi'
  const answerFields = getPromptFields(currentPromptField)
  const hintQuality = currentCard ? getHintQuality(currentCard) : null
  const exampleDisplayState = currentCard
    ? getCardExampleDisplayState(currentCard)
    : {
        hasDistinctExample: false,
        showExampleZh: false,
        showExamplePinyin: false,
        showExampleVi: false,
      }

  const totalBatchCount = Math.ceil(sessionState.initialCardIds.length / BATCH_SIZE)
  const initialTotal = sessionState.initialCardIds.length
  const completedCount = sessionState.completedCardIds.length
  const pendingCount = useMemo(
    () =>
      new Set([
        ...sessionState.currentRoundCardIds,
        ...sessionState.retryCardIds,
        ...sessionState.checkpointCardIds,
        ...sessionState.remainingBatchCardIds,
      ]).size,
    [
      sessionState.checkpointCardIds,
      sessionState.currentRoundCardIds,
      sessionState.remainingBatchCardIds,
      sessionState.retryCardIds,
    ],
  )
  const progressPercent = initialTotal > 0 ? Math.round((completedCount / initialTotal) * 100) : 0
  const sessionComplete =
    studyReady &&
    sessionState.currentRoundCardIds.length === 0 &&
    sessionState.retryCardIds.length === 0 &&
    sessionState.checkpointCardIds.length === 0 &&
    sessionState.remainingBatchCardIds.length === 0 &&
    !resolvedCardState

  const troubleCards = useMemo(
    () =>
      sessionState.troubleCardIds
        .map((cardId) => cardsById.get(cardId))
        .filter((card): card is PublishedCard => Boolean(card)),
    [cardsById, sessionState.troubleCardIds],
  )

  useEffect(() => {
    if (resolvedCardState) {
      return
    }
    setAnswerInputs(EMPTY_INPUTS)
    setTypeAnswerFeedback({})
    setTypeAnswerMessage(null)
    setShowHint(false)
  }, [queuedCard?.id, practiceMode, resolvedCardState])

  const commitSessionAction = useCallback((cardId: string, action: BatchAction) => {
    if (action !== 'skip') {
      const occurredAt = new Date().toISOString()
      onReview(cardId, action, { occurredAt })
      playFeedback(action)
      setStageFeedback(action)
    }

    setSessionState((current) => {
      const next = applyBatchAction(current, cardId, action, recordsRef.current)
      if (next.combo > 0 && next.combo % MILESTONE_STEP === 0 && next.combo !== current.combo) {
        setActiveMilestone(next.combo)
      }
      return next
    })
    setRevealed(false)
  }, [onReview, playFeedback])

  const handleFlashcardAction = useCallback((ease: ReviewEase) => {
    if (!queuedCard) {
      return
    }
    commitSessionAction(queuedCard.id, ease)
  }, [commitSessionAction, queuedCard])

  const handleRestartSession = useCallback(() => {
    setResolvedCardState(null)
    setAnswerInputs(EMPTY_INPUTS)
    setTypeAnswerMessage(null)
    setShowHint(false)
    setRevealed(false)
    setActiveMilestone(null)
    onResetSession()
  }, [onResetSession])

  const handleResetDeck = useCallback(async () => {
    if (!selectedDeck || activeReset) return
    if (!window.confirm(`Reset tiến độ local của deck "${selectedDeck.title}"?`)) return
    if (!window.confirm('Xác nhận lần hai: deck sẽ quay về trạng thái chưa học.')) return
    setActiveReset('deck')
    try {
      await onResetDeckProgress(selectedDeck.cards.map((card) => card.id))
      setRevealed(false)
      setResolvedCardState(null)
      setSessionStartCardId(null)
      setStartCardPickerValue('')
    } finally {
      setActiveReset(null)
    }
  }, [activeReset, onResetDeckProgress, selectedDeck])

  const handleResetAll = useCallback(async () => {
    if (activeReset) return
    if (!window.confirm('Reset toàn bộ tiến độ học local?')) return
    if (!window.confirm('Xác nhận: mọi deck sẽ quay về trạng thái mới và không thể khôi phục.')) return
    setActiveReset('all')
    try {
      await onResetAllProgress()
      setRevealed(false)
      setResolvedCardState(null)
      setSessionStartCardId(null)
      setStartCardPickerValue('')
    } finally {
      setActiveReset(null)
    }
  }, [activeReset, onResetAllProgress])

  const flipCard = useCallback(() => {
    if (!queuedCard || practiceMode !== 'flashcard') return
    playFeedback('flip')
    setRevealed((current) => !current)
  }, [playFeedback, practiceMode, queuedCard])

  const handlePracticeModeChange = (nextMode: ReviewPracticeMode) => {
    setPracticeMode(nextMode)
    setResolvedCardState(null)
  }

  const handleApplyStartCard = () => {
    const nextCardId = startCardPickerValue || null
    setResolvedCardState(null)
    setSessionStartCardId(nextCardId)
    onResetSession()
  }

  const handleTypeAnswerInputChange = (field: PromptField, value: string) => {
    setAnswerInputs((current) => ({
      ...current,
      [field]: value,
    }))
    setTypeAnswerFeedback((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
    setTypeAnswerMessage(null)
  }

  const resolveTypeAnswer = useCallback((
    resolution: TypeAnswerResolution,
    feedbackByField: TypeAnswerFeedbackMap,
    message: string,
  ) => {
    if (!queuedCard) {
      return
    }

    commitSessionAction(queuedCard.id, resolution === 'correct' ? 'good' : 'again')
    setResolvedCardState({
      card: queuedCard,
      promptField: currentPromptField,
      resolution,
    })
    setTypeAnswerFeedback(feedbackByField)
    setShowHint((current) => current || resolution === 'again')
    setTypeAnswerMessage(message)
  }, [commitSessionAction, currentPromptField, queuedCard])

  const handleCheckTypeAnswer = () => {
    if (!queuedCard) {
      return
    }

    const evaluation = evaluateTypeAnswerAttempt(queuedCard, answerInputs, answerFields)
    setTypeAnswerFeedback(evaluation.feedbackByField)

    if (evaluation.allCorrect) {
      resolveTypeAnswer(
        'correct',
        evaluation.feedbackByField,
        'Đúng cả hai phần. Nhịp này đã được chốt và từ kế tiếp đang chờ bạn.',
      )
      return
    }

    setTypeAnswerMessage(buildTypeAnswerFailureMessage(evaluation.feedbackByField, answerFields))
  }

  const handleTypeAnswerAgain = useCallback(() => {
    if (!queuedCard) {
      return
    }

    const evaluation = evaluateTypeAnswerAttempt(queuedCard, answerInputs, answerFields)
    resolveTypeAnswer(
      'again',
      evaluation.feedbackByField,
      'Đã mở đáp án đúng và đưa từ này về vòng sau của batch để bạn gặp lại sau.',
    )
  }, [answerFields, answerInputs, queuedCard, resolveTypeAnswer])

  const handleTypeAnswerSkip = useCallback(() => {
    if (!queuedCard) {
      return
    }
    commitSessionAction(queuedCard.id, 'skip')
    setTypeAnswerFeedback({})
    setTypeAnswerMessage(null)
    setShowHint(false)
    setAnswerInputs(EMPTY_INPUTS)
  }, [commitSessionAction, queuedCard])

  const handleAdvanceResolvedCard = useCallback(() => {
    setResolvedCardState(null)
    setTypeAnswerFeedback({})
    setTypeAnswerMessage(null)
    setShowHint(false)
    setAnswerInputs(EMPTY_INPUTS)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!currentCard || isEditableTarget(event.target)) return

      if ((event.key === 'a' || event.key === 'A') && currentCard.audioText) {
        event.preventDefault()
        onSpeak(currentCard.audioText)
        return
      }

      if (event.shiftKey && (event.key === 'R' || event.key === 'r')) {
        event.preventDefault()
        handleRestartSession()
        return
      }

      if (practiceMode === 'flashcard') {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          flipCard()
          return
        }
        if (event.key === '1') {
          event.preventDefault()
          handleFlashcardAction('again')
        } else if (event.key === '2') {
          event.preventDefault()
          handleFlashcardAction('hard')
        } else if (event.key === '3') {
          event.preventDefault()
          handleFlashcardAction('good')
        }
        return
      }

      if (resolvedCardState && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        handleAdvanceResolvedCard()
        return
      }

      if (event.key === '1') {
        event.preventDefault()
        handleTypeAnswerAgain()
      } else if (event.key === '2') {
        event.preventDefault()
        handleTypeAnswerSkip()
      } else if (event.key === 'h' || event.key === 'H') {
        event.preventDefault()
        setShowHint((current) => !current)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    currentCard,
    flipCard,
    handleAdvanceResolvedCard,
    handleFlashcardAction,
    handleRestartSession,
    handleTypeAnswerAgain,
    handleTypeAnswerSkip,
    onSpeak,
    practiceMode,
    resolvedCardState,
  ])

  return (
    <section className="view">
      <div className="review-header panel">
        <div className="review-header__lead">
          <p className="eyebrow">Review — Batch mode</p>
          <h2>Ôn theo block 10 từ, xong vòng mới quay lại chỗ hẫng.</h2>
        </div>

        <div className="review-header-controls">
          <label className="filter-field" style={{ minWidth: '13rem' }}>
            <span>Deck đang ôn</span>
            <select
              value={selectedDeckId}
              onChange={(event) => {
                setResolvedCardState(null)
                setSessionStartCardId(null)
                setStartCardPickerValue('')
                setStartCardSearch('')
                setRevealed(false)
                onSelectDeck(event.target.value)
              }}
            >
              {deckOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="filter-field" style={{ minWidth: '12rem' }}>
            <span>Hình thức học</span>
            <select
              value={practiceMode}
              onChange={(event) => handlePracticeModeChange(event.target.value as ReviewPracticeMode)}
            >
              <option value="flashcard">Flashcard</option>
              <option value="type_answer">Điền đáp án</option>
            </select>
          </label>

          <label className="filter-field" style={{ minWidth: '12rem' }}>
            <span>Kiểu trộn</span>
            <select
              value={mixMode}
              onChange={(event) => {
                setRevealed(false)
                setResolvedCardState(null)
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
        </div>
      </div>

      <div className="review-grid">
        <article
          className={`panel review-stage ${stageFeedback ? `stage-feedback stage-feedback--${stageFeedback}` : ''}`}
        >
          <div className="review-progress">
            <div className="progress-meta">
              <span className="eyebrow">Tiến độ phiên</span>
              <strong>{progressPercent}%</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="session-chips">
              <span className="tag-pill subdued">
                Batch {sessionState.batchIndex || 0}/{totalBatchCount || 0}
              </span>
              <span className="tag-pill subdued">
                Vòng {sessionState.roundIndex || 0}
              </span>
              <span className="tag-pill subdued">
                Còn {pendingCount}/{initialTotal} từ
              </span>
              <span className="tag-pill warn">
                Retry {sessionState.retryCardIds.length}
              </span>
              <span className="tag-pill subdued">
                Checkpoint {sessionState.checkpointCardIds.length}
              </span>
              {sessionState.combo > 0 && (
                <span className="tag-pill">Combo {sessionState.combo}</span>
              )}
              {activeMilestone !== null && (
                <span className="tag-pill milestone-pill">Mốc {activeMilestone} liên tiếp</span>
              )}
            </div>
          </div>

          {!studyReady && (
            <div className="empty-state">
              <h3>Đang nạp IndexedDB…</h3>
              <p>Chờ tiến độ học được tải trước khi dựng batch review.</p>
            </div>
          )}

          {studyReady && currentCard && practiceMode === 'flashcard' && (
            <>
              <div className="review-status">
                <span className="tag-pill subdued">{currentDeck?.title ?? 'Deck tổng'}</span>
                {sessionState.startCardId === currentCard.id && (
                  <span className="tag-pill">Từ bắt đầu</span>
                )}
                {sessionState.troubleCardIds.includes(currentCard.id) && (
                  <span className="tag-pill danger">Trouble card</span>
                )}
              </div>

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
                  <span className="flashcard-face flashcard-face--front">
                    <h3>{currentCard.hanzi}</h3>
                    <p className="flashcard-instruction">
                      Chạm vào thẻ để lật đáp án, rồi chấm lại trong nhịp batch hiện tại.
                    </p>
                  </span>

                  <span className="flashcard-face flashcard-face--back">
                    <span className="answer-sheet">
                      <h3>{currentCard.hanzi}</h3>
                      <span className="answer-pinyin-row">
                        <span className="answer-label">Pinyin</span>
                        <strong>{currentCard.pinyin}</strong>
                      </span>
                      <span className="answer-meaning">{currentCard.meaningVi}</span>
                      {exampleDisplayState.hasDistinctExample && (
                        <span className="answer-example-block">
                          {exampleDisplayState.showExampleZh && (
                            <span className="zh">{currentCard.exampleZh}</span>
                          )}
                          {exampleDisplayState.showExamplePinyin && currentCard.examplePinyin && (
                            <span className="vi answer-example-pinyin">{currentCard.examplePinyin}</span>
                          )}
                          {exampleDisplayState.showExampleVi && (
                            <span className="vi">{currentCard.exampleVi}</span>
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </span>
              </button>

              <div className="review-actions-grid">
                {reviewActions.map((action) => (
                  <button
                    key={action.ease}
                    type="button"
                    className={`score-button ${reviewTone(action.ease)}`}
                    onClick={() => handleFlashcardAction(action.ease)}
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
                  Batch này chỉ quay lại sau khi hết vòng, không nhảy lại ngay như trước.
                </span>
              </div>
            </>
          )}

          {studyReady && currentCard && practiceMode === 'type_answer' && (
            <>
              <div className="review-status">
                <span className="tag-pill subdued">{currentDeck?.title ?? 'Deck tổng'}</span>
                <span className="tag-pill subdued">Clue: {fieldLabel(currentPromptField)}</span>
                {resolvedCardState?.resolution === 'again' && (
                  <span className="tag-pill warn">Sẽ quay lại vòng sau</span>
                )}
              </div>

              <div className={`panel type-answer-stage ${resolvedCardState ? 'is-resolved' : ''}`}>
                <div className="type-answer-clue">
                  <span className="answer-label">Dữ kiện cho sẵn</span>
                  <strong>{fieldLabel(currentPromptField)}</strong>
                  <p>{getCardFieldValue(currentCard, currentPromptField)}</p>
                </div>

                <div className="type-answer-grid">
                  {answerFields.map((field) => (
                    <label
                      key={field}
                      className={`type-answer-field ${
                        typeAnswerFeedback[field] ? `is-${typeAnswerFeedback[field]?.status}` : ''
                      }`}
                    >
                      <span>{fieldLabel(field)}</span>
                      <input
                        type="text"
                        value={
                          resolvedCardState
                            ? getCardFieldValue(currentCard, field)
                            : answerInputs[field]
                        }
                        onChange={(event) => handleTypeAnswerInputChange(field, event.target.value)}
                        disabled={Boolean(resolvedCardState)}
                        placeholder={`Điền ${fieldLabel(field).toLowerCase()}`}
                      />
                    </label>
                  ))}
                </div>

                {answerFields.some((field) => typeAnswerFeedback[field]) && (
                  <div className="type-answer-feedback-grid">
                    {answerFields.map((field) => {
                      const feedback = typeAnswerFeedback[field]
                      if (!feedback) {
                        return null
                      }

                      return (
                        <article
                          key={`${field}-feedback`}
                          className={`type-answer-feedback type-answer-feedback--${feedback.status}`}
                        >
                          <div className="type-answer-feedback__head">
                            <span>{fieldLabel(field)}</span>
                            <strong>{TYPE_ANSWER_STATUS_LABEL[feedback.status]}</strong>
                          </div>
                          <p>{feedback.summary}</p>
                          <small>{feedback.detail}</small>
                        </article>
                      )
                    })}
                  </div>
                )}

                {typeAnswerMessage && (
                  <p className={`type-answer-message ${resolvedCardState?.resolution === 'correct' ? 'is-success' : ''}`}>
                    {typeAnswerMessage}
                  </p>
                )}

                {showHint && exampleDisplayState.hasDistinctExample && (
                  <div className="type-answer-hint">
                    <span className="answer-label">Gợi ý theo ngữ cảnh</span>
                    {hintQuality && (
                      <span className={`tag-pill ${hintQuality.tone === 'warn' ? 'warn' : 'subdued'}`}>
                        {hintQuality.text}
                      </span>
                    )}
                    {exampleDisplayState.showExampleZh && <strong>{currentCard.exampleZh}</strong>}
                    {exampleDisplayState.showExamplePinyin && currentCard.examplePinyin && (
                      <p>{currentCard.examplePinyin}</p>
                    )}
                    {exampleDisplayState.showExampleVi && <small>{currentCard.exampleVi}</small>}
                  </div>
                )}

                {resolvedCardState ? (
                  <div className="answer-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleAdvanceResolvedCard}
                    >
                      Sang từ kế tiếp
                    </button>
                    <button
                      type="button"
                      className="ghost-button utility-button compact-button"
                      onClick={() => onSpeak(currentCard.audioText)}
                    >
                      Phát âm
                    </button>
                  </div>
                ) : (
                  <div className="type-answer-actions">
                    <button type="button" className="primary-button" onClick={handleCheckTypeAnswer}>
                      Kiểm tra đáp án
                    </button>
                    <button
                      type="button"
                      className={`ghost-button compact-button ${showHint ? 'is-active' : ''}`}
                      onClick={() => setShowHint((current) => !current)}
                    >
                      {showHint ? 'Ẩn gợi ý' : 'Gợi ý (H)'}
                    </button>
                    <button type="button" className="ghost-button compact-button" onClick={handleTypeAnswerAgain}>
                      Không nhớ (1)
                    </button>
                    <button type="button" className="ghost-button compact-button" onClick={handleTypeAnswerSkip}>
                      Bỏ qua (2)
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {studyReady && !currentCard && !sessionComplete && (
            <div className="empty-state">
              <h3>Batch đã trống.</h3>
              <p>Không còn từ đến hạn trong session hiện tại. Chuyển deck khác hoặc mở Reader để đọc lại ngữ cảnh.</p>
            </div>
          )}

          {sessionComplete && (
            <div className="session-summary">
              <div>
                <p className="eyebrow">Session complete</p>
                <h3>Batch hiện tại đã khép lại. Bạn có thể nghỉ ngắn hoặc chuyển sang Reader.</h3>
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
                  <span>Batch đã chạy</span>
                  <strong>{sessionState.batchIndex}</strong>
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

        <div className="review-side">
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
                onClick={() => setSoundEnabled((current) => !current)}
              >
                {soundEnabled ? '♪ Âm: Bật' : '♪ Âm: Tắt'}
              </button>
              <button
                type="button"
                className={`sound-toggle ${motionPreference === 'full' ? 'is-enabled' : ''}`}
                onClick={() => setMotionPreference((current) => current === 'full' ? 'reduced' : 'full')}
              >
                {motionPreference === 'full' ? '↻ Motion: Đầy đủ' : '↻ Motion: Giảm'}
              </button>
            </div>

            <label className="filter-field">
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
            {voiceMode === 'male' && !hasMaleChineseVoice && (
              <p className="review-shortcut-tip">Thiết bị chưa có giọng nam tiếng Trung, đang fallback sang giọng khả dụng.</p>
            )}
            {voiceMode === 'female' && !hasFemaleChineseVoice && (
              <p className="review-shortcut-tip">Thiết bị chưa có giọng nữ tiếng Trung, đang fallback sang giọng khả dụng.</p>
            )}

            <label className="filter-field">
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

            <label className="filter-field">
              <span>Tìm từ để bắt đầu trước</span>
              <input
                type="search"
                value={startCardSearch}
                onChange={(event) => setStartCardSearch(event.target.value)}
                placeholder="Hanzi / pinyin / nghĩa"
              />
            </label>

            <label className="filter-field">
              <span>Từ ưu tiên</span>
              <select
                value={startCardPickerValue}
                onChange={(event) => setStartCardPickerValue(event.target.value)}
              >
                <option value="">Không khóa từ đầu phiên</option>
                {filteredStartCards.slice(0, 60).map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.hanzi} · {card.pinyin} · {card.meaningVi}
                  </option>
                ))}
              </select>
            </label>

            <button type="button" className="ghost-button" onClick={handleApplyStartCard}>
              Áp dụng từ bắt đầu
            </button>

            <div className="review-controls__actions">
              <button type="button" className="ghost-button" onClick={handleRestartSession} disabled={!studyReady}>
                Restart phiên
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={handleResetDeck}
                disabled={!selectedDeck || activeReset !== null}
              >
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
              <p className="review-shortcut-tip">Chọn deck cụ thể để dùng “Reset deck”.</p>
            )}

            <div className="session-summary__stats">
              <div className="mini-stat">
                <span>Batch hiện tại</span>
                <strong>{sessionState.batchIndex || 0}</strong>
              </div>
              <div className="mini-stat">
                <span>Retry</span>
                <strong>{sessionState.retryCardIds.length}</strong>
              </div>
              <div className="mini-stat">
                <span>Checkpoint</span>
                <strong>{sessionState.checkpointCardIds.length}</strong>
              </div>
              <div className="mini-stat">
                <span>Best combo</span>
                <strong>{sessionState.bestCombo}</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
