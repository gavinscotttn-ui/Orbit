import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './app/state.js'
import { App } from './app/App.js'
import { hasBridge } from './lib/api.js'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'

/**
 * Entry point.
 *
 * If the privileged bridge is missing, the application says so plainly instead
 * of rendering a shell that cannot do anything — a blank window with dead
 * buttons is the worst possible failure mode.
 */
const container = document.getElementById('root')

if (!container) {
  document.body.textContent = 'Orbit could not start: the application root is missing.'
} else if (!hasBridge()) {
  createRoot(container).render(
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 24, textAlign: 'center' }}>
      <div style={{ maxWidth: '46ch' }}>
        <h1 style={{ fontSize: 20, marginBottom: 10 }}>Orbit cannot reach its engine</h1>
        <p style={{ color: '#6b7688', fontSize: 13, lineHeight: 1.6 }}>
          The interface loaded but the privileged part of the application did not. This usually means Orbit was opened
          outside its desktop shell. Quit and start it again from the application itself.
        </p>
      </div>
    </div>
  )
} else {
  createRoot(container).render(
    <StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </StrictMode>
  )
}
