# Pesquisa técnica — Nexus Map

> Documento produzido **antes** da implementação. Registra o que foi analisado,
> o que cada fonte de dados realmente oferece e as decisões tomadas a partir disso.
> Data da pesquisa: 2026-10-01.

---

## 1. Material de referência analisado

### 1.1 Vídeo fornecido

Gravação de tela (15,5 s, 1080×2340) de um post de Instagram ("Find Route Button", @codewithayansh).
Quadro a quadro, o sistema do vídeo faz o seguinte:

1. Mostra um único botão azul **"Find Route"** sobre fundo amarelo.
2. Ao clicar, peças de quebra-cabeça se juntam e formam um mapa.
3. O mapa é um raster de Manhattan com **marca d'água "API KEY REQUIRED"** repetida
   (tiles de um provedor usados sem chave).
4. Aparecem um marcador verde (origem) e um vermelho (destino).
5. Uma **linha reta tracejada** azul é desenhada entre os dois pontos, atravessando
   quarteirões e o Central Park — **não é uma rota**, é um segmento geométrico.

Conclusão: o vídeo serve só como ideia de fluxo (origem → destino → buscar → ver no mapa).
Tudo o que ele mostra de "rota" é justamente o que este projeto **não** pode fazer
(linha reta, tiles sem licença, nenhum dado de tempo/distância).

### 1.2 Imagens do Google Maps

A mensagem citava imagens do Google Maps (normal e satélite), mas **somente o vídeo foi
anexado**. Nenhuma imagem foi recebida, então nada foi inferido a partir delas.

### 1.3 Estado do repositório

```
$ git log --oneline
f162edd Initial commit
```

Somente `README.md` (título) e `LICENSE` (MIT). Não havia arquitetura anterior a
preservar; o projeto foi estruturado do zero.

---

## 2. Funcionalidades solicitadas (resumo)

| # | Funcionalidade | Depende de |
|---|---|---|
| 1 | Busca de origem/destino com autocomplete geográfico real | Places API (New) |
| 2 | Mapa normal / satélite / híbrido / terreno / 3D | Maps JavaScript API |
| 3 | Rota de carro real, alternativas, pedágio, trânsito | Routes API |
| 4 | Trânsito na própria rota (normal/lento/congestionado) | Routes API (`TRAFFIC_ON_POLYLINE`) |
| 5 | Rota a pé específica para pedestres | Routes API (`WALK`) |
| 6 | Metrô/ferroviário com estações, linhas, horários | Routes API (`TRANSIT`) |
| 7 | Avião multimodal (terra → voo → terra) com voos reais | Fonte de aeroportos + fonte de horários de voos + Routes API |
| 8 | "Sair agora", "Sair às", "Chegar até" | Routes API + lógica própria |
| 9 | Comparação e recomendação objetiva | Lógica própria sobre dados reais |
| 10 | Semáforos: localização e fase em tempo real somente se houver telemetria | OpenStreetMap + fonte SPaT/ITS municipal |
| 11 | Fusos horários corretos | Places API `timeZone` / Time Zone API / fuso do aeroporto |

---

## 3. APIs pesquisadas e o que realmente suportam

### 3.1 Google Maps JavaScript API

Fontes: [Map types](https://developers.google.com/maps/documentation/javascript/maptypes),
[Vector maps](https://developers.google.com/maps/documentation/javascript/vector-map),
[3D Maps overview](https://developers.google.com/maps/documentation/javascript/3d-maps-overview),
[3D Map reference](https://developers.google.com/maps/documentation/javascript/reference/3d-map),
[3D drawing reference](https://developers.google.com/maps/documentation/javascript/reference/3d-map-draw),
[Traffic/Transit layers](https://developers.google.com/maps/documentation/javascript/trafficlayer).

- Tipos de mapa básicos: `roadmap`, `satellite`, `hybrid`, `terrain` (imagens e cartografia reais do Google).
- **45° Imagery foi descontinuada na versão 3.65 (maio/2026)**: satélite/híbrido não mudam mais
  automaticamente para 45°; a documentação orienta migrar para **3D Maps**.
- **Mapas vetoriais** (WebGL, exigem Map ID com renderização vetorial): imagens mais nítidas,
  zoom fracionário, tilt/heading programáticos, prédios 3D em zoom alto. Sem WebGL, o próprio
  SDK volta para raster.
- **3D Maps (`importLibrary('maps3d')`) está em GA**. `Map3DElement` com `center`, `range`,
  `tilt`, `heading`, `mode` (`SATELLITE` ou `HYBRID`; `ROADMAP` só no canal alpha).
  Elementos: `Polyline3DElement` (`path`, `strokeColor`, `strokeWidth`, `outerColor`,
  `altitudeMode`, `drawsOccludedSegments`), `Marker3DElement`, `Marker3DInteractiveElement`.
  `coordinates` está **deprecated** em favor de `path`. Cobertura 3D fotorrealista varia por cidade.
- `TrafficLayer`: "add real-time traffic information (where supported)".
- Nitidez/HiDPI: o SDK escolhe a resolução dos tiles/vetores conforme o `devicePixelRatio`
  do navegador. A aplicação não deve aplicar `transform: scale`, `filter` ou redimensionamento
  CSS no contêiner do mapa.

### 3.2 Places API (New)

Fontes: [Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete),
[Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details),
[Place resource](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places),
[Place types](https://developers.google.com/maps/documentation/places/web-service/place-types),
[Session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing).

- `POST https://places.googleapis.com/v1/places:autocomplete`, cabeçalhos `X-Goog-Api-Key` e
  `X-Goog-FieldMask`. Até 5 sugestões. `sessionToken`, `locationBias` **ou** `locationRestriction`
  (não ambos), `includedRegionCodes` (até 15), `languageCode`, `origin` (para `distanceMeters`).
- `GET https://places.googleapis.com/v1/places/{PLACE_ID}` — field mask obrigatória
  ("There is no default list of returned fields").
- Campos usados e tier: `id` (IDs Only), `formattedAddress`/`location`/`types`/`viewport`
  (Essentials), `displayName`/`primaryType`/`primaryTypeDisplayName`/**`timeZone`** (Pro).
- `timeZone.id` é **IANA** (ex.: `America/New_York`) — resolve o fuso de origem/destino sem
  chamada extra.
- Sessões: as 12 primeiras requisições de autocomplete da sessão são cobradas; da 13ª em diante
  saem pelo SKU "Autocomplete Session Usage" (sem cobrança). Sessão abandonada volta ao preço por
  requisição. Token não pode ser reutilizado após o Place Details.
- Tipos de transporte existentes (Tabela A): `airport`, `international_airport`, `airstrip`,
  `subway_station`, `train_station`, `light_rail_station`, `transit_station`… **Places não
  retorna código IATA**.

### 3.3 Routes API (`computeRoutes`)

Fontes: [computeRoutes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes),
[RouteTravelMode](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelMode),
[Traffic trade-offs](https://developers.google.com/maps/documentation/routes/config_trade_offs),
[Traffic on polylines](https://developers.google.com/maps/documentation/routes/traffic_on_polylines),
[Transit routes](https://developers.google.com/maps/documentation/routes/transit-route),
[TransitPreferences](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TransitPreferences),
[Usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing).

Fatos relevantes (citações da documentação):

- **Field mask obrigatória** (`X-Goog-FieldMask`); o Google desaconselha `*`.
- `routingPreference` só para `DRIVE`/`TWO_WHEELER`:
  - `TRAFFIC_UNAWARE` — sem trânsito atual; `staticDuration` = `duration`.
  - `TRAFFIC_AWARE` — considera trânsito atual com otimizações de latência.
  - `TRAFFIC_AWARE_OPTIMAL` — busca exaustiva; "equivalent to the mode used by maps.google.com".
  - "Live traffic becomes more important and relevant the closer the departureTime is to now.
    The farther ahead you set the departure time into the future, the more consideration is given
    to historical traffic conditions." → atende ao requisito de trânsito atual vs. histórico.
  - `duration` = com trânsito; `staticDuration` = sem considerar trânsito.
- `departureTime`: "You can only specify a `departureTime` in the past when `RouteTravelMode`
  is set to `TRANSIT`."
- **`arrivalTime`: "This field is ignored when requests specify a `RouteTravelMode` other than
  `TRANSIT`."** → para carro e a pé, "Chegar até" precisa ser calculado pela aplicação
  (ver §5.4). Não enviamos `arrivalTime` para esses modos.
- Transit: até 7 dias no passado e 100 dias no futuro; sem waypoints intermediários.
- `trafficModel` só com `TRAFFIC_AWARE_OPTIMAL` + `DRIVE`.
- `extraComputations`: `TOLLS`, `TRAFFIC_ON_POLYLINE` etc.
- Trânsito na polilinha: exige `TRAFFIC_AWARE`/`TRAFFIC_AWARE_OPTIMAL` + `TRAFFIC_ON_POLYLINE`;
  intervalos com `startPolylinePointIndex`/`endPolylinePointIndex` e `speed` ∈
  {`NORMAL`, `SLOW`, `TRAFFIC_JAM`}; índice inicial ausente = 0 (proto3).
  **Disponível só no nível de rota/trecho (leg), não por passo.**
- `computeAlternativeRoutes`: até 3 rotas; não funciona com waypoints intermediários.
- Passos: `navigationInstruction.instructions` (texto real, localizado por `languageCode`) e
  `maneuver` (`TURN_LEFT`, `RAMP_RIGHT`, `ROUNDABOUT_LEFT`, …).
- Rotas a pé: **"Walking, bicycling, and two-wheeler routes are currently in beta testing and may
  lack complete sidewalk or path coverage in some areas. Users must be warned"** — e o campo
  `routes.warnings` traz avisos a exibir. → o aviso é mostrado sempre na rota a pé.
- Transit:
  - `transitPreferences.allowedTravelModes`: `BUS`, `SUBWAY`, `TRAIN`, `LIGHT_RAIL`,
    `RAIL` ("equivalent to a combination of `SUBWAY`, `TRAIN`, and `LIGHT_RAIL`").
  - **"returned routes may still use other transit modes … depending on the efficiency of the
    route"** → a aplicação precisa **verificar** os veículos de cada passo e não pode assumir
    que a rota é ferroviária só porque pediu `RAIL`.
  - `transitDetails`: `stopDetails` (paradas de embarque/desembarque com nome, localização e
    horários), `localizedValues` (horários com fuso), `headsign` (sentido), `headway`,
    `transitLine` (`name`, `nameShort`, `color`, `textColor`, `agencies`, `vehicle.type`),
    `stopCount`, `tripShortText`.
  - `TransitVehicle.type`: `SUBWAY`, `METRO_RAIL`, `HEAVY_RAIL`, `COMMUTER_TRAIN`, `RAIL`,
    `HIGH_SPEED_TRAIN`, `LONG_DISTANCE_TRAIN`, `MONORAIL`, `TRAM`, `BUS`, `FERRY`, …
  - `routingPreference`: `LESS_WALKING` / `FEWER_TRANSFERS`.
- `fallbackInfo` indica quando o servidor usou um modo de cálculo alternativo (ex.: sem trânsito);
  isso é repassado ao usuário.

### 3.4 Time Zone API

Fonte: [Time Zone requests](https://developers.google.com/maps/documentation/timezone/requests-timezone).
`GET https://maps.googleapis.com/maps/api/timezone/json?location=lat,lng&timestamp=…&key=…`
retorna `timeZoneId` (identificador CLDR/IANA), `rawOffset`, `dstOffset`, `status`.
Usada quando não temos o fuso pela Places API (ex.: "usar minha localização", aeroportos).

### 3.5 Geocoding API (reverso)

Usada apenas no botão "Utilizar minha localização" para transformar a coordenada do navegador
em endereço real. Preço: Geocoding (Essentials).

### 3.6 Voos

| Fornecedor | Situação verificada | Uso possível |
|---|---|---|
| **Amadeus Self-Service** | **Encerrado em 17/07/2026** — portal fechado, chaves desativadas ([PhocusWire](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers), [issue citando o anúncio](https://github.com/abhinavmathur-atlan/mcp-travel-assistant/issues/4)). Só o Enterprise continua. | Descartado |
| **FlightAware AeroAPI v4** | Ativo. Especificação OpenAPI oficial baixada (v4.17.1). | **Escolhido** |
| Duffel | Ofertas comerciais com preço; o modo de teste usa companhia fictícia ("Duffel Airways"). | Não usado (modo teste não é dado real) |
| AeroDataBox, Aviationstack, OAG, Cirium | Comerciais; possível via a mesma interface `FlightProvider`. | Roadmap |

**AeroAPI — `GET /schedules/{date_start}/{date_end}`** (spec oficial):

- "Returns scheduled flights that have been published by airlines. These schedules are available
  for up to three months in the past as well as one year into the future."
- Filtros `origin`, `destination` (ICAO ou IATA), `airline`, `flight_number`,
  `include_codeshares`, `include_regional`, `max_pages`, `cursor`.
- Janela máxima de 3 semanas entre `date_start` e `date_end`.
- Resposta `scheduled[]`: `ident`, `ident_iata`, `actual_ident` (operador real em codeshare),
  `aircraft_type`, `scheduled_out` / `scheduled_in` (**UTC**, horário de gate),
  `origin_iata`, `destination_iata`, …
- "All data is sourced from operator's schedule and may not reflect actual flight information".
- Somente **voos diretos** (um par origem→destino). Conexões não vêm prontas.
- Autenticação: cabeçalho `x-apikey`. Base: `https://aeroapi.flightaware.com/aeroapi`.
- Planos ([página comercial](https://www.flightaware.com/commercial/aeroapi/)): Personal
  (sem mínimo, US$ 5/mês de crédito, **10 result sets/minuto**, uso pessoal/acadêmico),
  Standard (US$ 100/mês), Premium (US$ 1.000/mês, uso comercial). Cobrança por "result set"
  (15 registros).
- `GET /airports/nearby` existe, mas **não informa se o aeroporto tem voos regulares**
  (retorna helipontos, pistas privadas etc.).

**Aeroportos — OurAirports** ([dados](https://ourairports.com/data/)):
"All data is released to the Public Domain"; atualizado diariamente;
CSV em `https://davidmegginson.github.io/ourairports-data/airports.csv` (~12,7 MB, 86 mil
registros, verificado). Colunas `type` (`large_airport`, `medium_airport`, …),
`scheduled_service` (`yes`/`no`), `iata_code`, `icao_code`, `latitude_deg`, `longitude_deg`,
`municipality`, `iso_country`. Exemplos verificados: `SBBR/BSB` Brasília, `EDDH/HAM` Hamburgo,
`KJFK/JFK`.

### 3.7 Transporte público e GTFS

A Routes API (`TRANSIT`) usa dados do Google Transit Partner Program; a cobertura depende de
cada agência ter publicado GTFS/GTFS-Realtime para o Google. Quando a cidade não está coberta,
a API simplesmente não retorna rota — e a aplicação diz isso.
Integrar GTFS diretamente exigiria um motor de roteamento (ex.: OpenTripPlanner) por cidade;
isso fica previsto na interface `TransitProvider`, mas **não** foi implementado (ver Roadmap).

### 3.8 Semáforos (SPaT / ITS)

Pesquisa por fontes **reais e públicas** de estado de semáforo:

- **Hamburgo — Traffic Lights Data (TLD)**, Freie und Hansestadt Hamburg / LSBG.
  OGC SensorThings API (FROST-Server) em `https://tld.iot.hamburg.de/v1.1/` + MQTT
  (`tld.iot.hamburg.de:1883` ou WebSocket `wss://tld.iot.hamburg.de:443/mqtt`), tópico
  `v1.1/Datastreams({id})/Observations`. **Verificado ao vivo em 2026-10-01**: 20.086 "Things",
  observações com atraso de 1–3 s.
  - Cada *Thing* é uma **conexão de faixa** (faixa de entrada → faixa de saída) com geometria
    `MultiLineString` [faixa de entrada (começa na linha de retenção), percurso no cruzamento,
    faixa de saída]; `laneType` ∈ {`KFZ`, `KFZ/Bus`, `KFZ/Radfahrer`, `Radfahrer`,
    `Fußgänger`, `Bus`, …}.
  - Datastream `primary_signal`: resultado `0=dark, 1=red, 2=amber, 3=green, 4=red-amber,
    5=amber-flashing, 6=green-flashing, 9=unknown`; `phenomenonTime` (relógio do controlador)
    e `resultTime`.
  - `cycle_second` e `signal_program` existem, mas **não há tempo restante nem previsão de
    troca de fase**. Portanto **não exibimos contagem regressiva** para Hamburgo — só a fase e
    há quanto tempo ela começou (dado real: `phenomenonTime`).
  - Guia oficial: dados em **beta**, "unpredictable failures", "data may be incorrect, especially
    location data" — avisamos isso na interface.
  - Associação ao sentido do veículo é possível porque cada fase pertence a uma conexão de
    faixa com geometria (ver §5.7).
- **Localização sem estado**: OpenStreetMap, nós `highway=traffic_signals` via Overpass API
  ([política de uso](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html):
  ~10.000 requisições/dia, ~1 GB/dia por usuário; HTTP 429 em excesso; aplicações de grande
  porte devem ter instância própria). Licença ODbL — atribuição "© OpenStreetMap contributors".
  Durante a pesquisa, as instâncias públicas responderam com *reset*/timeout a partir deste
  ambiente — a aplicação trata isso como "dados temporariamente indisponíveis".
- **Brasil**: não foi encontrada nenhuma fonte pública de SPaT/telemetria de semáforos.
- **Outras**: implantações SPaT nos EUA (programas de Connected Vehicle) transmitem por
  DSRC/C-V2X na via, não por API pública; serviços comerciais (ex.: Traffic Technology Services)
  exigem contrato. Ficam como provedores futuros via `TrafficSignalProvider`.
- **Google Routes API não fornece localização nem estado de semáforos.**

---

## 4. Custos e quotas relevantes (tabela de preços global do Google, faixa 0–100 mil)

Fonte: [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing).
Cotas gratuitas mensais por SKU: Essentials 10.000, Pro 5.000, Enterprise 1.000.

| SKU | Grátis/mês | US$ por 1.000 |
|---|---|---|
| Dynamic Maps | 10.000 | 7,00 |
| Routes: Compute Routes Essentials | 10.000 | 5,00 |
| Routes: Compute Routes **Pro** (trânsito, ≥11 waypoints…) | 5.000 | 10,00 |
| Routes: Compute Routes Enterprise | 1.000 | 15,00 |
| Autocomplete Requests | 10.000 | 2,83 |
| Place Details Essentials | 10.000 | 5,00 |
| Place Details **Pro** (inclui `displayName`, `timeZone`) | 5.000 | 17,00 |
| Geocoding | 10.000 | 5,00 |
| Time Zone | 10.000 | 5,00 |
| Photorealistic 3D (Map Tiles) | 1.000 | 6,00 |

Gatilhos de SKU da Routes API ([SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details)):
**Pro** = `TRAFFIC_AWARE`/`TRAFFIC_AWARE_OPTIMAL`, 11–25 waypoints, `optimizeWaypointOrder`,
modificadores de localização; **Enterprise** = rota de duas rodas, **cálculo de pedágio**,
**informação de trânsito na polilinha**. "If you request any features from a higher-priced SKU,
then your request is billed at the higher rate."

Consequências de projeto:
- A rota de carro exibida usa `TRAFFIC_AWARE` + `TRAFFIC_ON_POLYLINE` + `TOLLS` → SKU
  **Enterprise** (US$ 15/1.000, 1.000 grátis/mês). Ambos os extras podem ser desligados por
  variável de ambiente (`ROUTES_TRAFFIC_ON_POLYLINE`, `ROUTES_TOLLS`) para cair no SKU Pro.
- As chamadas internas do "Chegar até" de carro (iterações) e as estimativas de trajeto até
  aeroportos usam só `TRAFFIC_AWARE` com field mask mínima (`routes.duration`, SKU Pro); apenas
  a chamada final pede polilinha com trânsito e pedágio. No pior caso: 3 chamadas Pro + 1
  Enterprise.
- Autocomplete com *session token* + debounce de 300 ms + mínimo de 3 caracteres.
- Cache no servidor (LRU com TTL curto) para rotas e voos; TTL longo para fusos e aeroportos.
- AeroAPI Personal: 10 result sets/min → limitamos os pares de aeroportos consultados.

---

## 5. Decisões

### 5.1 Arquitetura

- **Monorepo npm workspaces**: `client/` (React 19 + TypeScript + Vite), `server/`
  (Node.js 22 + TypeScript + Express 5), `packages/shared/` (tipos do contrato, lógica pura de
  tempo, comparação e recomendação — testada isoladamente e usada pelos dois lados).
- **Chaves privadas só no servidor**: Routes, Places, Time Zone, Geocoding e AeroAPI são
  chamadas pelo backend (chave com restrição por IP + restrição de APIs). O navegador recebe
  **apenas** a chave da Maps JavaScript API, restrita por *referrer* e à Maps JavaScript API.
  Isso também permite field masks, cache e limite de taxa centralizados.
- Camada de integrações separada (`server/src/providers/*`) e serviços de domínio
  (`server/src/services/*`): `PlacesService`, `RouteService`, `TransitService`,
  `FlightService` (+ `FlightProvider`), `TrafficService`, `TrafficSignalService`
  (+ `TrafficSignalProvider`), `TimeZoneService`, `ScheduleService`; `RouteComparisonService`
  e `RecommendationService` no pacote compartilhado. No cliente, `MapService` concentra a
  lógica do mapa.
- Sem mocks em produção: se uma chave não está configurada, o provedor correspondente responde
  "não configurado" e a interface mostra isso.

### 5.2 Mapas

- `@vis.gl/react-google-maps` (provisionada pelo time do Google Maps Platform) para o mapa 2D.
- Map ID vetorial recomendado (`VITE_GOOGLE_MAPS_MAP_ID`); camadas: Mapa, Satélite, Híbrido,
  Terreno (trocadas via `mapTypeId`, sem remontar a aplicação) e **3D** (`Map3DElement`,
  carregado sob demanda — lazy — apenas quando o usuário escolhe 3D).
- Camada de trânsito do Google (`TrafficLayer`) opcional.
- Nenhum filtro/escala CSS no mapa; nada de upscaling.

### 5.3 Rotas

- Carro: `DRIVE` + `TRAFFIC_AWARE` + `TRAFFIC_ON_POLYLINE` + `TOLLS` + alternativas +
  `polylineQuality: HIGH_QUALITY`. Exibe `duration` (com trânsito) e `staticDuration`
  (sem trânsito), pedágio quando informado e `fallbackInfo`.
- A pé: `WALK` (rota de pedestre calculada pelo motor, não reaproveita a do carro) com aviso
  obrigatório de beta + `warnings` da API.
- Instruções passo a passo vêm de `navigationInstruction.instructions`.

### 5.4 Horários

- "Sair agora": `departureTime` omitido (padrão = agora) para carro; explícito para transit.
- "Sair às": horário local da **origem** (fuso IANA da origem) → UTC → `departureTime`.
- "Chegar até": horário local do **destino** → UTC.
  - Transit: `arrivalTime` nativo da API.
  - Carro (a API ignora `arrivalTime`): iteração de ponto fixo
    `saída₀ = prazo − duração(agora)`, `saídaₖ₊₁ = prazo − duração(saídaₖ)` até convergir
    (|Δ| < 60 s, máximo de 4 chamadas). O resultado exibido é **sempre** uma resposta real da
    API para a saída final (chegada = saída + `duration` daquela resposta). Se a saída
    necessária já passou, a opção é marcada como "não atende".
  - A pé: duração não depende do horário na API → `saída = prazo − duração`.
- Validação: "Sair às" no passado é recusado para carro/a pé (a API não aceita).

### 5.5 Metrô

- `TRANSIT` com `allowedTravelModes: ["SUBWAY","TRAIN","LIGHT_RAIL","RAIL"]` (sem `BUS`).
- Cada rota retornada é classificada pelos veículos realmente usados. Só é apresentada como
  "Metrô/trilhos" se **todos** os trechos de veículo forem ferroviários
  (`SUBWAY`, `METRO_RAIL`, `HEAVY_RAIL`, `COMMUTER_TRAIN`, `RAIL`, `HIGH_SPEED_TRAIN`,
  `LONG_DISTANCE_TRAIN`, `MONORAIL`, `TRAM`). Rotas que incluem ônibus são descartadas desse
  modo (com aviso), pois o usuário pediu metrô, não "transporte público".

### 5.6 Voos

- `FlightProvider` (interface) → `AeroApiFlightProvider` (implementação real). Sem chave,
  `UnconfiguredFlightProvider` informa que voos não estão disponíveis.
- Aeroportos candidatos: OurAirports (`large_airport`/`medium_airport`, `scheduled_service=yes`,
  com IATA) dentro de um raio configurável da origem/destino.
- Somente voos diretos publicados (AeroAPI). Viagem total =
  terra até aeroporto + **margem escolhida pelo usuário** + voo + margem pós-pouso escolhida pelo
  usuário + terra até destino. As margens são exibidas como "definidas por você" e **não** são
  apresentadas como tempo oficial.
- Linha aérea no mapa é geodésica e rotulada "Representação do trecho aéreo".
- Para economizar consultas pagas, a busca de voos não é feita abaixo de uma distância em linha
  reta configurável (`FLIGHT_MIN_DISTANCE_KM`) — exibido como regra de configuração, não como
  fato aeronáutico.

### 5.7 Semáforos

- `TrafficSignalProvider` (interface). Implementações:
  - `OsmTrafficSignalLocator` — localização (marcador **cinza**, "Semáforo identificado.
    Estado em tempo real indisponível nesta localização.").
  - `HamburgTldProvider` — fase real por conexão de faixa, apenas dentro da área coberta.
  - `DemoTrafficSignalProvider` — **desativado por padrão**, separado, rotulado
    "MODO DEMONSTRAÇÃO — dados simulados", nunca misturado aos dados reais.
- Associação ao sentido: uma conexão de faixa só é associada à rota quando a linha de retenção,
  um ponto a montante da faixa de entrada e um ponto a jusante da faixa de saída estão a poucos
  metros da polilinha **e** aparecem na ordem montante → retenção → jusante ao longo dela.
  Sem isso, nenhuma fase é exibida para o trajeto.
- Contagem regressiva somente quando o provedor fornece o horário da próxima troca
  (Hamburgo não fornece).
- Tempo real: o servidor assina o MQTT do provedor somente para os datastreams da rota e
  repassa ao navegador por **Server-Sent Events** (unidirecional, reconexão automática do
  `EventSource`); o cliente ressincroniza o estado completo periodicamente e corrige o
  deslocamento de relógio com o `serverTime` do servidor.

### 5.8 Recomendação

Regras determinísticas e explicáveis (sem IA): (1) atende ao prazo; (2) menor duração total;
(3) saída mais tarde (no modo "Chegar até"); (4) menos baldeações; (5) atraso por trânsito
(`duration − staticDuration`) só quando a API o forneceu; (6) apenas modos disponíveis.
Cada motivo exibido é derivado de um valor numérico presente na resposta.

---

## 6. Verificações realizadas durante a implementação (2026-10-01)

| Verificação | Resultado |
|---|---|
| Hamburg TLD — consulta espacial (`st_intersects` com `or` de `POLYGON`; `MULTIPOLYGON` **não** é aceito pelo servidor) | OK |
| Hamburg TLD — conexão de faixa real `151_20` usada como trajeto | Fase associada no sentido da faixa ("sentido sul → norte", 🔴 vermelho); no sentido oposto, **nenhuma** fase (`direction_unknown`) |
| Hamburg TLD — MQTT via WebSocket (`wss://tld.iot.hamburg.de:443/mqtt`) → SSE do servidor | Transições reais recebidas ao vivo (amarelo → vermelho) em segundos |
| Ordem do `MultiLineString` das conexões de faixa | [entrada (começa na retenção = FeatureOfInterest `_Stop`), percurso no cruzamento, saída], confirmada em várias conexões |
| OurAirports `airports.csv` | Baixado (12,7 MB); filtros de porte, voos regulares e IATA validados |
| Overpass API (instâncias públicas) | **Inacessível a partir do ambiente de desenvolvimento** (conexão encerrada pelo destino). A aplicação reporta "OpenStreetMap (Overpass) temporariamente indisponível"; a lógica foi validada com fixtures |
| Google Maps Platform / AeroAPI | Sem credenciais no ambiente: verificados o modo "não configurado", mapeamento de erros e respostas por fixtures no formato oficial. Nenhuma chamada real foi feita |
