export function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

function normalizeToken(token: string) {
  const value = token.trim()
  const mac = isMacPlatform()
  const map: Record<string, string> = {
    '⌘': 'Command',
    '⇧': 'Shift',
    '⌃': mac ? 'Control' : 'Ctrl',
    '⌥': mac ? 'Option' : 'Alt',
    Command: mac ? 'Command' : 'Ctrl',
    Cmd: mac ? 'Command' : 'Ctrl',
    MacCtrl: mac ? 'Control' : 'Ctrl',
    Control: mac ? 'Control' : 'Ctrl',
    Ctrl: mac ? 'Control' : 'Ctrl',
    Option: mac ? 'Option' : 'Alt',
    Alt: mac ? 'Option' : 'Alt',
    Shift: 'Shift',
  }
  return map[value] ?? value
}

export function getShortcutParts(shortcut: string) {
  if (!shortcut) return []

  const rawParts = /[⌘⇧⌃⌥]/.test(shortcut) ? Array.from(shortcut) : shortcut.split('+')
  const parts = rawParts.map(normalizeToken).filter(Boolean)
  const mac = isMacPlatform()
  const modifierOrder = mac ? ['Command', 'Control', 'Option', 'Shift'] : ['Ctrl', 'Alt', 'Shift']
  const modifiers = parts
    .filter((part) => modifierOrder.includes(part))
    .sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b))
  const keys = parts.filter((part) => !modifierOrder.includes(part))
  return [...modifiers, ...keys]
}

export function formatShortcut(shortcut: string, unboundLabel = 'Unbound') {
  const parts = getShortcutParts(shortcut)
  return parts.length > 0 ? parts.join(' + ') : unboundLabel
}
