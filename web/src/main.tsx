/**
 * Current file: web/src/main.tsx
 * UI/UX related files (for redesign handoff):
 * - web/src/index.css
 * - web/src/main.tsx
 * - web/src/App.tsx
 * - web/src/components/NavigationRail.tsx
 * - web/src/components/DashboardView.tsx
 * - web/src/components/LibraryView.tsx
 * - web/src/components/ReviewView.tsx
 * - web/src/components/ReaderView.tsx
 * - web/src/components/DraftsView.tsx
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
