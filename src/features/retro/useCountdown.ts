import { useEffect, useState } from "react";
import type { RoomTimer } from "../rooms/types";

/**
 * Cuenta regresiva basada en la hora del SERVIDOR.
 * El vencimiento (`endsAt`) lo fija la base; cada navegador solo corrige su
 * reloj con `serverOffset` (diferencia medida contra el servidor), así todos
 * ven el mismo tiempo aunque sus relojes estén desfasados.
 */
export function useCountdown(timer: RoomTimer, serverOffset: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  const paused = !timer.endsAt;
  const remainingMs = timer.endsAt
    ? Math.max(0, new Date(timer.endsAt).getTime() - (now + serverOffset))
    : Math.max(0, timer.remainingMs ?? 0);
  const totalMs = Math.max(timer.totalMs ?? 0, remainingMs, 1);

  return {
    remainingMs,
    totalMs,
    paused: paused && remainingMs > 0,
    expired: remainingMs <= 0,
    warning: remainingMs > 0 && remainingMs <= 60_000,
    fraction: remainingMs / totalMs,
  };
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
