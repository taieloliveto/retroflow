const PALETTE = [
  ["#5B4BFF", "#EEEBFF"],
  ["#FF7A59", "#FFEDE7"],
  ["#14A884", "#E2F7F1"],
  ["#E0A100", "#FFF5DA"],
  ["#D94C8C", "#FCE8F1"],
  ["#2B8BD9", "#E3F1FC"],
  ["#8A4FD9", "#F1E9FC"],
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ name, size = 48, online }: { name: string; size?: number; online?: boolean }) {
  const [fg, bg] = colorFor(name);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, color: fg, background: bg }}>
      {initials(name)}
      {online !== undefined && (
        <span className={`avatar__dot ${online ? "is-online" : "is-offline"}`} aria-hidden="true" />
      )}
    </span>
  );
}
