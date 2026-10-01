/** Configuração do navegador (somente valores públicos; segredos ficam no servidor). */
export const config = {
  mapsBrowserKey: import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY?.trim() || '',
  /**
   * Map ID vetorial do Cloud Console. Sem ele usamos o "DEMO_MAP_ID" documentado pelo Google
   * para testes de marcadores avançados — não use em produção.
   */
  mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim() || 'DEMO_MAP_ID',
  mapIdIsDemo: !import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim(),
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/$/, ''),
} as const;
