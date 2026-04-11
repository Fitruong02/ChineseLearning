import type { CardKind, PartOfSpeech, PublishedCard } from '../types'

const MAJOR_SENTENCE_PUNCTUATION = ['。', '！', '？', '!', '?', ';', '；', '\n']
const MINOR_SENTENCE_HINTS = ['，', ',', '：', ':']

const PART_OF_SPEECH_LABELS: Record<PartOfSpeech, string> = {
  noun: 'Danh từ',
  verb: 'Động từ',
  adjective: 'Tính từ',
  adverb: 'Trạng từ',
  idiom: 'Thành ngữ',
  phrase: 'Cụm từ',
  unknown: 'Chưa rõ',
}

const CARD_KIND_LABELS: Record<CardKind, string> = {
  term: 'Từ / cụm từ',
  sentence: 'Câu / đoạn',
}

const normalizeHanzi = (value: string) =>
  value
    .normalize('NFC')
    .replace(/\s+/g, '')
    .trim()

const countPinyinSyllables = (value: string) =>
  (value.match(/[A-Za-züÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+/g) ?? []).length

export const getCardKind = (card: Pick<PublishedCard, 'hanzi' | 'pinyin' | 'tags' | 'cardKind'>): CardKind => {
  if (card.cardKind === 'term' || card.cardKind === 'sentence') {
    return card.cardKind
  }

  const cleanedHanzi = normalizeHanzi(card.hanzi)
  if (!cleanedHanzi) {
    return 'sentence'
  }

  if (card.tags.includes('vocab-auto')) {
    return 'term'
  }

  if (MAJOR_SENTENCE_PUNCTUATION.some((mark) => card.hanzi.includes(mark))) {
    return 'sentence'
  }

  if (cleanedHanzi.length > 10) {
    return 'sentence'
  }

  if (countPinyinSyllables(card.pinyin) > 5) {
    return 'sentence'
  }

  if (cleanedHanzi.length > 8 && MINOR_SENTENCE_HINTS.some((mark) => card.hanzi.includes(mark))) {
    return 'sentence'
  }

  if (/\d/.test(cleanedHanzi) && cleanedHanzi.length > 10) {
    return 'sentence'
  }

  return 'term'
}

export const isReviewEligibleCard = (card: Pick<PublishedCard, 'hanzi' | 'pinyin' | 'tags' | 'cardKind'>) =>
  getCardKind(card) === 'term'

export const dedupeReviewCards = <T extends Pick<PublishedCard, 'hanzi' | 'pinyin' | 'tags' | 'cardKind'>>(
  cards: T[],
) => {
  const seenKeys = new Set<string>()

  return cards.filter((card) => {
    const key = normalizeHanzi(card.hanzi)
    if (!key || seenKeys.has(key)) {
      return false
    }
    seenKeys.add(key)
    return true
  })
}

export const getPartOfSpeech = (
  card: Pick<PublishedCard, 'partOfSpeech' | 'hanzi' | 'pinyin' | 'tags' | 'cardKind'>,
): PartOfSpeech | null => {
  if (getCardKind(card) !== 'term') {
    return null
  }

  if (
    card.partOfSpeech === 'noun' ||
    card.partOfSpeech === 'verb' ||
    card.partOfSpeech === 'adjective' ||
    card.partOfSpeech === 'adverb' ||
    card.partOfSpeech === 'idiom' ||
    card.partOfSpeech === 'phrase' ||
    card.partOfSpeech === 'unknown'
  ) {
    return card.partOfSpeech
  }

  return null
}

export const getPartOfSpeechLabel = (partOfSpeech: PartOfSpeech | null) =>
  partOfSpeech ? PART_OF_SPEECH_LABELS[partOfSpeech] : null

export const getCardKindLabel = (cardKind: CardKind) => CARD_KIND_LABELS[cardKind]
