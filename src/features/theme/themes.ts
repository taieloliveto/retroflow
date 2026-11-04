import type { PhaseId } from "../rooms/types";

/**
 * Temáticas de Retronadas 2.0. Cada una define los personajes de cada
 * categoría y el personaje principal (sala de espera, cierres).
 * Las imágenes están en /public/characters (se pueden reemplazar por
 * versiones nuevas con el mismo nombre de archivo).
 */
export type ThemeId = "normal" | "halloween" | "argentina" | "mario";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Personaje por categoría. */
  characters: Record<PhaseId, string>;
  /** Personaje para la sala de espera y pantallas generales. */
  hero: string;
  /** Personaje alternativo (pantallas de cierre). */
  alt: string;
}

const img = (file: string) => `/characters/${file}.webp`;

export const THEMES: Record<ThemeId, ThemeDef> = {
  normal: {
    id: "normal",
    name: "Normal",
    tagline: "El clásico de Retronadas",
    characters: { destacar: img("normal-destacar"), mejorar: img("normal-mejorar"), mantener: img("normal-mantener") },
    hero: img("normal2-destacar"),
    alt: img("normal2-mantener"),
  },
  halloween: {
    id: "halloween",
    name: "Halloween",
    tagline: "Una retro de terror",
    characters: { destacar: img("halloween-destacar"), mejorar: img("halloween-mejorar"), mantener: img("halloween-mantener") },
    hero: img("halloween-mejorar"),
    alt: img("halloween-mantener"),
  },
  argentina: {
    id: "argentina",
    name: "Argentina",
    tagline: "Vamos, vamos, equipo",
    characters: { destacar: img("argentina-destacar"), mejorar: img("argentina-mejorar"), mantener: img("argentina-mantener") },
    hero: img("argentina-mantener"),
    alt: img("argentina-destacar"),
  },
  mario: {
    id: "mario",
    name: "Mario",
    tagline: "Pasamos de nivel",
    characters: { destacar: img("mario-destacar"), mejorar: img("mario-mejorar"), mantener: img("mario-mantener") },
    hero: img("mario-mantener"),
    alt: img("mario-destacar"),
  },
};

export const THEME_LIST: ThemeDef[] = [THEMES.normal, THEMES.halloween, THEMES.argentina, THEMES.mario];

export const themeOf = (id: string | null | undefined): ThemeDef => THEMES[(id as ThemeId) ?? "normal"] ?? THEMES.normal;

/** Precarga las imágenes de una temática para que las transiciones no parpadeen. */
export function preloadTheme(t: ThemeDef) {
  for (const src of [...Object.values(t.characters), t.hero, t.alt]) {
    const i = new Image();
    i.src = src;
  }
}
