import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ToastProvider } from './ui'
import { initClient } from './api/client'
import './styles.css'
import './theme-v3.css'

async function bootstrap(): Promise<void> {
  await initClient()
  const container = document.getElementById('root')
  if (!container) throw new Error('#root 节点缺失')
  createRoot(container).render(
    <StrictMode>
      <HashRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </HashRouter>
    </StrictMode>
  )
}

void bootstrap()
