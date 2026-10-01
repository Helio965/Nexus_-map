import { useEffect, useRef, useState, type ReactNode } from 'react';

import { SNAP_FRACTION, type SheetSnap } from './sheetSnaps';

const ORDER: SheetSnap[] = ['peek', 'half', 'full'];
const LABEL: Record<SheetSnap, string> = { peek: 'recolhido', half: 'meia altura', full: 'expandido' };

/**
 * Painel inferior para celular: arrastável (ponteiro/toque) e operável por teclado
 * (botão da alça alterna as posições). Não é o painel do desktop "encolhido".
 */
export function BottomSheet({
  children,
  snap,
  onSnap,
}: {
  children: ReactNode;
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
}) {
  const [dragY, setDragY] = useState<number | null>(null);
  const start = useRef<{ y: number; height: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [vh, setVh] = useState(() => window.innerHeight);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const height = dragY ?? SNAP_FRACTION[snap] * vh;

  function onPointerDown(e: React.PointerEvent) {
    start.current = { y: e.clientY, height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const next = start.current.height + (start.current.y - e.clientY);
    setDragY(Math.min(vh * 0.95, Math.max(vh * 0.15, next)));
  }
  function onPointerUp() {
    if (!start.current) return;
    const moved = dragY !== null && Math.abs(dragY - start.current.height) > 8;
    if (moved && dragY !== null) {
      const frac = dragY / vh;
      const nearest = ORDER.reduce((best, s) => (Math.abs(SNAP_FRACTION[s] - frac) < Math.abs(SNAP_FRACTION[best] - frac) ? s : best), snap);
      onSnap(nearest);
    } else {
      onSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]!);
    }
    start.current = null;
    setDragY(null);
  }

  return (
    <div ref={sheetRef} className={`sheet ${dragY !== null ? 'is-dragging' : ''}`} style={{ height }} data-snap={snap}>
      <button
        type="button"
        className="sheet__handle"
        aria-label={`Painel ${LABEL[snap]}. Toque para alternar a altura.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]!);
          }
        }}
      >
        <span aria-hidden="true" />
      </button>
      <div className="sheet__content">{children}</div>
    </div>
  );
}
