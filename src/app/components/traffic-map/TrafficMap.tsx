import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { geoAlbersUsa, geoEqualEarth, geoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import worldAtlas from "./data/countries-110m.json";
import usAtlas from "./data/states-10m.json";
import { greatCirclePoints, interpolateGreatCircle } from "@/domain/geo-arc";
import { countryByIsoNumeric, regionByFips } from "@/domain/geo-gazetteer";
import type { TrafficDestination, TrafficFlight, TrafficGrain, TrafficSnapshot } from "@/domain/traffic";

type Props = {
  snapshot: TrafficSnapshot;
  grain: TrafficGrain;
  frame: "us" | "world";
  selectedFlightId: string | null;
  onSelectFlight: (id: string | null) => void;
  onSelectDestination: (row: TrafficDestination) => void;
};

const worldTopology = worldAtlas as unknown as Topology;
const usTopology = usAtlas as unknown as Topology;

const countries = feature(worldTopology, worldTopology.objects.countries) as FeatureCollection<Geometry, { name?: string }>;
const states = feature(usTopology, usTopology.objects.states) as FeatureCollection<Geometry, { name?: string }>;

export function TrafficMap({ snapshot, grain, frame, selectedFlightId, onSelectFlight, onSelectDestination }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width < 80 || height < 80) return;
      setSize((prev) => (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => {
    const proj: GeoProjection = frame === "us" ? geoAlbersUsa() : geoEqualEarth();
    return proj.fitExtent(
      [
        [28, 36],
        [size.width - 28, size.height - 36],
      ],
      frame === "us" ? states : countries,
    );
  }, [frame, size.height, size.width]);

  const path = useMemo(() => geoPath(projection), [projection]);
  const maxUnits = Math.max(1, ...snapshot.destinations.map((row) => row.units));
  const destByCountry = indexBy(snapshot.destinations, (row) => row.country);
  const destByRegion = indexBy(snapshot.destinations, (row) => `${row.country}-${row.region ?? ""}`);

  return (
    <div ref={wrapRef} data-testid="traffic-map" className="relative h-full min-h-[28rem] w-full overflow-hidden bg-[#061018]">
      <div className="traffic-radar pointer-events-none absolute inset-0 opacity-30" />
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="traffic-map-svg absolute inset-0 size-full"
        role="img"
        aria-label="Shipment traffic map"
        onClick={() => onSelectFlight(null)}
      >
        <defs>
          <filter id="blip-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {countries.features.map((feat) => {
          const iso = countryByIsoNumeric(String(feat.id ?? ""));
          const dest = iso && grain === "country" ? destByCountry.get(iso.code) : undefined;
          const d = path(feat);
          if (!d) return null;
          return (
            <path
              key={`c-${feat.id}`}
              d={d}
              onClick={(event) => {
                event.stopPropagation();
                if (dest) onSelectDestination(dest);
              }}
              className="stroke-cyan-400/25"
              fill={dest ? heatFill(dest.units, maxUnits) : "rgba(8, 28, 40, 0.85)"}
              strokeWidth={1}
            />
          );
        })}
        {(grain === "region" || grain === "city" || frame === "us") &&
          states.features.map((feat) => {
            const region = regionByFips(String(feat.id ?? ""));
            const dest = region ? destByRegion.get(`${region.country}-${region.code}`) : undefined;
            const d = path(feat);
            if (!d) return null;
            const fill =
              grain === "region" && dest ? heatFill(dest.units, maxUnits) : frame === "us" ? "rgba(8, 28, 40, 0.2)" : "none";
            return (
              <path
                key={`s-${feat.id}`}
                d={d}
                onClick={(event) => {
                  event.stopPropagation();
                  if (dest) onSelectDestination(dest);
                }}
                className="stroke-cyan-300/40"
                fill={fill}
                strokeWidth={0.8}
              />
            );
          })}
        {snapshot.origins.map((origin) => {
          if (origin.lat == null || origin.lng == null) return null;
          const p = projection([origin.lng, origin.lat]);
          if (!p) return null;
          return (
            <g key={origin.warehouseId} transform={`translate(${p[0]}, ${p[1]})`}>
              {[28, 56, 88].map((r) => (
                <circle key={r} r={r} fill="none" className="stroke-sky-400/20" strokeDasharray="3 5" />
              ))}
              <circle r={5} className="fill-sky-300 stroke-sky-100" strokeWidth={1.5} />
              <text y={-10} textAnchor="middle" className="fill-sky-100 font-mono text-[10px] uppercase tracking-widest">
                {origin.name}
              </text>
            </g>
          );
        })}
        {grain === "city" &&
          snapshot.destinations.map((row) => {
            const p = projection([row.lng, row.lat]);
            if (!p) return null;
            const r = 4 + (row.units / maxUnits) * 10;
            return (
              <g
                key={row.key}
                transform={`translate(${p[0]}, ${p[1]})`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectDestination(row);
                }}
                className="cursor-pointer"
              >
                <circle r={r} className="fill-cyan-300/70 stroke-cyan-100/80" />
                <text y={r + 11} textAnchor="middle" className="fill-cyan-50/80 font-mono text-[9px]">
                  {row.city}
                </text>
              </g>
            );
          })}
        <FlightsOverlay
          flights={snapshot.flights}
          projection={projection}
          selectedFlightId={selectedFlightId}
          hoverId={hoverId}
          onHover={setHoverId}
          onSelect={onSelectFlight}
        />
      </svg>
      <p className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">
        Positions are lane estimates from ship time, not live GPS
      </p>
    </div>
  );
}

const FlightsOverlay = memo(function FlightsOverlay({
  flights,
  projection,
  selectedFlightId,
  hoverId,
  onHover,
  onSelect,
}: {
  flights: TrafficFlight[];
  projection: GeoProjection;
  selectedFlightId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (ts - last >= 80) {
        last = ts;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <g>
      {flights.map((flight) => (
        <FlightLayer
          key={flight.orderId}
          flight={flight}
          now={now}
          projection={projection}
          selected={selectedFlightId === flight.orderId}
          hovered={hoverId === flight.orderId}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </g>
  );
});

function FlightLayer({
  flight,
  now,
  projection,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  flight: TrafficFlight;
  now: number;
  projection: GeoProjection;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const progress = liveProgress(flight, now);
  const pos = interpolateGreatCircle(flight.origin, flight.dest, flight.status === "at_gate" ? 0 : progress);
  const points = greatCirclePoints(flight.origin, flight.dest, 28)
    .map((pt) => projection([pt.lng, pt.lat]))
    .filter((pt): pt is [number, number] => Boolean(pt));
  const blip = projection([pos.lng, pos.lat]);
  if (!blip || points.length < 2) return null;
  const d = points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");
  const active = selected || hovered;
  const color = flight.status === "at_gate" ? "#fbbf24" : "#86efac";
  const label = flight.trackingNumber || flight.number;
  return (
    <g
      className="cursor-pointer"
      onMouseEnter={() => onHover(flight.orderId)}
      onMouseLeave={() => onHover(null)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(flight.orderId);
      }}
    >
      <path d={d} fill="none" stroke={color} strokeOpacity={active ? 0.9 : 0.35} strokeWidth={active ? 2 : 1} />
      {flight.status === "at_gate" ? (
        <circle cx={blip[0]} cy={blip[1]} r={10} className="traffic-gate-ring fill-amber-300/40" />
      ) : null}
      <circle cx={blip[0]} cy={blip[1]} r={14} fill="transparent" />
      <circle cx={blip[0]} cy={blip[1]} r={active ? 5.5 : 3.5} fill={color} filter="url(#blip-glow)" />
      {active ? (
        <text x={blip[0] + 8} y={blip[1] - 8} className="fill-emerald-50 font-mono text-[10px] tracking-wide">
          {label}
        </text>
      ) : null}
    </g>
  );
}

function liveProgress(flight: TrafficFlight, now: number): number {
  if (flight.status === "at_gate") return 0;
  if (flight.departedAt == null || flight.etaAt == null) return flight.progress;
  if (flight.etaAt <= flight.departedAt) return 1;
  return Math.min(1, Math.max(0, (now - flight.departedAt) / (flight.etaAt - flight.departedAt)));
}

function heatFill(units: number, max: number): string {
  const t = max ? units / max : 0;
  return `rgba(34, 211, 238, ${0.12 + t * 0.55})`;
}

function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(key(row), row);
  return map;
}

export function destinationLabel(row: TrafficDestination): string {
  if (row.grain === "city") return [row.city, row.region, row.country].filter(Boolean).join(", ");
  if (row.grain === "region") return [row.region, row.country].filter(Boolean).join(", ");
  return row.country;
}

export function frameForSnapshot(snapshot: TrafficSnapshot): "us" | "world" {
  const countries = new Set<string>();
  for (const origin of snapshot.origins) if (origin.country) countries.add(origin.country);
  for (const dest of snapshot.destinations) countries.add(dest.country);
  for (const flight of snapshot.flights) countries.add(flight.dest.country);
  const onlyUs = [...countries].every((code) => code === "US");
  return onlyUs ? "us" : "world";
}

export function flightStatusLabel(status: TrafficFlight["status"]): string {
  if (status === "at_gate") return "At gate";
  if (status === "in_flight") return "In flight";
  if (status === "arrived_estimate") return "Arrived (estimate)";
  if (status === "arrived") return "Arrived";
  if (status === "exception") return "Exception";
  return "Unmapped";
}
