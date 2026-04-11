export type TabId = 'dashboard' | 'library' | 'review' | 'reader' | 'drafts'

export type MaterialType = 'pdf' | 'text'
export type OcrMode = 'embedded-text' | 'ocr' | 'manual'
export type DraftStatus = 'draft' | 'approved' | 'rejected'
export type ReviewEase = 'again' | 'hard' | 'good' | 'easy'
export type FocusState = 'normal' | 'trouble'
export type MotionPreference = 'full' | 'reduced'
export type ReviewMixMode = 'random' | 'by_lesson' | 'by_phonetic'
export type PhoneticMode = 'initial' | 'final'
export type ReviewPracticeMode = 'flashcard' | 'type_answer'
export type PromptField = 'hanzi' | 'pinyin' | 'meaningVi'
export type CardKind = 'term' | 'sentence'
export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'idiom' | 'phrase' | 'unknown'

export interface MaterialSegment {
  text: string
  cardId?: string
}

export interface MaterialSection {
  id: string
  heading: string
  textZh: string
  textPinyin?: string
  textVi: string
  focusCardIds: string[]
  segments?: MaterialSegment[]
}

export interface MaterialSource {
  id: string
  title: string
  type: MaterialType
  originPath: string
  language: string
  importedAt: string
  ocrMode: OcrMode
  summary: string
  tags: string[]
  linkedDeckIds: string[]
  sections: MaterialSection[]
}

export interface PublishedCard {
  id: string
  deckId: string
  hanzi: string
  pinyin: string
  meaningVi: string
  exampleZh: string
  examplePinyin?: string
  exampleVi: string
  audioText: string
  tags: string[]
  cardKind?: CardKind
  partOfSpeech?: PartOfSpeech
}

export interface PublishedDeck {
  id: string
  title: string
  description: string
  level: string
  materialId: string
  createdAt: string
  tags: string[]
  cards: PublishedCard[]
}

export interface DraftCard {
  id: string
  materialId: string
  hanzi: string
  pinyin: string
  meaningVi: string
  exampleZh: string
  examplePinyin?: string
  exampleVi: string
  sourceSnippet: string
  tags: string[]
  confidence: number
  status: DraftStatus
  cardKind?: CardKind
  partOfSpeech?: PartOfSpeech
}

export interface DraftDeck {
  id: string
  title: string
  description: string
  level: string
  materialId: string
  createdAt: string
  sourcePath: string
  model: string
  tags: string[]
  notes: string[]
  cards: DraftCard[]
}

export interface ContentManifest {
  version: number
  generatedAt: string
  materials: string[]
  publishedDecks: string[]
  draftDecks: string[]
}

export interface ContentLibrary {
  manifest: ContentManifest
  materials: MaterialSource[]
  publishedDecks: PublishedDeck[]
  draftDecks: DraftDeck[]
}

export interface StudyRecord {
  cardId: string
  ease: ReviewEase
  intervalDays: number
  repetitions: number
  efactor: number
  dueAt: string
  lastReviewedAt: string
  lapseCount: number
  consecutiveCorrect: number
  lastAgainAt: string | null
  focusState: FocusState
}

export type StudyRecordMap = Record<string, StudyRecord>

export interface ReviewSessionQueueItem {
  cardId: string
  availableAfterReviews: number
  availableAt: number
  reason: 'again' | 'checkpoint'
}

export interface ReviewSessionContext {
  occurredAt?: string
}

export interface ReviewSessionState {
  initialCardIds: string[]
  practiceMode: ReviewPracticeMode
  startCardId: string | null
  remainingBatchCardIds: string[]
  activeBatchCardIds: string[]
  currentRoundCardIds: string[]
  retryCardIds: string[]
  checkpointCardIds: string[]
  reviewedCardIds: string[]
  completedCardIds: string[]
  troubleCardIds: string[]
  promptFieldByCardId: Record<string, PromptField>
  combo: number
  bestCombo: number
  answeredCount: number
  motionPreference: MotionPreference
  mixMode: ReviewMixMode
  phoneticMode: PhoneticMode
  batchIndex: number
  roundIndex: number
}

export interface ReviewNavigationOptions {
  deckId?: string
  startCardId?: string
  mode?: ReviewPracticeMode
}
