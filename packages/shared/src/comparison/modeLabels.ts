import type { TravelMode } from '../types/routes';

export const MODE_LABELS: Record<TravelMode, string> = {
  drive: 'Carro',
  walk: 'A pé',
  rail: 'Metrô / trilhos',
  flight: 'Avião',
};

export const MODE_ICONS: Record<TravelMode, string> = {
  drive: '🚗',
  walk: '🚶',
  rail: '🚇',
  flight: '✈',
};
