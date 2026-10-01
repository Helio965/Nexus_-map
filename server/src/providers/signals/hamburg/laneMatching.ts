import {
  bearingDegrees,
  pathLengthMeters,
  pointAlongPath,
  projectOntoPath,
  travelDirectionLabel,
  type LatLng,
  type SignalPhase,
} from '@nexus/shared';
import type { RouteGeometry } from '../TrafficSignalProvider';

/**
 * Conexão de faixa do Hamburg TLD ("Thing"). A geometria é um MultiLineString na ordem
 * [faixa de entrada, percurso no cruzamento, faixa de saída]. A faixa de entrada COMEÇA na
 * linha de retenção (mesmo ponto do FeatureOfInterest "_Stop") e segue para montante;
 * a faixa de saída começa no cruzamento e segue para jusante. Verificado em 2026-10-01 nos
 * dados públicos (ex.: Things 353_12 e 151_20).
 */
export interface LaneConnection {
  thingId: number;
  name: string;
  trafficLightsId: string;
  laneType: string;
  signalGroup?: string;
  lines: LatLng[][];
  datastreamId?: number;
  latest?: { phenomenonTime?: string; resultTime?: string; result?: number };
}

export interface LaneMatch {
  connection: LaneConnection;
  stop: LatLng;
  stopAlongMeters: number;
  /** Rumo de quem chega à linha de retenção (montante → retenção). */
  approachBearing: number;
  travelDirection: string;
}

export interface MatchTolerances {
  /** Distância máxima da linha de retenção à rota (m). */
  stopLateral: number;
  /** Distância máxima dos pontos de montante/jusante à rota (m). */
  laneLateral: number;
  /** Quanto percorrer nas faixas de entrada/saída para os pontos de teste (m). */
  probeDistance: number;
  /** Diferença angular máxima entre faixa de entrada e rota (graus). */
  maxBearingDiff: number;
  /** Distância máxima, ao longo da rota, entre montante e jusante (m). */
  maxSpan: number;
}

export const DEFAULT_TOLERANCES: MatchTolerances = {
  stopLateral: 20,
  laneLateral: 25,
  probeDistance: 30,
  maxBearingDiff: 50,
  maxSpan: 300,
};

export function isMotorVehicleLane(laneType: string | undefined): boolean {
  return !!laneType && laneType.split('/').some((t) => t.trim() === 'KFZ');
}

/**
 * Só associa a fase à rota quando: linha de retenção, ponto a montante na faixa de entrada e
 * ponto a jusante na faixa de saída estão próximos da rota E aparecem nessa ordem ao longo
 * dela, com rumo compatível. Caso contrário retorna null (nenhuma fase é exibida).
 */
export function matchLaneConnection(
  conn: LaneConnection,
  route: RouteGeometry,
  tol: MatchTolerances = DEFAULT_TOLERANCES,
): LaneMatch | null {
  const ingress = conn.lines[0];
  const egress = conn.lines[conn.lines.length - 1];
  if (!ingress || !egress || conn.lines.length < 2 || ingress.length < 2 || egress.length < 2)
    return null;

  const stop = ingress[0]!;
  const upstream = pointAlongPath(ingress, Math.min(tol.probeDistance, pathLengthMeters(ingress)))!;
  const downstream = pointAlongPath(egress, Math.min(tol.probeDistance, pathLengthMeters(egress)))!;

  const pStop = projectOntoPath(stop, route.path, route.cumulative);
  const pUp = projectOntoPath(upstream, route.path, route.cumulative);
  const pDown = projectOntoPath(downstream, route.path, route.cumulative);
  if (!pStop || !pUp || !pDown) return null;
  if (
    pStop.lateral > tol.stopLateral ||
    pUp.lateral > tol.laneLateral ||
    pDown.lateral > tol.laneLateral
  )
    return null;
  if (!(pUp.distanceAlong < pStop.distanceAlong && pStop.distanceAlong < pDown.distanceAlong))
    return null;
  if (pDown.distanceAlong - pUp.distanceAlong > tol.maxSpan) return null;

  const approachBearing = bearingDegrees(upstream, stop);
  const diff = Math.abs(((approachBearing - pStop.segmentBearing + 540) % 360) - 180);
  if (diff > tol.maxBearingDiff) return null;

  return {
    connection: conn,
    stop,
    stopAlongMeters: pStop.distanceAlong,
    approachBearing,
    travelDirection: travelDirectionLabel(approachBearing),
  };
}

/** Códigos do datastream primary_signal (guia oficial TLD). Códigos fora da lista → null. */
export function phaseFromTldCode(code: number | undefined): SignalPhase | null {
  switch (code) {
    case 0:
      return 'dark';
    case 1:
      return 'red';
    case 2:
      return 'amber';
    case 3:
      return 'green';
    case 4:
      return 'red_amber';
    case 5:
      return 'amber_flashing';
    case 6:
      return 'green_flashing';
    case 9:
      return 'unknown';
    default:
      return null;
  }
}
