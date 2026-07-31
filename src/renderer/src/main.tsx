import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'
import App from './App'
import './index.css'
import 'highlight.js/styles/github-dark.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
