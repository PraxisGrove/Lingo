const paths = {
  language:
    'm4 5 7 0m-3.5-2v2m-3 0c0 6 3 9 7 11m-2-11c0 6-3 9-7 11m10 3 4-11 4 11m-6.5-4h5',
  service: 'M8 3v4m8-4v4M5 7h14v4a7 7 0 0 1-14 0V7m7 11v3',
  automation: 'm13 2-9 12h7l-1 8 10-12h-7z',
  quality:
    'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L2.2 9.4l6.1-.9z',
  privacy: 'm12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z m-4 9 3 3 5-6',
  rules: 'M4 4h16v16H4z M4 9h16M9 9v11',
  general: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  arrow: 'M4 12h16m-5-5 5 5-5 5',
  back: 'M20 12H4m5-5-5 5 5 5',
  check: 'm5 12 4 4L19 6',
  external: 'M14 3h7v7m0-7-11 11M10 3H3v18h18v-7',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
} as const;

export function SettingsIcon({
  name,
  size = 20,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
