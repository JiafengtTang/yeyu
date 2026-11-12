import type { CSSProperties } from 'react'

const PATHS = {
  dashboard: ['M3 10.6 12 3l9 7.6', 'M5.5 9.5V20h13V9.5'],
  layers: ['M12 3 3 7.5l9 4.5 9-4.5L12 3Z', 'M3 12.2l9 4.5 9-4.5', 'M3 16.8l9 4.5 9-4.5'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
  check: ['M20 6 9 17l-5-5'],
  checkSquare: ['M9 11.5l2.5 2.5L17 8.5', 'M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9'],
  users: ['M16 20v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.2V20', 'M9.5 11.5a3.7 3.7 0 1 0 0-7.4 3.7 3.7 0 0 0 0 7.4', 'M21 20v-1.8a3.6 3.6 0 0 0-2.7-3.5', 'M15.5 4.3a3.7 3.7 0 0 1 0 7.1'],
  sliders: ['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h9', 'M17 18h3', 'M15 4v4', 'M9 10v4', 'M15 16v4'],
  logout: ['M9 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4', 'M16 16l4-4-4-4', 'M20 12H9'],
  plus: ['M12 5v14', 'M5 12h14'],
  clock: ['M12 8v4.2l2.8 1.8', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
  alert: ['M10.3 4.2 2.4 17.7A1.9 1.9 0 0 0 4 20.5h16a1.9 1.9 0 0 0 1.6-2.8L13.7 4.2a1.9 1.9 0 0 0-3.4 0Z', 'M12 9.5v4', 'M12 17h.01'],
  search: ['M20.5 20.5 16.2 16.2', 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'],
  download: ['M12 3.5v11', 'M8 10.5l4 4 4-4', 'M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5'],
  upload: ['M12 20.5v-11', 'M8 13.5l4-4 4 4', 'M4 7V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V7'],
  box: ['M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5v-7Z', 'M3.5 8.5 12 13l8.5-4.5', 'M12 13v7'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  calendar: ['M7 3v3', 'M17 3v3', 'M4 8.5h16', 'M5 5.5h14a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z'],
  arrowRight: ['M5 12h14', 'M13 6l6 6-6 6'],
  arrowLeft: ['M19 12H5', 'M11 18l-6-6 6-6'],
  sparkles: ['M12 3.5l1.6 4.2 4.2 1.6-4.2 1.6L12 15l-1.6-4.1L6.2 9.3l4.2-1.6L12 3.5Z', 'M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z'],
  shield: ['M12 3.5 19 6v5.5c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-2.5Z', 'M9.3 12.2l1.9 1.9 3.6-3.7'],
  building: ['M4 21V6l7-3v18', 'M11 21h9V10l-9-4', 'M7.5 9h.01', 'M7.5 13h.01', 'M7.5 17h.01', 'M15 12h.01', 'M15 16h.01'],
  edit: ['M4 20h4l10.4-10.4a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z', 'M13.4 6.6l4 4'],
  paperclip: ['M20 11.6 12.4 19.2a4.5 4.5 0 0 1-6.4-6.4l7.8-7.8a3 3 0 0 1 4.3 4.3l-7.8 7.8a1.5 1.5 0 0 1-2.1-2.1l7-7'],
  trash: ['M4 7h16', 'M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7', 'M6.6 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.4 7', 'M10.4 11v6', 'M13.6 11v6'],
  clipboard: ['M9 4.5h6', 'M8 4.5H6.5A1.5 1.5 0 0 0 5 6v13a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V6a1.5 1.5 0 0 0-1.5-1.5H16', 'M9.5 4.5v1.2a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V4.5', 'M9 11.5h6', 'M9 15.5h4']
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 18,
  className,
  style,
  strokeWidth = 1.7
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
  strokeWidth?: number
}) {
  const paths = PATHS[name]
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
