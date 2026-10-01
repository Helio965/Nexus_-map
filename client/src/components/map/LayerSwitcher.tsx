import { Icon } from '../common/ui';

export type MapLayerType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain' | '3d';

const LAYERS: Array<{ value: MapLayerType; label: string }> = [
  { value: 'roadmap', label: 'Mapa' },
  { value: 'satellite', label: 'Satélite' },
  { value: 'hybrid', label: 'Híbrido' },
  { value: 'terrain', label: 'Terreno' },
  { value: '3d', label: '3D' },
];

interface Props {
  value: MapLayerType;
  onChange: (v: MapLayerType) => void;
  trafficOn: boolean;
  onTraffic: (v: boolean) => void;
  signalsOn: boolean;
  onSignals: (v: boolean) => void;
  demoAvailable: boolean;
  demoOn: boolean;
  onDemo: (v: boolean) => void;
}

export function LayerSwitcher({
  value,
  onChange,
  trafficOn,
  onTraffic,
  signalsOn,
  onSignals,
  demoAvailable,
  demoOn,
  onDemo,
}: Props) {
  const is3d = value === '3d';
  return (
    <div className="map-controls">
      <div className="layer-switch" role="radiogroup" aria-label="Tipo de mapa">
        <Icon name="layers" size={16} />
        {LAYERS.map((l) => (
          <label
            key={l.value}
            className={`layer-switch__item ${value === l.value ? 'is-active' : ''}`}
          >
            <input
              type="radio"
              name="map-layer"
              value={l.value}
              checked={value === l.value}
              onChange={() => onChange(l.value)}
            />
            {l.label}
          </label>
        ))}
      </div>
      <div className="map-toggles">
        <label
          className={`toggle ${trafficOn ? 'is-on' : ''} ${is3d ? 'is-disabled' : ''}`}
          title={
            is3d
              ? 'Indisponível no modo 3D'
              : 'Trânsito em tempo real do Google (onde houver cobertura)'
          }
        >
          <input
            type="checkbox"
            checked={trafficOn}
            disabled={is3d}
            onChange={(e) => onTraffic(e.target.checked)}
          />
          <Icon name="traffic" size={16} /> Trânsito
        </label>
        <label
          className={`toggle ${signalsOn ? 'is-on' : ''} ${is3d ? 'is-disabled' : ''}`}
          title={is3d ? 'Indisponível no modo 3D' : 'Semáforos ao longo da rota de carro'}
        >
          <input
            type="checkbox"
            checked={signalsOn}
            disabled={is3d}
            onChange={(e) => onSignals(e.target.checked)}
          />
          <Icon name="signal" size={16} /> Semáforos
        </label>
        {demoAvailable && (
          <label
            className={`toggle toggle--demo ${demoOn ? 'is-on' : ''}`}
            title="Dados simulados para testar a interface"
          >
            <input type="checkbox" checked={demoOn} onChange={(e) => onDemo(e.target.checked)} />
            DEMO (simulado)
          </label>
        )}
      </div>
    </div>
  );
}
