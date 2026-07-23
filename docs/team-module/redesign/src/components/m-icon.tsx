import type { CSSProperties, ReactElement } from 'react'

export interface MIconProps {
  size?: number
  className?: string
  style?: CSSProperties
  /** Accepted for drop-in compatibility with lucide props; unused. */
  strokeWidth?: number
  title?: string
}

export type MIconComponent = (props: MIconProps) => ReactElement

/**
 * Material Symbols (outlined) icon factory — the icon set the Figma design
 * system uses (icon/*Outlined). Usage: `const DragIcon = mIcon('drag_indicator')`.
 */
export function mIcon(name: string): MIconComponent {
  const Icon = ({ size = 20, className = '', style, title }: MIconProps): ReactElement => (
    <span
      title={title}
      className={`material-symbols-outlined select-none leading-none ${className}`}
      style={{ fontSize: size, width: size, height: size, overflow: 'hidden', display: 'inline-block', ...style }}
      aria-hidden
    >
      {name}
    </span>
  )
  Icon.displayName = `MIcon(${name})`
  return Icon
}
