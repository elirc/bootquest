// Hand-rolled 16px stroke icons (no icon library). Decorative by default.

const PATHS = {
  flame: 'M8 14.5c2.6 0 4.5-1.8 4.5-4.3 0-2.4-1.6-3.6-2.4-5.7-.3 1.4-1 2.2-1.8 2.6C8.6 4.8 7.7 3 6 1.5c.2 2.4-2.5 4.2-2.5 7.4 0 3.1 1.9 5.6 4.5 5.6Z',
  snow: 'M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5M6.2 2.6 8 4.2l1.8-1.6M6.2 13.4 8 11.8l1.8 1.6',
  lock: 'M4 7.5h8v6.5H4zM5.5 7.5V5.2a2.5 2.5 0 0 1 5 0v2.3',
  check: 'M3 8.5l3.2 3L13 4.5',
  play: 'M5 3.5v9l7.5-4.5z',
  bolt: 'M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z',
  cards: 'M2.5 5h8.5v8.5H2.5zM5 2.5h8.5V11',
  grid: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  map: 'M1.5 3.5 5.5 2l5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5zM5.5 2v10.5M10.5 3.5V14',
  chart: 'M2 14h12M4 11.5V8M7 11.5V4M10 11.5V6.5M13 11.5V2.5',
  warn: 'M8 2 1.5 13.5h13zM8 6.5v3.5M8 11.6v.4',
  dot: 'M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  x: 'M4 4l8 8M12 4l-8 8',
  clock: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8ZM8 4.5V8l2.5 1.5',
  keyboard: 'M1.5 4h13v8h-13zM4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M5 9.5h6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
