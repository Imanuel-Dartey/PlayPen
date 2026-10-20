const PATHS = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12',
  muted: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  next: 'M5.5 5.5v13l9.5-6.5zM16.5 5H19v14h-2.5z',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM15.5 15.5 20 20',
  close: 'M6 6l12 12M18 6 6 18',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  back: 'M15 5l-7 7 7 7',
  cc: 'M3.5 6h17v12h-17zM10.5 10.2a2.4 2.4 0 1 0 0 3.6M16.5 10.2a2.4 2.4 0 1 0 0 3.6',
  image: 'M4.5 5.5h15v13h-15zM4.5 15l4-4 4 4 2.5-2.5 4.5 4.5M15 9.5h.01',
  send: 'M4 12 20 4l-4.5 16-3-6.5zM12.5 13.5 20 4',
  chat: 'M5 5.5h14v10H9.5L5 19.5z',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20Z',
  heartOutline: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20Z',
  grid: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
  episodes: 'M4 5.5h4v4H4zM4 14.5h4v4H4zM11 7.5h9M11 16.5h9',
} as const

export type IconName = keyof typeof PATHS

const FILLED = new Set<IconName>(['play', 'pause', 'next', 'heart'])

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const filled = FILLED.has(name)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
