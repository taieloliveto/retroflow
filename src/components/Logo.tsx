export function LogoMark({ size = 36 }: { size?: number }) {
  return <img className="logo__mark" src="/logo.png" width={size} height={size} alt="" draggable={false} />;
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="logo" aria-label="Retronadas 2.0">
      <LogoMark size={size} />
      <span className="logo__text">
        Retronadas <span className="logo__ver">2.0</span>
      </span>
    </span>
  );
}
