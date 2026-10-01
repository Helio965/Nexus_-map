import {
  compareModes,
  SIGNAL_NO_TELEMETRY_MESSAGE,
  type ModeResult,
  type SignalLayerResponse,
} from '@nexus/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModeCards } from '../src/components/results/ModeCards';
import { ApproachLine, SignalsPanel } from '../src/components/signals/SignalsPanel';

const NOW = new Date('2026-10-20T09:00:00Z');

function available(
  mode: ModeResult['mode'],
  dep: string,
  arr: string,
  seconds: number,
): ModeResult {
  return {
    mode,
    status: 'available',
    provider: 't',
    warnings: [],
    options: [
      {
        id: `${mode}-0`,
        mode,
        departure: { instant: dep, timeZone: 'America/Sao_Paulo' },
        arrival: { instant: arr, timeZone: 'America/Sao_Paulo' },
        durationSeconds: seconds,
        distanceMeters: 24_600,
        traffic: { freshness: 'predicted' },
        segments: [],
        warnings: [],
      },
    ],
  };
}

describe('ModeCards', () => {
  it('destaca quem atende ao prazo e mostra "NÃO atende" sem esconder o modo', () => {
    const cmp = compareModes(
      {
        drive: available('drive', '2026-10-20T11:04:00Z', '2026-10-20T11:42:00Z', 2280),
        walk: available('walk', '2026-10-20T10:00:00Z', '2026-10-20T13:14:00Z', 11640),
        flight: {
          mode: 'flight',
          status: 'unavailable',
          options: [],
          warnings: [],
          provider: 't',
          message: 'Não há rota aérea adequada disponível.',
        },
      },
      { mode: 'arrive_by', instant: '2026-10-20T12:00:00Z', zone: 'America/Sao_Paulo' },
      'America/Sao_Paulo',
      NOW,
    );
    render(
      <ModeCards
        comparison={cmp}
        selectedMode={null}
        recommendedMode="drive"
        onSelect={() => undefined}
      />,
    );
    const drive = screen.getByRole('button', { name: /Carro/ });
    expect(within(drive).getByText('38 min')).toBeInTheDocument();
    expect(within(drive).getByText(/Atende ao horário/)).toBeInTheDocument();
    expect(within(drive).getByText('Recomendado')).toBeInTheDocument();
    expect(within(drive).getByText('◷')).toBeInTheDocument();
    const walk = screen.getByRole('button', { name: /A pé/ });
    expect(within(walk).getByText(/NÃO atende ao horário/)).toBeInTheDocument();
    expect(screen.getByText('Não há rota aérea adequada disponível.')).toBeInTheDocument();
  });
});

describe('Semáforos na interface', () => {
  it('sem telemetria: mostra a mensagem de indisponibilidade e nenhuma cor/fase', () => {
    const data: SignalLayerResponse = {
      status: 'ok',
      serverTime: '2026-10-20T09:00:00Z',
      messages: [
        'Nenhuma fonte de telemetria de semáforos está disponível para esta rota. Os semáforos são exibidos sem estado.',
      ],
      providers: [{ id: 'osm', name: 'OpenStreetMap (Overpass API)', status: 'ok' }],
      features: [
        {
          id: 'osm:node/1',
          location: { lat: 0, lng: 0 },
          label: 'Semáforo (OpenStreetMap)',
          sources: [{ provider: 'osm', attribution: '© Colaboradores do OpenStreetMap (ODbL)' }],
          telemetry: { status: 'none', reason: SIGNAL_NO_TELEMETRY_MESSAGE },
        },
      ],
    };
    render(
      <SignalsPanel
        layer={{ status: 'ready', data }}
        states={{}}
        stream="idle"
        clockOffsetMs={0}
        onFocus={() => undefined}
      />,
    );
    expect(screen.getByText(SIGNAL_NO_TELEMETRY_MESSAGE)).toBeInTheDocument();
    for (const t of ['VERMELHO', 'VERDE', 'AMARELO'])
      expect(screen.queryByText(new RegExp(t))).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tempo restante informado pela fonte')).not.toBeInTheDocument();
  });

  it('com telemetria sem tempo restante: fase em texto e nenhuma contagem regressiva', () => {
    const nowMs = Date.parse('2026-10-20T09:00:12Z');
    render(
      <ul>
        <ApproachLine
          nowMs={nowMs}
          approach={{
            streamId: 'hamburg_tld:15',
            laneConnection: '151_20',
            signalGroup: 'K4',
            travelDirection: 'sentido sul → norte',
            phase: 'red',
            phaseSince: '2026-10-20T09:00:00Z',
            stale: false,
          }}
        />
      </ul>,
    );
    expect(screen.getByText(/VERMELHO/)).toBeInTheDocument();
    expect(screen.getByText(/há 12 s/)).toBeInTheDocument();
    expect(screen.getByText(/não informa tempo restante/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Tempo restante informado pela fonte')).not.toBeInTheDocument();
  });

  it('contagem regressiva só aparece quando a fonte informa o horário da troca', () => {
    const nowMs = Date.parse('2026-10-20T09:00:00Z');
    render(
      <ul>
        <ApproachLine
          nowMs={nowMs}
          approach={{
            streamId: 'x:1',
            laneConnection: 'c',
            phase: 'green',
            phaseSince: '2026-10-20T08:59:50Z',
            nextChangeAt: '2026-10-20T09:00:18Z',
            stale: false,
          }}
        />
      </ul>,
    );
    expect(screen.getByLabelText('Tempo restante informado pela fonte')).toHaveTextContent('00:18');
  });

  it('observação antiga é mostrada como possivelmente desatualizada, sem cor de fase', () => {
    render(
      <ul>
        <ApproachLine
          nowMs={Date.parse('2026-10-20T09:10:00Z')}
          approach={{
            streamId: 'x:1',
            laneConnection: 'c',
            phase: 'green',
            phaseSince: '2026-10-20T09:00:00Z',
            stale: true,
          }}
        />
      </ul>,
    );
    expect(screen.getByText(/pode estar desatualizada/)).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveClass('approach--stale');
  });
});
