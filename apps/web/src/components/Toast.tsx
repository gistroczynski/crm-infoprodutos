import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration: number
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToastContext() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToastContext must be used inside <ToastProvider>')
  return ctx
}

// ── Styles per type ────────────────────────────────────────────────────────

const STYLES: Record<ToastType, { border: string; iconBg: string; iconText: string; bar: string; icon: string }> = {
  success: { border: 'border-l-emerald-400', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', bar: 'bg-emerald-400', icon: '✓' },
  error:   { border: 'border-l-red-400',     iconBg: 'bg-red-100',     iconText: 'text-red-600',     bar: 'bg-red-400',     icon: '✕' },
  warning: { border: 'border-l-amber-400',   iconBg: 'bg-amber-100',   iconText: 'text-amber-600',   bar: 'bg-amber-400',   icon: '!' },
  info:    { border: 'border-l-blue-400',    iconBg: 'bg-blue-100',    iconText: 'text-blue-600',    bar: 'bg-blue-400',    icon: 'i' },
}

// ── Individual Toast ────────────────────────────────────────────────────────

function ToastEntry({ item, onRemove }: { item: ToastItem; onRemove: () => void }) {
  const s = STYLES[item.type]
  const [exiting, setExiting] = useState(false)
  const [barW, setBarW]       = useState(100)

  const dismiss = useCallback(() => {
    setExiting(true)
    setTimeout(onRemove, 250)
  }, [onRemove])

  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarW(0))
    const t   = setTimeout(dismiss, item.duration)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [item.duration, dismiss])

  return (
    <div
      role="alert"
      className={[
        'relative flex items-start gap-3 px-4 pt-3.5 pb-5 bg-white rounded-xl',
        'border border-gray-200 border-l-4 shadow-lg w-80 pointer-events-auto',
        s.border,
        'transition-all duration-250',
        exiting ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0',
      ].join(' ')}
    >
      {/* Icon */}
      <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${s.iconBg} ${s.iconText}`}>
        {s.icon}
      </span>

      {/* Message */}
      <p className="text-sm text-gray-800 leading-snug flex-1 pt-0.5">{item.message}</p>

      {/* Close */}
      <button
        onClick={dismiss}
        aria-label="fechar"
        className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors mt-0.5"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[3px] overflow-hidden rounded-b-xl bg-gray-100">
        <div
          className={`h-full ${s.bar}`}
          style={{ width: `${barW}%`, transition: `width ${item.duration}ms linear` }}
        />
      </div>
    </div>
  )
}

// ── Container ──────────────────────────────────────────────────────────────

function ToastContainer({ toasts, removeToast }: { toasts: ToastItem[]; removeToast: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[9998] flex flex-col gap-2 items-end pointer-events-none"
    >
      {toasts.map(item => (
        <ToastEntry key={item.id} item={item} onRemove={() => removeToast(item.id)} />
      ))}
    </div>
  )
}

// ── Provider ───────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const removeToast = useCallback((id: string) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = `t${++counter.current}`
    setToasts(t => [...t, { id, type, message, duration }])
  }, [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}
