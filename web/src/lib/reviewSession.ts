import { isCardDue, isTroubleRecord } from './srs'
import { dedupeReviewCards, isReviewEligibleCard } from './cardMetadata'
import type {
  MotionPreference,
  PhoneticMode,
  PromptField,
  PublishedCard,
  ReviewEase,
  ReviewMixMode,
  ReviewPracticeMode,
  ReviewSessionState,
  StudyRecordMap,
} from '../types'

export const BATCH_SIZE = 10

const PROMPT_ROTATION: PromptField[] = ['meaningVi', 'hanzi', 'pinyin']

const PINYIN_INITIALS = [
  'zh', 'ch', 'sh',
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h',
  'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w',
]

const includeUnique = (items: string[], value: string) =>
  items.includes(value) ? items : [...items, value]

const removeValue = (items: string[], value: string) =>
  items.filter((item) => item !== value)

const shuffleArray = <T,>(items: T[]) => {
  const output = [...items]
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[output[index], output[swapIndex]] = [output[swapIndex], output[index]]
  }
  return output
}

export const normalizePinyin = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

export const normalizeMeaning = (value: string) =>
  value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/[“”"'`´‘’.,;:!?()[\]{}]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

export const normalizeHanzi = (value: string) =>
  value
    .normalize('NFC')
    .replace(/\s+/g, '')
    .trim()

const sortCardsForSession = (cards: PublishedCard[], records: StudyRecordMap) =>
  [...cards].sort((left, right) => {
    const leftRecord = records[left.id]
    const rightRecord = records[right.id]
    if (!leftRecord && rightRecord) return -1
    if (leftRecord && !rightRecord) return 1
    const dueCompare = (leftRecord?.dueAt ?? '').localeCompare(rightRecord?.dueAt ?? '')
    if (dueCompare !== 0) return dueCompare
    return left.hanzi.localeCompare(right.hanzi)
  })

const splitPinyinSyllables = (rawPinyin: string) =>
  normalizePinyin(rawPinyin)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

const splitInitialFinal = (syllable: string) => {
  const matchedInitial = PINYIN_INITIALS.find((initial) => syllable.startsWith(initial))
  if (matchedInitial) {
    const final = syllable.slice(matchedInitial.length) || 'empty'
    return { initial: matchedInitial, final }
  }
  return { initial: 'zero', final: syllable || 'other' }
}

const getPinyinInitialFinal = (rawPinyin: string) => {
  const syllables = splitPinyinSyllables(rawPinyin)
  if (syllables.length === 0) {
    return { initialPattern: 'other', finalPattern: 'other' }
  }

  const parts = syllables.map(splitInitialFinal)
  return {
    initialPattern: parts.map((part) => part.initial).join('-'),
    finalPattern: parts.map((part) => part.final).join('-'),
  }
}

const getLessonKey = (card: PublishedCard) =>
  card.tags.find((tag) => /^第.+课$/.test(tag)) ?? card.deckId

const prioritizeStartCard = (cardIds: string[], startCardId: string | null | undefined) => {
  if (!startCardId || !cardIds.includes(startCardId)) {
    return cardIds
  }

  return [startCardId, ...cardIds.filter((cardId) => cardId !== startCardId)]
}

export const buildInitialQueue = (
  cards: PublishedCard[],
  records: StudyRecordMap,
  mixMode: ReviewMixMode,
  phoneticMode: PhoneticMode,
  interleaveDecks: boolean,
  deckOrder: string[],
  startCardId?: string | null,
) => {
  const dueCards = dedupeReviewCards(
    sortCardsForSession(
      cards.filter((card) => isReviewEligibleCard(card) && isCardDue(records[card.id])),
      records,
    ),
  )

  let queue: string[]

  if (mixMode === 'random') {
    queue = shuffleArray(dueCards).map((card) => card.id)
  } else if (mixMode === 'by_lesson') {
    const groups = new Map<string, PublishedCard[]>()
    dueCards.forEach((card) => {
      const key = getLessonKey(card)
      groups.set(key, [...(groups.get(key) ?? []), card])
    })
    queue = [...groups.keys()]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) =>
        (groups.get(key) ?? [])
          .sort((left, right) => left.hanzi.localeCompare(right.hanzi))
          .map((card) => card.id),
      )
  } else if (mixMode === 'by_phonetic') {
    const groups = new Map<string, PublishedCard[]>()
    dueCards.forEach((card) => {
      const { initialPattern, finalPattern } = getPinyinInitialFinal(card.pinyin)
      const key = phoneticMode === 'initial' ? initialPattern : finalPattern
      groups.set(key, [...(groups.get(key) ?? []), card])
    })
    queue = [...groups.keys()]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) =>
        (groups.get(key) ?? [])
          .sort((left, right) => left.hanzi.localeCompare(right.hanzi))
          .map((card) => card.id),
      )
  } else if (interleaveDecks) {
    const grouped = new Map<string, PublishedCard[]>()
    dueCards.forEach((card) => {
      grouped.set(card.deckId, [...(grouped.get(card.deckId) ?? []), card])
    })

    const interleaved: string[] = []
    while (true) {
      let picked = false
      deckOrder.forEach((deckId) => {
        const group = grouped.get(deckId)
        if (!group?.length) {
          return
        }
        const nextCard = group.shift()
        if (!nextCard) {
          return
        }
        interleaved.push(nextCard.id)
        picked = true
      })
      if (!picked) {
        break
      }
    }
    queue = interleaved
  } else {
    queue = dueCards.map((card) => card.id)
  }

  return prioritizeStartCard(queue, startCardId)
}

const buildPromptFieldByCardId = (cardIds: string[]) =>
  cardIds.reduce<Record<string, PromptField>>((accumulator, cardId, index) => {
    accumulator[cardId] = PROMPT_ROTATION[index % PROMPT_ROTATION.length]
    return accumulator
  }, {})

const createBatchSnapshot = (cardIds: string[]) => ({
  activeBatchCardIds: cardIds.slice(0, BATCH_SIZE),
  remainingBatchCardIds: cardIds.slice(BATCH_SIZE),
})

export const createReviewSession = (
  initialCardIds: string[],
  options: {
    motionPreference: MotionPreference
    mixMode: ReviewMixMode
    phoneticMode: PhoneticMode
    practiceMode: ReviewPracticeMode
    startCardId?: string | null
    records: StudyRecordMap
  },
): ReviewSessionState => {
  const { activeBatchCardIds, remainingBatchCardIds } = createBatchSnapshot(initialCardIds)

  return {
    initialCardIds,
    practiceMode: options.practiceMode,
    startCardId: options.startCardId ?? null,
    remainingBatchCardIds,
    activeBatchCardIds,
    currentRoundCardIds: activeBatchCardIds,
    retryCardIds: [],
    checkpointCardIds: [],
    reviewedCardIds: [],
    completedCardIds: [],
    troubleCardIds: initialCardIds.filter((cardId) => isTroubleRecord(options.records[cardId])),
    promptFieldByCardId: buildPromptFieldByCardId(initialCardIds),
    combo: 0,
    bestCombo: 0,
    answeredCount: 0,
    motionPreference: options.motionPreference,
    mixMode: options.mixMode,
    phoneticMode: options.phoneticMode,
    batchIndex: activeBatchCardIds.length > 0 ? 1 : 0,
    roundIndex: activeBatchCardIds.length > 0 ? 1 : 0,
  }
}

const orderForCurrentBatch = (cardIds: string[], batchCardIds: string[]) =>
  batchCardIds.filter((cardId) => cardIds.includes(cardId))

const advanceBatchState = (session: ReviewSessionState): ReviewSessionState => {
  if (session.currentRoundCardIds.length > 0) {
    return session
  }

  if (session.retryCardIds.length > 0) {
    return {
      ...session,
      currentRoundCardIds: orderForCurrentBatch(session.retryCardIds, session.activeBatchCardIds),
      retryCardIds: [],
      roundIndex: session.roundIndex + 1,
    }
  }

  if (session.checkpointCardIds.length > 0) {
    return {
      ...session,
      currentRoundCardIds: orderForCurrentBatch(session.checkpointCardIds, session.activeBatchCardIds),
      checkpointCardIds: [],
      roundIndex: session.roundIndex + 1,
    }
  }

  if (session.remainingBatchCardIds.length > 0) {
    const nextBatch = createBatchSnapshot(session.remainingBatchCardIds)
    return {
      ...session,
      activeBatchCardIds: nextBatch.activeBatchCardIds,
      remainingBatchCardIds: nextBatch.remainingBatchCardIds,
      currentRoundCardIds: nextBatch.activeBatchCardIds,
      retryCardIds: [],
      checkpointCardIds: [],
      batchIndex: session.batchIndex + 1,
      roundIndex: nextBatch.activeBatchCardIds.length > 0 ? 1 : 0,
    }
  }

  return session
}

export const applyBatchAction = (
  session: ReviewSessionState,
  cardId: string,
  action: ReviewEase | 'skip',
  records: StudyRecordMap,
): ReviewSessionState => {
  if (!session.currentRoundCardIds.includes(cardId)) {
    return session
  }

  let retryCardIds = removeValue(session.retryCardIds, cardId)
  let checkpointCardIds = removeValue(session.checkpointCardIds, cardId)
  let completedCardIds = removeValue(session.completedCardIds, cardId)
  let reviewedCardIds = session.reviewedCardIds
  let troubleCardIds = session.troubleCardIds
  const currentRoundCardIds = session.currentRoundCardIds.filter((currentId) => currentId !== cardId)
  const answeredCount = session.answeredCount + 1

  let combo = session.combo

  if (action === 'again') {
    retryCardIds = includeUnique(retryCardIds, cardId)
    reviewedCardIds = includeUnique(reviewedCardIds, cardId)
    troubleCardIds = includeUnique(troubleCardIds, cardId)
    combo = 0
  } else if (action === 'skip') {
    retryCardIds = includeUnique(retryCardIds, cardId)
    combo = 0
  } else if (action === 'hard') {
    checkpointCardIds = includeUnique(checkpointCardIds, cardId)
    reviewedCardIds = includeUnique(reviewedCardIds, cardId)
    combo += 1
  } else {
    completedCardIds = includeUnique(completedCardIds, cardId)
    reviewedCardIds = includeUnique(reviewedCardIds, cardId)
    combo += 1
    if (isTroubleRecord(records[cardId])) {
      troubleCardIds = includeUnique(troubleCardIds, cardId)
    }
  }

  return advanceBatchState({
    ...session,
    currentRoundCardIds,
    retryCardIds,
    checkpointCardIds,
    completedCardIds,
    reviewedCardIds,
    troubleCardIds,
    combo,
    bestCombo: Math.max(session.bestCombo, combo),
    answeredCount,
  })
}

export const getPromptFields = (promptField: PromptField) =>
  (['hanzi', 'pinyin', 'meaningVi'] as PromptField[]).filter((field) => field !== promptField)
