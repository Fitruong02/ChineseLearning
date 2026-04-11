import { startTransition, useEffect, useMemo, useState } from 'react'
import { DashboardView } from './components/DashboardView'
import { DraftsView } from './components/DraftsView'
import { LibraryView } from './components/LibraryView'
import { NavigationRail } from './components/NavigationRail'
import { ReaderView } from './components/ReaderView'
import { ReviewView } from './components/ReviewView'
import { useContentLibrary } from './hooks/useContentLibrary'
import { useSpeech } from './hooks/useSpeech'
import { useStudyRecords } from './hooks/useStudyRecords'
import { isCardDue } from './lib/srs'
import type { ReviewNavigationOptions, ReviewPracticeMode, TabId } from './types'

type ThemeMode = 'light' | 'dark'

const TAB_META: Record<TabId, { title: string; description: string }> = {
  dashboard: {
    title: 'Nhịp học hôm nay',
    description: 'Xem nhanh việc cần làm, tài liệu mới và deck đáng chú ý.',
  },
  library: {
    title: 'Kho deck và tài liệu',
    description: 'Tìm deck, xem tài liệu gốc và nhảy sang review hoặc reader.',
  },
  review: {
    title: 'Phiên ôn tập tập trung',
    description: 'Lật thẻ, chấm độ nhớ và đẩy lịch SRS sang lượt kế tiếp.',
  },
  reader: {
    title: 'Reader theo ngữ cảnh',
    description: 'Đọc bài gốc, chạm vào từ khóa và xem lại card tương ứng.',
  },
  drafts: {
    title: 'Duyệt flashcard AI',
    description: 'Dọn nhiễu, chỉnh nghĩa và xuất deck chính thức hoặc CSV Anki.',
  },
}

const parseHashTab = (hash: string): TabId => {
  const n = hash.replace('#', '')
  if (n === 'dashboard' || n === 'library' || n === 'review' || n === 'reader' || n === 'drafts') return n
  return 'dashboard'
}

function App() {
  const { status, library, error } = useContentLibrary()
  const {
    records, isReady: studyReady, error: studyError,
    reviewCard, resetCurrentSession, resetDeckProgress, resetAllProgress, sessionResetVersion,
  } = useStudyRecords()
  const {
    hasChineseVoice,
    hasMaleChineseVoice,
    hasFemaleChineseVoice,
    speak,
    voiceMode,
    setVoiceMode,
    selectedVoiceUri,
    setSelectedVoiceUri,
    voiceOptions,
  } = useSpeech()

  const [activeTab, setActiveTab] = useState<TabId>(() => parseHashTab(window.location.hash))
  const [selectedDeckId, setSelectedDeckId] = useState('all')
  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [selectedDraftDeckId, setSelectedDraftDeckId] = useState('')
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null)
  const [reviewStartCardId, setReviewStartCardId] = useState<string | null>(null)
  const [requestedReviewMode, setRequestedReviewMode] = useState<ReviewPracticeMode>('flashcard')
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem('hanzi-theme-mode')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const handleHash = () => startTransition(() => setActiveTab(parseHashTab(window.location.hash)))
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    window.localStorage.setItem('hanzi-theme-mode', themeMode)
  }, [themeMode])

  const allCards = useMemo(() => library?.publishedDecks.flatMap((d) => d.cards) ?? [], [library])
  const cardsById = useMemo(() => new Map(allCards.map((c) => [c.id, c])), [allCards])
  const dueCards = useMemo(
    () => studyReady ? allCards.filter((c) => isCardDue(records[c.id])) : [],
    [allCards, records, studyReady],
  )
  const pendingDraftCount = useMemo(
    () => library?.draftDecks.reduce((n, d) => n + d.cards.filter((c) => c.status !== 'rejected').length, 0) ?? 0,
    [library],
  )

  const meta = TAB_META[activeTab]
  const materialCount = library?.materials.length ?? 0
  const deckCount = library?.publishedDecks.length ?? 0

  const navigate = (tab: TabId) => {
    window.location.hash = tab
    startTransition(() => setActiveTab(tab))
  }

  const toggleTheme = () => setThemeMode((v) => v === 'light' ? 'dark' : 'light')
  const openReview = (options?: ReviewNavigationOptions) => {
    setSelectedDeckId(options?.deckId ?? 'all')
    setReviewStartCardId(options?.startCardId ?? null)
    if (options?.mode) {
      setRequestedReviewMode(options.mode)
    }
    navigate('review')
  }
  const selectReviewDeck = (deckId: string) => {
    setSelectedDeckId(deckId)
    setReviewStartCardId(null)
  }
  const changeVoiceMode = (mode: 'auto' | 'male' | 'female') => {
    setVoiceMode(mode)
    setSelectedVoiceUri('')
  }

  const resolveMaterialForCard = (cardId?: string, fallbackMaterialId?: string) => {
    if (!library) {
      return fallbackMaterialId ?? ''
    }
    if (cardId) {
      const materialByCard = library.materials.find((material) =>
        material.sections.some((section) => {
          if (section.focusCardIds.includes(cardId)) {
            return true
          }
          return (section.segments ?? []).some((segment) => segment.cardId === cardId)
        }),
      )
      if (materialByCard) {
        return materialByCard.id
      }
    }
    if (fallbackMaterialId) {
      return fallbackMaterialId
    }
    return library.materials[0]?.id ?? ''
  }

  const openReader = (options?: { materialId?: string; cardId?: string }) => {
    const nextMaterialId = resolveMaterialForCard(options?.cardId, options?.materialId)
    setSelectedMaterialId(nextMaterialId)
    setHighlightedCardId(options?.cardId ?? null)
    navigate('reader')
  }

  const renderView = () => {
    if (!library) return null

    if (activeTab === 'dashboard') return (
      <DashboardView
        materials={library.materials}
        publishedDecks={library.publishedDecks}
        draftDecks={library.draftDecks}
        dueCards={dueCards}
        records={records}
        onOpenReview={openReview}
        onOpenReader={openReader}
      />
    )

    if (activeTab === 'library') return (
      <LibraryView
        materials={library.materials}
        publishedDecks={library.publishedDecks}
        selectedDeckId={selectedDeckId === 'all' ? (library.publishedDecks[0]?.id ?? '') : selectedDeckId}
        selectedMaterialId={selectedMaterialId || (library.materials[0]?.id ?? '')}
        onSelectDeck={setSelectedDeckId}
        onSelectMaterial={setSelectedMaterialId}
        onOpenReview={openReview}
        onOpenReader={openReader}
      />
    )

    if (activeTab === 'review') return (
      <ReviewView
        publishedDecks={library.publishedDecks}
        records={records}
        studyReady={studyReady}
        selectedDeckId={selectedDeckId}
        startCardId={reviewStartCardId}
        requestedPracticeMode={requestedReviewMode}
        sessionResetVersion={sessionResetVersion}
        hasChineseVoice={hasChineseVoice}
        hasMaleChineseVoice={hasMaleChineseVoice}
        hasFemaleChineseVoice={hasFemaleChineseVoice}
        voiceMode={voiceMode}
        onChangeVoiceMode={changeVoiceMode}
        selectedVoiceUri={selectedVoiceUri}
        voiceOptions={voiceOptions}
        onChangeSelectedVoiceUri={setSelectedVoiceUri}
        onSelectDeck={selectReviewDeck}
        onReview={reviewCard}
        onSpeak={speak}
        onOpenReader={openReader}
        onResetSession={resetCurrentSession}
        onResetDeckProgress={resetDeckProgress}
        onResetAllProgress={resetAllProgress}
      />
    )

    if (activeTab === 'reader') return (
      <ReaderView
        materials={library.materials}
        cardsById={cardsById}
        selectedMaterialId={selectedMaterialId || (library.materials[0]?.id ?? '')}
        highlightedCardId={highlightedCardId}
        records={records}
        hasChineseVoice={hasChineseVoice}
        hasMaleChineseVoice={hasMaleChineseVoice}
        hasFemaleChineseVoice={hasFemaleChineseVoice}
        voiceMode={voiceMode}
        selectedVoiceUri={selectedVoiceUri}
        voiceOptions={voiceOptions}
        onSelectMaterial={setSelectedMaterialId}
        onHighlightCard={setHighlightedCardId}
        onChangeVoiceMode={changeVoiceMode}
        onChangeSelectedVoiceUri={setSelectedVoiceUri}
        onOpenReview={openReview}
        onSpeak={speak}
      />
    )

    return (
      <DraftsView
        key={selectedDraftDeckId || library.draftDecks[0]?.id || 'drafts'}
        draftDecks={library.draftDecks}
        selectedDraftDeckId={selectedDraftDeckId || library.draftDecks[0]?.id || ''}
        onSelectDraftDeck={setSelectedDraftDeckId}
      />
    )
  }

  return (
    <div className="app-shell">
      <NavigationRail
        activeTab={activeTab}
        dueCount={dueCards.length}
        draftCount={pendingDraftCount}
        audioReady={hasChineseVoice}
        onSelect={navigate}
      />

      <main className="main-stage">
        <header className="workspace-header">
          <div className="workspace-header__copy">
            <p className="eyebrow">Hanzi Lens</p>
            <h2>{meta.title}</h2>
          </div>
          <div className="workspace-meta">
            <div className="workspace-stats">
              <div className="workspace-stat">
                <span>Tài liệu</span>
                <strong>{materialCount}</strong>
              </div>
              <div className="stat-divider" />
              <div className="workspace-stat">
                <span>Deck</span>
                <strong>{deckCount}</strong>
              </div>
              <div className="stat-divider" />
              <div className="workspace-stat accent">
                <span>Đến hạn</span>
                <strong>{dueCards.length}</strong>
              </div>
              <div className="stat-divider" />
              <div className="workspace-stat">
                <span>Draft</span>
                <strong>{pendingDraftCount}</strong>
              </div>
            </div>
            <button type="button" className="ghost-button compact-button" onClick={toggleTheme}>
              {themeMode === 'dark' ? '☀ Light' : '☾ Dark'}
            </button>
          </div>
        </header>

        {status === 'loading' && (
          <div className="panel loading-panel">
            <p className="eyebrow">Loading</p>
            <h2>Đang nạp content manifest…</h2>
          </div>
        )}

        {status === 'error' && (
          <div className="panel empty-state">
            <h3>Không tải được dữ liệu.</h3>
            <p>{error}</p>
          </div>
        )}

        {status === 'ready' && library && renderView()}

        {(studyError || !studyReady) && status === 'ready' && (
          <aside className="status-banner">
            {studyError ?? 'Đang mở IndexedDB để nạp tiến độ ôn tập cục bộ…'}
          </aside>
        )}
      </main>
    </div>
  )
}

export default App
