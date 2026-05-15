declare module 'apple-intelligence-glow-react' {
  import type { CSSProperties, ReactNode } from 'react'

  export function AppleIntelligenceGlow(props: {
    radius?: number | string
    className?: string
    style?: CSSProperties
    children: ReactNode
  }): ReactNode

  export function AppleIntelligenceLockScreen(props: {
    width?: number | string
    height?: number | string
    showHelperText?: boolean
    className?: string
    style?: CSSProperties
  }): ReactNode
}
