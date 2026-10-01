export type SheetSnap = 'peek' | 'half' | 'full';

/** Altura visível (fração da viewport) para cada posição do painel inferior. */
export const SNAP_FRACTION: Record<SheetSnap, number> = { peek: 0.24, half: 0.55, full: 0.92 };
