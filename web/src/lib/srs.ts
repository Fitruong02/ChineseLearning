import type { FocusState, ReviewEase, StudyRecord } from '../types'

const MIN_E_FACTOR = 1.3
const DAY_IN_MS = 24 * 60 * 60 * 1000
const TROUBLE_LAPSE_THRESHOLD = 3
const TROUBLE_RECOVERY_STREAK = 4

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const qualityScore: Record<ReviewEase, number> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
}

export const isCardDue = (record: StudyRecord | undefined, now = new Date()) =>
  !record || new Date(record.dueAt).getTime() <= now.getTime()

export const normalizeStudyRecord = (
  record: Partial<StudyRecord> | undefined,
): StudyRecord | undefined => {
  if (!record?.cardId) {
    return undefined
  }

  return {
    cardId: record.cardId,
    ease: record.ease ?? 'good',
    intervalDays: record.intervalDays ?? 0,
    repetitions: record.repetitions ?? 0,
    efactor: record.efactor ?? 2.5,
    dueAt: record.dueAt ?? new Date(0).toISOString(),
    lastReviewedAt: record.lastReviewedAt ?? new Date(0).toISOString(),
    lapseCount: record.lapseCount ?? 0,
    consecutiveCorrect: record.consecutiveCorrect ?? 0,
    lastAgainAt: record.lastAgainAt ?? null,
    focusState: record.focusState ?? 'normal',
  }
}

const resolveFocusState = (
  previousFocusState: FocusState,
  lapseCount: number,
  consecutiveCorrect: number,
) => {
  if (lapseCount >= TROUBLE_LAPSE_THRESHOLD && consecutiveCorrect < TROUBLE_RECOVERY_STREAK) {
    return 'trouble'
  }

  if (previousFocusState === 'trouble' && consecutiveCorrect < TROUBLE_RECOVERY_STREAK) {
    return 'trouble'
  }

  return 'normal'
}

export const scheduleReview = (
  previousRecord: StudyRecord | undefined,
  ease: ReviewEase,
  now = new Date(),
): StudyRecord => {
  const normalizedPrevious = normalizeStudyRecord(previousRecord)
  const quality = qualityScore[ease]
  const previousEfactor = normalizedPrevious?.efactor ?? 2.5
  let repetitions = normalizedPrevious?.repetitions ?? 0
  let intervalDays = normalizedPrevious?.intervalDays ?? 0
  let lapseCount = normalizedPrevious?.lapseCount ?? 0
  let consecutiveCorrect = normalizedPrevious?.consecutiveCorrect ?? 0
  let lastAgainAt = normalizedPrevious?.lastAgainAt ?? null

  const nextEfactor = clamp(
    previousEfactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    MIN_E_FACTOR,
    3,
  )

  if (ease === 'again') {
    repetitions = 0
    intervalDays = 0.02
    lapseCount += 1
    consecutiveCorrect = 0
    lastAgainAt = now.toISOString()
  } else if (ease === 'hard') {
    repetitions += 1
    intervalDays =
      repetitions <= 1
        ? 1
        : Math.max(
            1,
            Number(((normalizedPrevious?.intervalDays ?? 1) * 1.2).toFixed(2)),
          )
    consecutiveCorrect += 1
  } else if (ease === 'good') {
    repetitions += 1
    if (repetitions === 1) {
      intervalDays = 1
    } else if (repetitions === 2) {
      intervalDays = 6
    } else {
      intervalDays = Math.max(
        1,
        Number(((normalizedPrevious?.intervalDays ?? 1) * nextEfactor).toFixed(2)),
      )
    }
    consecutiveCorrect += 1
  } else {
    repetitions += 1
    if (repetitions === 1) {
      intervalDays = 3
    } else if (repetitions === 2) {
      intervalDays = 8
    } else {
      intervalDays = Math.max(
        1,
        Number(
          ((normalizedPrevious?.intervalDays ?? 1) * nextEfactor * 1.3).toFixed(2),
        ),
      )
    }
    consecutiveCorrect += 1
  }

  const focusState = resolveFocusState(
    normalizedPrevious?.focusState ?? 'normal',
    lapseCount,
    consecutiveCorrect,
  )

  return {
    cardId: normalizedPrevious?.cardId ?? '',
    ease,
    intervalDays,
    repetitions,
    efactor: Number(nextEfactor.toFixed(2)),
    dueAt: new Date(now.getTime() + intervalDays * DAY_IN_MS).toISOString(),
    lastReviewedAt: now.toISOString(),
    lapseCount,
    consecutiveCorrect,
    lastAgainAt,
    focusState,
  }
}

export const isTroubleRecord = (record: StudyRecord | undefined) =>
  normalizeStudyRecord(record)?.focusState === 'trouble'

export const formatRelativeDue = (record: StudyRecord | undefined) => {
  if (!record) {
    return 'Thẻ mới'
  }

  if (record.intervalDays < 1) {
    return 'Ôn lại trong hôm nay'
  }

  return `${record.intervalDays.toFixed(record.intervalDays >= 10 ? 0 : 1)} ngày`
}

export const reviewTone = (ease: ReviewEase) => {
  if (ease === 'again') {
    return 'tone-danger'
  }

  if (ease === 'hard') {
    return 'tone-warn'
  }

  if (ease === 'good') {
    return 'tone-good'
  }

  return 'tone-strong'
}
