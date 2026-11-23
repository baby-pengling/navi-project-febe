import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { FloatingWidget } from './screens/floating/FloatingWidget'

// One renderer bundle for both windows: the main window, and the floating widget at `#widget`.
const isWidget = window.location.hash === '#widget'
if (isWidget) document.body.classList.add('widget')

createRoot(document.getElementById('root')!).render(<StrictMode>{isWidget ? <FloatingWidget /> : <App />}</StrictMode>)
