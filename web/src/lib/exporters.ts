import type { DraftCard, DraftDeck, DraftStatus, PublishedCard, PublishedDeck } from '../types'

export interface DraftCardOverride {
  status?: DraftStatus
  meaningVi?: string
  exampleZh?: string
  examplePinyin?: string
  exampleVi?: string
  mergedInto?: string | null
}

export interface ResolvedDraftCard extends DraftCard {
  mergedInto: string | null
}

const csvEscape = (value: string) => `"${value.replaceAll('"', '""')}"`

export const applyDraftOverrides = (
  cards: DraftCard[],
  overrides: Record<string, DraftCardOverride>,
): ResolvedDraftCard[] =>
  cards.map((card) => ({
    ...card,
    meaningVi: overrides[card.id]?.meaningVi ?? card.meaningVi,
    exampleZh: overrides[card.id]?.exampleZh ?? card.exampleZh,
    examplePinyin: overrides[card.id]?.examplePinyin ?? card.examplePinyin,
    exampleVi: overrides[card.id]?.exampleVi ?? card.exampleVi,
    status: overrides[card.id]?.status ?? card.status,
    mergedInto:
      overrides[card.id]?.mergedInto === undefined
        ? null
        : overrides[card.id]?.mergedInto ?? null,
  }))

export const buildPublishedDeckFromDraft = (
  deck: DraftDeck,
  overrides: Record<string, DraftCardOverride>,
): PublishedDeck => {
  const resolvedCards = applyDraftOverrides(deck.cards, overrides)
  const grouped = new Map<string, ResolvedDraftCard[]>()

  for (const card of resolvedCards) {
    if (card.status === 'rejected') {
      continue
    }

    const ownerId = card.mergedInto ?? card.id
    const group = grouped.get(ownerId) ?? []
    group.push(card)
    grouped.set(ownerId, group)
  }

  const deckId = deck.id.replace(/^draft-/, 'deck-')

  const cards = [...grouped.entries()]
    .map(([ownerId, group]) => {
      const preferred =
        group.find((card) => card.id === ownerId && card.status === 'approved') ??
        group.find((card) => card.status === 'approved')

      if (!preferred) {
        return null
      }

      const tags = [...new Set(group.flatMap((card) => card.tags))]

      return {
        id: preferred.id.replace(/^draft-/, 'card-'),
        deckId,
        hanzi: preferred.hanzi,
        pinyin: preferred.pinyin,
        meaningVi: preferred.meaningVi,
        exampleZh: preferred.exampleZh,
        ...(preferred.examplePinyin ? { examplePinyin: preferred.examplePinyin } : {}),
        exampleVi: preferred.exampleVi,
        audioText: preferred.hanzi,
        tags,
      }
    })
    .filter((card): card is PublishedCard => card !== null)
    .sort((left, right) => left.hanzi.localeCompare(right.hanzi, 'zh-Hans-CN'))

  return {
    id: deckId,
    title: deck.title.replace(/^Nháp: /, ''),
    description: deck.description,
    level: deck.level,
    materialId: deck.materialId,
    createdAt: new Date().toISOString(),
    tags: deck.tags,
    cards,
  }
}

export const buildAnkiCsv = (cards: PublishedCard[]) => {
  const header = [
    'hanzi',
    'pinyin',
    'meaningVi',
    'exampleZh',
    'examplePinyin',
    'exampleVi',
    'tags',
  ].join(',')
  const rows = cards.map((card) =>
    [
      csvEscape(card.hanzi),
      csvEscape(card.pinyin),
      csvEscape(card.meaningVi),
      csvEscape(card.exampleZh),
      csvEscape(card.examplePinyin ?? ''),
      csvEscape(card.exampleVi),
      csvEscape(card.tags.join(' ')),
    ].join(','),
  )

  return [header, ...rows].join('\n')
}
