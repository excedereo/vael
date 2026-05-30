import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fallback: prevent any unhandled drop from navigating (belt-and-suspenders)
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

// Убираем сплэш после монта React
const splash = document.getElementById('splash')
if (splash) {
  splash.style.opacity = '0'
  setTimeout(() => splash.remove(), 220)
}
