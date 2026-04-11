import type { PublishedCard } from '../types'
import { normalizeHanzi, normalizeMeaning, normalizePinyin } from './reviewSession'

export interface CardExampleDisplayState {
  hasDistinctExample: boolean
  showExampleZh: boolean
  showExamplePinyin: boolean
  showExampleVi: boolean
}

export const getCardExampleDisplayState = (
  card: Pick<
    PublishedCard,
    'hanzi' | 'pinyin' | 'meaningVi' | 'exampleZh' | 'examplePinyin' | 'exampleVi'
  >,
): CardExampleDisplayState => {
  const showExampleZh =
    Boolean(card.exampleZh) && normalizeHanzi(card.exampleZh) !== normalizeHanzi(card.hanzi)
  const showExamplePinyin =
    Boolean(card.examplePinyin) &&
    normalizePinyin(card.examplePinyin ?? '') !== normalizePinyin(card.pinyin)
  const showExampleVi =
    Boolean(card.exampleVi) &&
    normalizeMeaning(card.exampleVi) !== normalizeMeaning(card.meaningVi)

  return {
    hasDistinctExample: showExampleZh || showExamplePinyin || showExampleVi,
    showExampleZh,
    showExamplePinyin,
    showExampleVi,
  }
}
