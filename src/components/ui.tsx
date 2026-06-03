import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex min-h-[var(--ui-button-min)] items-center justify-center rounded-[var(--ui-button-r)] px-[var(--ui-button-x)] py-[var(--ui-button-y)] text-[length:var(--ui-button-text)] font-medium transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  )
}

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props} className={`bg-violet-500 text-white hover:bg-violet-400 ${props.className ?? ''}`} />
}

export function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props} className={`bg-zinc-900/70 text-zinc-200 ring-1 ring-white/10 hover:bg-zinc-800 ${props.className ?? ''}`} />
}

export function DangerButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props} className={`bg-red-500/10 text-red-300 ring-1 ring-red-400/20 hover:bg-red-500/20 ${props.className ?? ''}`} />
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{children}</label>
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-4 focus:ring-violet-500/10 ${props.className ?? ''}`}
    />
  )
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-4 focus:ring-violet-500/10 ${props.className ?? ''}`}
    />
  )
}

type AnchorStyle = React.CSSProperties & {
  anchorName?: string
  positionAnchor?: string
}

export interface AnchorSelectOption<T extends string> {
  value: T
  label: string
  description?: string
}

export function AnchorSelect<T extends string>({
  value,
  options,
  onChange,
  align = 'start',
  className = '',
}: {
  value: T
  options: AnchorSelectOption<T>[]
  onChange: (value: T) => void
  align?: 'start' | 'end'
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownDirection, setDropdownDirection] = useState<'up' | 'down'>('down')
  const rawId = useId()
  const anchorName = useMemo(() => `--tabweave-select-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId])
  const supportsAnchorPositioning = useMemo(
    () => typeof CSS !== 'undefined'
      && CSS.supports('position-anchor: --tabweave-select-anchor')
      && CSS.supports('top: anchor(bottom)')
      && CSS.supports('width: anchor-size(width)'),
    [],
  )
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!isOpen) return

    const updateDropdownDirection = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const gap = 8
      const estimatedHeight = Math.min(Math.max(options.length * 54, 44), 288)
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const openUp = spaceBelow < estimatedHeight + gap && spaceAbove > spaceBelow
      setDropdownDirection(openUp ? 'up' : 'down')
    }

    updateDropdownDirection()
    window.addEventListener('resize', updateDropdownDirection)
    window.addEventListener('scroll', updateDropdownDirection, true)
    return () => {
      window.removeEventListener('resize', updateDropdownDirection)
      window.removeEventListener('scroll', updateDropdownDirection, true)
    }
  }, [isOpen, options.length])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!dropdownRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const dropdownStyle: AnchorStyle = supportsAnchorPositioning
    ? {
        position: 'fixed',
        positionAnchor: anchorName,
        width: 'anchor-size(width)',
        visibility: isOpen ? 'visible' : 'hidden',
        transformOrigin: dropdownDirection === 'up' ? 'bottom' : 'top',
        ...(align === 'end' ? { right: 'anchor(right)' } : { left: 'anchor(left)' }),
        ...(dropdownDirection === 'up'
          ? { bottom: 'anchor(top)', marginBottom: 8 }
          : { top: 'anchor(bottom)', marginTop: 8 }),
      }
    : {
        visibility: isOpen ? 'visible' : 'hidden',
        transformOrigin: dropdownDirection === 'up' ? 'bottom' : 'top',
      }

  const dropdown = (
    <div
      ref={dropdownRef}
      role="listbox"
      className={`soft-scrollbar absolute z-50 max-h-72 w-full overflow-auto rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/40 backdrop-blur-xl transition-opacity duration-150 ${
        dropdownDirection === 'up' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
      } ${align === 'end' ? 'right-0' : 'left-0'} ${
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      style={dropdownStyle}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={active}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition ${
              active ? 'bg-violet-500/15 text-violet-100' : 'text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100'
            }`}
            onClick={() => {
              onChange(option.value)
              setIsOpen(false)
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-violet-300' : 'bg-zinc-700'}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{option.label}</span>
              {option.description && <span className="mt-0.5 block truncate text-[11px] text-zinc-600">{option.description}</span>}
            </span>
            {active && (
              <svg className="h-4 w-4 text-violet-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m5 13 4 4L19 7" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm text-zinc-100 outline-none transition focus:border-violet-400/70 focus:ring-4 focus:ring-violet-500/10 ${
          isOpen
            ? 'border-violet-400/60 bg-zinc-950/80 ring-4 ring-violet-500/10'
            : 'border-white/10 bg-zinc-950/70 hover:bg-zinc-900'
        }`}
        style={{ anchorName } as AnchorStyle}
      >
        <span className="min-w-0">
          <span className="block truncate">{selected?.label}</span>
          {selected?.description && <span className="mt-0.5 block truncate text-[11px] text-zinc-600">{selected.description}</span>}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {dropdown}
    </div>
  )
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <motion.button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full outline-none focus:ring-4 focus:ring-violet-500/15"
      aria-pressed={checked}
      animate={{ backgroundColor: checked ? '#8b5cf6' : '#3f3f46' }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 36 }}
    >
      <motion.span
        className="absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,.25),0_1px_3px_rgba(0,0,0,.18)]"
        animate={{ x: checked ? 24 : 4 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
      />
    </motion.button>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <div className="mt-1 text-xs leading-5 text-zinc-500">{description}</div>
    </div>
  )
}

export function Tooltip({
  children,
  content,
  delay = 240,
}: {
  children: ReactNode
  content: ReactNode
  delay?: number
}) {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<number | null>(null)

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    const margin = 8
    const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0
    const left = tooltipWidth
      ? Math.min(Math.max(rect.left + rect.width / 2, margin + tooltipWidth / 2), window.innerWidth - margin - tooltipWidth / 2)
      : rect.left + rect.width / 2
    setPosition({ left, top: rect.bottom + gap })
  }

  const show = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      updatePosition()
      setIsVisible(true)
    }, delay)
  }

  const hide = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    setIsVisible(false)
  }

  useLayoutEffect(() => {
    if (!isVisible) return
    updatePosition()
  }, [isVisible, content])

  useEffect(() => {
    if (!isVisible) return
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isVisible])

  const tooltip = (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          ref={tooltipRef}
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.1, ease: 'easeOut' }}
          className="pointer-events-none fixed z-[90] -translate-x-1/2"
          style={{ left: position.left, top: position.top }}
        >
          <div className="whitespace-nowrap rounded-lg bg-zinc-950/95 px-2 py-1 text-[11px] font-medium text-zinc-100 shadow-xl ring-1 ring-white/10 backdrop-blur-xl">
            {content}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <div ref={triggerRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {createPortal(tooltip, document.body)}
    </div>
  )
}
