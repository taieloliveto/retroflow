import { useState } from "react";
import { useToast } from "../../components/Toasts";
import { RoomError } from "../rooms/api";
import type { RoomLive } from "../rooms/useRoomLive";
import { retroApi } from "../retro/api";
import { THEME_LIST, themeOf } from "./themes";

/** Selector de temática (solo PO). Se aplica al instante para toda la sala. */
export function ThemePicker({ live }: { live: RoomLive }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const current = themeOf(live.room.theme).id;

  const pick = async (id: string) => {
    if (id === current || busy) return;
    setBusy(id);
    try {
      await live.runAction(() => retroApi.setTheme(live.session, id));
      await live.channel.send("room:updated", { status: live.room.status }).catch(() => undefined);
    } catch (e) {
      toast("error", e instanceof RoomError ? e.message : "No pudimos cambiar la temática.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="field">
      <span className="field__label">Temática</span>
      <div className="theme-picker" role="radiogroup" aria-label="Temática" data-testid="theme-picker">
        {THEME_LIST.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === current}
            className={`theme-opt theme-opt--${t.id} ${t.id === current ? "is-on" : ""}`}
            onClick={() => pick(t.id)}
            disabled={busy !== null}
          >
            <img src={t.characters.destacar} alt="" draggable={false} />
            <span className="theme-opt__name">{t.name}</span>
            {busy === t.id && <span className="spinner spinner--sm" />}
          </button>
        ))}
      </div>
    </div>
  );
}
