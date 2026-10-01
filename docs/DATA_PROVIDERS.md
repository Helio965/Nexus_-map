# Capacidades dos provedores de dados

> Este arquivo existe para que nenhuma alteração futura faça o Nexus Map apresentar uma
> informação que a fonte não fornece. **Antes de exibir um dado novo, confirme aqui (e na
> documentação oficial) que a fonte realmente o publica.** Verificado em 2026-10-01.

Legenda usada na interface:

| Selo | Significado |
|---|---|
| ● Ao vivo | condição atual informada pela fonte |
| ◷ Previsão | previsão/histórico ou horário programado |
| ○ Informação do mapa | dado estático |
| — Sem dados | a fonte não forneceu |

---

## MAPAS

- **Fornecedor:** Google Maps Platform — Maps JavaScript API (`@vis.gl/react-google-maps`).
- **Dados:** cartografia (`roadmap`), imagens aéreas (`satellite`), imagens + rótulos
  (`hybrid`), relevo (`terrain`); vista 3D fotorrealista (`Map3DElement`, GA) carregada sob demanda.
- **Cobertura:** mundial para 2D; 3D fotorrealista varia por cidade (fora dela o Google mostra satélite).
- **É tempo real?** Não. A camada opcional `TrafficLayer` mostra trânsito em tempo real "where supported".
- **Limitações:** 45° Imagery descontinuada na v3.65 (maio/2026). Vetorial exige Map ID e WebGL
  (sem WebGL o SDK volta a raster). Sem `VITE_GOOGLE_MAPS_BROWSER_KEY` **nenhum mapa é exibido**
  (não há imagem substituta). Sem `VITE_GOOGLE_MAPS_MAP_ID` usa-se `DEMO_MAP_ID` (apenas testes).
- **Credencial:** chave de navegador restrita por referrer e à Maps JavaScript API.

## BUSCA DE LOCAIS

- **Fornecedor:** Places API (New) — Autocomplete (New) e Place Details (New), via servidor.
- **Dados:** Place ID, nome, endereço, coordenadas, tipos, rótulo do tipo, **fuso IANA** (`timeZone`).
- **Cobertura:** mundial.
- **Limitações:** até 5 sugestões por consulta; só sugestões com Place ID são aceitas
  (texto livre nunca vira rota). Place Details com `displayName`/`timeZone` é SKU Pro.
- **Complementos:** Geocoding API (reverso, "usar minha localização") e Time Zone API (fuso de
  coordenadas sem Place ID, como aeroportos).

## ROTAS (carro e a pé)

- **Fornecedor:** Google Routes API `computeRoutes` (v2), via servidor, sempre com field mask.
- **Dados:** polilinha `HIGH_QUALITY`, distância, `duration` (com trânsito), `staticDuration`
  (sem trânsito), passos com `navigationInstruction` (texto do mecanismo), manobra,
  `routeLabels`, `warnings`, `tollInfo`, `fallbackInfo`; até 3 alternativas.
- **Cobertura:** mundial onde o Google tem malha viária.
- **Limitações:**
  - `arrivalTime` é **ignorado** fora de `TRANSIT` → "Chegar até" de carro/a pé é calculado pela
    aplicação (iteração sobre respostas reais; ver README).
  - `departureTime` no passado só é aceito para `TRANSIT`.
  - Rotas a pé estão **em beta** e "may lack complete sidewalk or path coverage" — aviso exibido
    sempre. A aplicação **não** afirma existência de calçada.
  - Pedágio: `tollInfo` ausente = sem pedágio previsto; presente sem preço = há pedágio, valor desconhecido.

## TRÂNSITO

- **Fornecedor:** Google Routes API (`TRAFFIC_AWARE` + `TRAFFIC_ON_POLYLINE`) e, no mapa,
  `TrafficLayer` da Maps JavaScript API.
- **Dados:** categorias `NORMAL`, `SLOW`, `TRAFFIC_JAM` por intervalo de pontos da polilinha
  (rota/trecho; **não por passo**); atraso = `duration − staticDuration`.
- **Cobertura:** onde o Google tem dados de trânsito.
- **Atualização:** a cada requisição. Saída "agora" → ● Ao vivo; saída futura → ◷ Previsão
  ("the farther ahead … the more consideration is given to historical traffic").
  `fallbackInfo = FALLBACK_TRAFFIC_UNAWARE` → — Sem dados ("Dados de trânsito temporariamente indisponíveis").
- **Custo:** `TRAFFIC_ON_POLYLINE` e `TOLLS` ⇒ SKU Enterprise (desligáveis por variável de ambiente).

## METRÔ / TRILHOS

- **Fornecedor:** Google Routes API, `travelMode: TRANSIT`,
  `allowedTravelModes: [SUBWAY, TRAIN, LIGHT_RAIL, RAIL]`.
- **Fonte:** dados das agências no Google Transit Partner Program (GTFS/GTFS-Realtime enviados ao Google).
- **Horários:** `stopDetails.departureTime/arrivalTime` com fuso IANA (`localizedValues.*.timeZone`);
  `headsign`, `headway`, `stopCount`, linha (`name`, `nameShort`, `color`), operadora, tipo de veículo.
  Exibidos como ◷ Previsão.
- **Real-time disponível?** A API não indica, por trecho, se o horário é programado ou em tempo
  real; por isso **nunca** rotulamos como "Ao vivo".
- **Limitações:** a API "may still use other transit modes"; a aplicação **descarta** rotas com
  qualquer veículo não ferroviário (ônibus, balsa, teleférico…) e informa isso. Janela: 7 dias
  atrás a 100 dias à frente. Sem dados da cidade no Google → "Não há rota de metrô".
- **GTFS próprio:** não integrado. A interface `TransitProvider` permite adicionar (ex.: OpenTripPlanner).

## VOOS

- **Fornecedor:** FlightAware AeroAPI v4 — `GET /schedules/{date_start}/{date_end}` (interface `FlightProvider`).
- **Tipo de informação:** horários **publicados pelas companhias** (gate out/in, UTC), número do voo,
  operador real em codeshare, tipo de aeronave. "May not reflect actual flight information".
  **Não** inclui preço, assentos disponíveis nem status em tempo real nessa consulta.
- **Cobertura:** mundial (companhias que publicam horários); 3 meses atrás a 1 ano à frente;
  janela máxima de 3 semanas por consulta. **Somente voos diretos** (conexões não são montadas).
- **Aeroportos:** OurAirports (domínio público, atualizado diariamente): somente `large_airport`/
  `medium_airport` com `scheduled_service = yes` e código IATA. Fuso do aeroporto: Time Zone API.
- **Limitações:** plano Personal = 10 result sets/minuto e uso pessoal/acadêmico; uso comercial
  exige Standard/Premium. Sem chave → "não configurado"; **nenhum voo é simulado**.
  Amadeus Self-Service foi encerrado em 17/07/2026 e não é usado.
- **Margens no aeroporto:** definidas pelo usuário; **não** são tempos oficiais.

## SEMÁFOROS

| Fornecedor | SPaT/telemetria? | Cobertura | O que exibimos |
|---|---|---|---|
| OpenStreetMap (`highway=traffic_signals`, via Overpass API) | **Não** — só localização | Mundial, conforme mapeamento colaborativo | Marcador **cinza**: "Semáforo identificado. Estado em tempo real indisponível nesta localização." |
| Hamburg Traffic Lights Data (TLD) — Freie und Hansestadt Hamburg / LSBG | **Sim** — fase atual por conexão de faixa (`primary_signal`: 0 apagado, 1 vermelho, 2 amarelo, 3 verde, 4 vermelho+amarelo, 5 amarelo piscante, 6 verde piscante, 9 desconhecido) | Cruzamentos de Hamburgo (Alemanha) publicados pela cidade (~20 mil conexões de faixa em 2026-10-01) | Fase em texto + emoji, "desde há X s" (de `phenomenonTime`). **Sem contagem regressiva**: a fonte não publica tempo restante. |
| Modo demonstração (interno) | **Simulado** | — | Somente com `TRAFFIC_SIGNAL_DEMO_MODE=true`, endpoint e camada separados, faixa "MODO DEMONSTRAÇÃO — dados simulados". |

- **Cidades suportadas com telemetria real:** **Hamburgo**. Nenhuma fonte pública de SPaT foi
  encontrada para cidades brasileiras.
- **Associação ao sentido:** a fase só é mostrada para a rota quando linha de retenção, ponto a
  montante da faixa de entrada e ponto a jusante da faixa de saída estão a ≤ 20–25 m da polilinha e
  na ordem montante → retenção → jusante, com rumo compatível (≤ 50°). Caso contrário:
  "não foi possível associar com segurança uma fase ao seu sentido" e nenhuma fase.
- **Desatualização:** observação mais antiga que `SIGNALS_STALE_AFTER_SECONDS` (padrão 300 s) é
  exibida como "pode estar desatualizada", sem cor de fase.
- **Atualização:** servidor assina MQTT (`wss://tld.iot.hamburg.de:443/mqtt`,
  `v1.1/Datastreams({id})/Observations`) só para os fluxos da rota e repassa por SSE; contingência
  por REST a cada 5 s se o MQTT cair; o cliente ressincroniza a cada 30 s.
- **Aviso da fonte:** dados em **beta** ("unpredictable failures", "data may be incorrect, especially location data").
- **Licença/atribuição:** atribuição à Freie und Hansestadt Hamburg (LSBG) exibida na interface;
  OSM sob ODbL ("© colaboradores do OpenStreetMap").
- **Overpass:** instâncias públicas pedem ≤ ~10.000 requisições/dia; aplicações grandes devem usar
  instância própria (`OVERPASS_API_URL`).

## FUSOS HORÁRIOS

- **Fornecedores:** Places API (New) `timeZone` (IANA) para locais escolhidos; Time Zone API
  para coordenadas (localização do dispositivo, aeroportos); `localizedValues.timeZone` da Routes
  API para paradas de transporte.
- Fuso do dispositivo só é usado para a própria localização do dispositivo quando nenhum serviço
  respondeu — e a interface avisa.

---

## Como adicionar um provedor

1. Confirme na documentação oficial **o que** a fonte publica e com que atualização.
2. Implemente a interface correspondente (`FlightProvider`, `TrafficSignalProvider`,
   `SignalLocationSource`, `TransitProvider`) em `server/src/providers/…`.
3. Atualize este arquivo (tabela, cobertura, limitações) e o README.
4. Testes com fixtures sintéticas em `server/tests/fixtures/` — nunca dados simulados em produção.
