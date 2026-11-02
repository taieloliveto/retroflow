export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="rf-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B4BFF" />
          <stop offset="1" stopColor="#FF7A59" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#rf-g)" />
      <g fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 34a14 14 0 0 1 24-10" />
        <path d="M46 30a14 14 0 0 1-24 10" />
        <path d="M38 17l5 7-8 2" />
        <path d="M26 47l-5-7 8-2" />
      </g>
    </svg>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo__text">
        Retro<span>Flow</span>
      </span>
    </span>
  );
}
