import { Link } from 'react-router-dom';
import { ArrowRight, CloudRain, History, Layers, Map, Mountain, ShieldAlert, Tent } from 'lucide-react';
import { RISK_PALETTES, SEVERITY_COLORS } from '../../components/mapStyle';

const layerGroups = [
  {
    title: 'Base and reference',
    description: 'District outlines provide geographic context. They do not represent hazard levels.',
    icon: Layers,
    tone: 'bg-slate-700',
    items: ['District boundaries'],
  },
  {
    title: 'Prototype risk',
    description: 'Flood and landslide fills are model estimates. Gray means unknown or no usable data, not low risk.',
    icon: Mountain,
    tone: 'bg-amber-600',
    items: ['Flood risk shading', 'Landslide risk shading', 'Terrain susceptibility'],
  },
  {
    title: 'Official and weather',
    description: 'Show received warning records and rainfall observations with their available timestamps and status.',
    icon: CloudRain,
    tone: 'bg-sky-600',
    items: ['Official IMD warnings', '24-hour rainfall stations'],
  },
  {
    title: 'Emergency and history',
    description: 'Shelters and incidents are marked separately from model estimates; historical events are reference only.',
    icon: Tent,
    tone: 'bg-teal-600',
    items: ['Verified shelters', 'Citizen incident reports', 'Validated hazard history'],
  },
];

const riskLevels = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const;

export default function LayersGuidePage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-teal-700">
            <Map className="h-4 w-4" /> Map reference
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Layers and legend</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            A quick guide to map overlays, symbols, and boundary coverage. Open the map to turn layers on or off.
          </p>
        </div>
        <Link to="/map" className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 sm:self-auto">
          Open map controls <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      <section aria-labelledby="layer-groups-title">
        <div className="mb-4 flex items-center gap-2">
          <Layers className="h-4 w-4 text-slate-500" />
          <h2 id="layer-groups-title" className="text-sm font-bold text-slate-900">Overlay groups</h2>
        </div>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {layerGroups.map(({ title, description, icon: Icon, tone, items }) => (
            <article key={title} className="border-t border-slate-200 pt-4">
              <div className="flex items-center gap-2">
                <span className={`flex h-7 w-7 items-center justify-center rounded-md text-white ${tone}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-bold text-slate-900">{title}</h3>
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-600">{description}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {items.map(item => <li key={item} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-8 border-t border-slate-200 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Risk colors</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['Flood risk fill', RISK_PALETTES.flood],
              ['Landslide risk fill', RISK_PALETTES.landslide],
            ] as const).map(([title, palette]) => (
              <div key={title}>
                <h3 className="mb-2 text-xs font-semibold text-slate-700">{title}</h3>
                <ul className="space-y-1.5 text-xs text-slate-600">
                  {riskLevels.map(level => (
                    <li key={level} className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm border border-black/10" style={{ backgroundColor: palette[level] }} />
                      {level[0] + level.slice(1).toLowerCase()}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
            <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-black/10" style={{ backgroundColor: SEVERITY_COLORS.UNKNOWN }} />
            Unknown or no data — gray, not a low-risk assessment
          </div>
          <div className="mt-4 space-y-2 text-xs leading-5 text-slate-500">
            <p><span className="font-semibold text-slate-700">Rain gauges:</span> blue marks observations; amber marks demo or unverified records.</p>
            <p><span className="font-semibold text-slate-700">Warnings:</span> dark outlines indicate received official warning records.</p>
            <p><span className="font-semibold text-slate-700">Incidents:</span> verified and unverified citizen reports use different markers.</p>
            <p><span className="font-semibold text-slate-700">History:</span> flood markers are blue; landslide markers are purple.</p>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-5 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">Boundary data and known aliases</h2>
          </div>
          <p className="text-sm leading-6 text-slate-600">
            Public geohacker/india boundaries in EPSG:4326 cover 78 Northeast districts. The dataset is a geographic reference and may not reflect later district reorganizations.
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Kamrup Metropolitan</dt><dd className="mt-0.5 text-slate-700">maps to legacy “Kamrup”</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Imphal East</dt><dd className="mt-0.5 text-slate-700">maps to “East Imphal”</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Imphal West</dt><dd className="mt-0.5 text-slate-700">maps to “West Imphal”</dd></div>
          </dl>
          <p className="mt-4 border-l-2 border-slate-300 pl-3 text-xs leading-5 text-slate-600">
            Unmatched districts remain UNKNOWN and unshaded. Risk estimates are prototypes, and the map does not issue certified warnings.
          </p>
        </div>
      </section>
    </div>
  );
}
