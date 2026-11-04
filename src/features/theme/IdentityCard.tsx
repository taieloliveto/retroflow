import type { PhaseId } from "../rooms/types";
import { phaseById } from "../retro/phases";
import { themeOf } from "./themes";

/** Tarjeta de identidad Retronadas: color de la categoría, título y personaje. */
export function IdentityCard({
  phase,
  theme = "normal",
  className = "",
}: {
  phase: PhaseId;
  theme?: string;
  className?: string;
}) {
  const def = phaseById(phase);
  return (
    <div className={`id-card tone-${def.tone} ${className}`}>
      <div className="id-card__text">
        <span className="id-card__brand">Retronadas</span>
        <span className="id-card__name">{def.name}</span>
      </div>
      <img className="id-card__char" src={themeOf(theme).characters[phase]} alt="" draggable={false} />
    </div>
  );
}

export function Character({ src, className = "", size }: { src: string; className?: string; size?: number }) {
  return <img className={`character ${className}`} src={src} alt="" draggable={false} style={size ? { height: size } : undefined} />;
}

/** Los tres personajes de la temática (pantallas de cierre). */
export function CharacterTrio({ theme }: { theme: string }) {
  const t = themeOf(theme);
  return (
    <div className="trio" aria-hidden="true" data-testid="trio">
      <img className="trio__c trio__c--1" src={t.characters.destacar} alt="" draggable={false} />
      <img className="trio__c trio__c--2" src={t.characters.mejorar} alt="" draggable={false} />
      <img className="trio__c trio__c--3" src={t.characters.mantener} alt="" draggable={false} />
    </div>
  );
}
