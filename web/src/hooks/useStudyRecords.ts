import { useEffect, useRef, useState } from 'react'
import {
  clearStudyRecords,
  deleteStudyRecords,
  listStudyRecords,
  saveStudyRecord,
} from '../lib/indexedDb'
import { normalizeStudyRecord, scheduleReview } from '../lib/srs'
import type { ReviewEase, ReviewSessionContext, StudyRecordMap } from '../types'

const EMPTY_RECORDS: StudyRecordMap = {}

export const useStudyRecords = () => {
  const [records, setRecords] = useState<StudyRecordMap>(EMPTY_RECORDS)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionResetVersion, setSessionResetVersion] = useState(0)
  const recordsRef = useRef(records)

  useEffect(() => {
    recordsRef.current = records
  }, [records])

  useEffect(() => {
    let cancelled = false

    const hydrate = async () => {
      try {
        const persisted = await listStudyRecords()

        if (cancelled) {
          return
        }

        const nextRecords = persisted.reduce<StudyRecordMap>(
          (accumulator, record) => {
            const normalized = normalizeStudyRecord(record)

            if (!normalized) {
              return accumulator
            }

            accumulator[normalized.cardId] = normalized
            return accumulator
          },
          {},
        )

        setRecords(nextRecords)
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Không đọc được dữ liệu ôn tập cục bộ.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsReady(true)
        }
      }
    }

    hydrate()

    return () => {
      cancelled = true
    }
  }, [])

  const reviewCard = async (
    cardId: string,
    ease: ReviewEase,
    sessionContext?: ReviewSessionContext,
  ) => {
    const reviewTime = sessionContext?.occurredAt
      ? new Date(sessionContext.occurredAt)
      : new Date()
    const updatedRecord = {
      ...scheduleReview(recordsRef.current[cardId], ease, reviewTime),
      cardId,
    }

    setError(null)
    setRecords((current) => ({
      ...current,
      [cardId]: updatedRecord,
    }))

    try {
      await saveStudyRecord(updatedRecord)
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Không lưu được lịch ôn tập.',
      )
    }
  }

  const resetCurrentSession = () => {
    setSessionResetVersion((current) => current + 1)
  }

  const resetDeckProgress = async (cardIds: string[]) => {
    if (cardIds.length === 0) {
      return
    }

    setError(null)

    setRecords((current) => {
      const nextRecords = { ...current }
      cardIds.forEach((cardId) => {
        delete nextRecords[cardId]
      })
      return nextRecords
    })
    setSessionResetVersion((current) => current + 1)

    try {
      await deleteStudyRecords(cardIds)
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Không xóa được tiến độ của deck.',
      )
    }
  }

  const resetAllProgress = async () => {
    setError(null)
    setRecords(EMPTY_RECORDS)
    setSessionResetVersion((current) => current + 1)

    try {
      await clearStudyRecords()
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Không xóa được toàn bộ tiến độ học.',
      )
    }
  }

  return {
    records,
    isReady,
    error,
    reviewCard,
    resetCurrentSession,
    resetDeckProgress,
    resetAllProgress,
    sessionResetVersion,
  }
}
