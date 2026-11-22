import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
    type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { initials } from '../format'
import { Icon, type IconName } from './Icon'

// ---------- form fields ----------

interface FieldShell {
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
}

function Field({ label, error, hint, required, id, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-err`} role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const describedBy = (id: string, error?: string, hint?: ReactNode) =>
  error ? `${id}-err` : hint ? `${id}-hint` : undefined

export function TextInput({ label, error, hint, required, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <input
        id={id}
        className="input"
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        required={required}
        {...rest}
      />
    </Field>
  )
}

export function TextArea({ label, error, hint, required, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      <textarea id={id} className="input" aria-invalid={!!error} aria-describedby={describedBy(id, error, hint)} {...rest} />
    </Field>
  )
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div className="banner banner-error" role="alert">
      <Icon name="alert" size={16} />
      <span>{message}</span>
    </div>
  )
}

// ---------- modal ----------

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className="modal-inner">
          <header className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel: string
  busy?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <FormError message={error} />
      <p className="confirm-text">{message}</p>
    </Modal>
  )
}

// ---------- states ----------

export function EmptyState({ icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon">
        <Icon name={icon} size={22} />
      </div>
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon">
        <Icon name="alert" size={22} />
      </div>
      <h3>Couldn’t load this</h3>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          <Icon name="refresh" size={16} /> Try again
        </button>
      )}
    </div>
  )
}

// ---------- avatar ----------

/** The user's photo, or their initials on a colour picked from their name. */
export function Avatar({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  if (url) return <img className="avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  const hue = Math.abs(hash) % 360
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 60% 86%)`, color: `hsl(${hue} 55% 26%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

/** A disabled control with a reason, so people can see why they can't use it. */
export function LockedHint({ children }: { children: ReactNode }) {
  return (
    <span className="locked-hint">
      <Icon name="lock" size={14} /> {children}
    </span>
  )
}

// ---------- toasts ----------

interface Toast {
  id: number
  kind: 'ok' | 'error'
  text: string
}
const ToastContext = createContext<(kind: Toast['kind'], text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={t.kind === 'ok' ? 'check' : 'alert'} size={16} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
