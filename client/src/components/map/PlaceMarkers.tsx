import type { PlaceSummary } from '@nexus/shared';
import { AdvancedMarker, InfoWindow, useAdvancedMarkerRef } from '@vis.gl/react-google-maps';
import { useState } from 'react';

const SOURCE_LABEL: Record<PlaceSummary['source'], string> = {
  google_places: 'Google Places',
  device_geolocation: 'Localização do dispositivo',
  ourairports: 'OurAirports',
};

function PlaceMarker({ place, badge }: { place: PlaceSummary; badge: 'A' | 'B' }) {
  const [ref, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);
  const role = badge === 'A' ? 'Origem' : 'Destino';
  return (
    <>
      <AdvancedMarker
        ref={ref}
        position={place.location}
        title={`${role}: ${place.name}`}
        zIndex={50}
        onClick={() => setOpen((v) => !v)}
      >
        <div className={`pin pin--${badge}`}>
          <span>{badge}</span>
        </div>
      </AdvancedMarker>
      {open && (
        <InfoWindow
          anchor={marker}
          onCloseClick={() => setOpen(false)}
          headerContent={<strong>{`${badge} · ${role}`}</strong>}
        >
          <div className="info">
            <p className="info__name">{place.name}</p>
            {place.address && <p>{place.address}</p>}
            <p className="info__coords">
              {place.location.lat.toFixed(6)}, {place.location.lng.toFixed(6)}
            </p>
            {(place.primaryTypeLabel || place.types.length > 0) && (
              <p>Tipo: {place.primaryTypeLabel ?? place.types.slice(0, 3).join(', ')}</p>
            )}
            {place.timeZone && <p>Fuso: {place.timeZone}</p>}
            <p className="info__source">Fonte: {SOURCE_LABEL[place.source]}</p>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function PlaceMarkers({
  origin,
  destination,
}: {
  origin: PlaceSummary | null;
  destination: PlaceSummary | null;
}) {
  return (
    <>
      {origin && <PlaceMarker place={origin} badge="A" />}
      {destination && <PlaceMarker place={destination} badge="B" />}
    </>
  );
}
