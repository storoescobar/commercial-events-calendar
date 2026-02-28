/* eslint-disable @typescript-eslint/no-floating-promises */
"use client";

import { useEffect, useMemo, useState } from "react";

type EventCsvRow = {
  event_id: string;
  event_name: string;
  description: string;
  start_date: string;
  end_date: string;
  status: string;
  target_promos: number;
  target_stores: number;
};

type CampaignCsvRow = {
  campaign_id: string;
  event_id: string;
  store_id: string;
  created_at: string;
};

type StoredData = {
  events: EventCsvRow[];
  campaigns: CampaignCsvRow[];
  lastUpdated: string;
};

type EventWithMetrics = {
  id: string;
  name: string;
  description: string;
  status: string;
  startDate: Date;
  endDate: Date;
  targetPromos: number;
  targetStores: number;
  promosToDate: number;
  storesToDate: number;
  promosPct: number;
  storesPct: number;
  gapPromos: number;
  gapStores: number;
  daysToStart: number;
};

const STORAGE_KEY = "commercial_calendar_mx_v1";

const SAMPLE_EVENTS: EventCsvRow[] = [
  {
    event_id: "E001",
    event_name: "Viral deals",
    description: "Ofertas virales para empuje de volumen",
    start_date: "2026-03-03",
    end_date: "2026-03-09",
    status: "Planned",
    target_promos: 300,
    target_stores: 200,
  },
  {
    event_id: "E002",
    event_name: "Platazos",
    description: "Promos fuertes en platos completos (alto AOV)",
    start_date: "2026-03-07",
    end_date: "2026-03-13",
    status: "Planned",
    target_promos: 220,
    target_stores: 160,
  },
  {
    event_id: "E003",
    event_name: "100 off en 300",
    description: "Descuento fijo para impulsar conversión",
    start_date: "2026-03-15",
    end_date: "2026-03-21",
    status: "Planned",
    target_promos: 400,
    target_stores: 280,
  },
  {
    event_id: "E004",
    event_name: "Formula 1",
    description: "Especial fin de semana de carrera: snacks + comidas",
    start_date: "2026-03-20",
    end_date: "2026-03-23",
    status: "Planned",
    target_promos: 180,
    target_stores: 140,
  },
  {
    event_id: "E005",
    event_name: "Los mejores desayunos",
    description: "Breakfast push: mañanas + fines de semana",
    start_date: "2026-02-28",
    end_date: "2026-03-05",
    status: "Planned",
    target_promos: 250,
    target_stores: 190,
  },
];

const SAMPLE_CAMPAIGNS: CampaignCsvRow[] = [
  { campaign_id: "C0001", event_id: "E001", store_id: "ST1001", created_at: "2026-02-10" },
  { campaign_id: "C0002", event_id: "E001", store_id: "ST1001", created_at: "2026-02-12" },
  { campaign_id: "C0003", event_id: "E001", store_id: "ST1002", created_at: "2026-02-15" },
  { campaign_id: "C0004", event_id: "E001", store_id: "ST1003", created_at: "2026-02-18" },
  { campaign_id: "C0005", event_id: "E001", store_id: "ST1004", created_at: "2026-02-20" },
  { campaign_id: "C0006", event_id: "E002", store_id: "ST2001", created_at: "2026-02-11" },
  { campaign_id: "C0007", event_id: "E002", store_id: "ST2002", created_at: "2026-02-17" },
  { campaign_id: "C0008", event_id: "E002", store_id: "ST2002", created_at: "2026-02-19" },
  { campaign_id: "C0009", event_id: "E002", store_id: "ST2003", created_at: "2026-02-22" },
  { campaign_id: "C0010", event_id: "E003", store_id: "ST3001", created_at: "2026-02-05" },
  { campaign_id: "C0011", event_id: "E003", store_id: "ST3002", created_at: "2026-02-06" },
  { campaign_id: "C0012", event_id: "E003", store_id: "ST3002", created_at: "2026-02-07" },
  { campaign_id: "C0013", event_id: "E003", store_id: "ST3003", created_at: "2026-02-08" },
  { campaign_id: "C0014", event_id: "E004", store_id: "ST4001", created_at: "2026-02-25" },
  { campaign_id: "C0015", event_id: "E004", store_id: "ST4002", created_at: "2026-02-26" },
  { campaign_id: "C0016", event_id: "E004", store_id: "ST4002", created_at: "2026-03-01" },
  { campaign_id: "C0017", event_id: "E005", store_id: "ST5001", created_at: "2026-02-01" },
  { campaign_id: "C0018", event_id: "E005", store_id: "ST5002", created_at: "2026-02-14" },
  { campaign_id: "C0019", event_id: "E005", store_id: "ST5002", created_at: "2026-02-20" },
  { campaign_id: "C0020", event_id: "E005", store_id: "ST5003", created_at: "2026-03-02" },
];

type ViewMode = "calendar" | "table";

type SortKey =
  | "default"
  | "name"
  | "start"
  | "end"
  | "status"
  | "promos"
  | "promosPct"
  | "gapPromos"
  | "stores"
  | "storesPct"
  | "gapStores"
  | "daysToStart";

type SortDirection = "asc" | "desc";

function toStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha inválida: ${value}`);
  }
  return d;
}

function computeEventMetrics(
  events: EventCsvRow[],
  campaigns: CampaignCsvRow[],
  today: Date,
): EventWithMetrics[] {
  const todayStart = toStartOfDay(today);

  const campaignsByEvent = new Map<string, { createdAt: Date; storeId: string }[]>();

  for (const c of campaigns) {
    let createdAt: Date;
    try {
      createdAt = parseDate(c.created_at);
    } catch {
      // Si la fecha es inválida, ignoramos esta campaña.
      // eslint-disable-next-line no-continue
      continue;
    }
    const list = campaignsByEvent.get(c.event_id) ?? [];
    list.push({ createdAt, storeId: c.store_id });
    campaignsByEvent.set(c.event_id, list);
  }

  return events.map((e) => {
    const startDate = parseDate(e.start_date);
    const endDate = parseDate(e.end_date);

    const eventCampaigns = campaignsByEvent.get(e.event_id) ?? [];

    let promosToDate = 0;
    const storesSet = new Set<string>();

    for (const c of eventCampaigns) {
      if (c.createdAt <= todayStart) {
        promosToDate += 1;
        storesSet.add(c.storeId);
      }
    }

    const storesToDate = storesSet.size;

    const targetPromos = e.target_promos ?? 0;
    const targetStores = e.target_stores ?? 0;

    const promosPct = targetPromos > 0 ? (promosToDate / targetPromos) * 100 : 0;
    const storesPct = targetStores > 0 ? (storesToDate / targetStores) * 100 : 0;

    const gapPromos = Math.max(targetPromos - promosToDate, 0);
    const gapStores = Math.max(targetStores - storesToDate, 0);

    const daysToStart =
      (toStartOfDay(startDate).getTime() - todayStart.getTime()) /
      (1000 * 60 * 60 * 24);

    return {
      id: e.event_id,
      name: e.event_name,
      description: e.description,
      status: e.status,
      startDate,
      endDate,
      targetPromos,
      targetStores,
      promosToDate,
      storesToDate,
      promosPct,
      storesPct,
      gapPromos,
      gapStores,
      daysToStart,
    };
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (current !== "" || row.length > 0) {
        row.push(current.trim());
        rows.push(row);
      }
      current = "";
      row = [];
    } else {
      current += char;
    }
  }

  if (current !== "" || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.length > 0));
}

function parseEventsCsv(text: string): EventCsvRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("CSV de eventos vacío o sin encabezados.");
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => {
    const idx = header.indexOf(name.toLowerCase());
    if (idx === -1) {
      throw new Error(`Columna requerida faltante en events_mx.csv: ${name}`);
    }
    return idx;
  };

  const idxEventId = col("event_id");
  const idxName = col("event_name");
  const idxDesc = col("description");
  const idxStart = col("start_date");
  const idxEnd = col("end_date");
  const idxStatus = col("status");
  const idxTargetPromos = col("target_promos");
  const idxTargetStores = col("target_stores");

  const data: EventCsvRow[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length === 0) continue;
    data.push({
      event_id: row[idxEventId] ?? "",
      event_name: row[idxName] ?? "",
      description: row[idxDesc] ?? "",
      start_date: row[idxStart] ?? "",
      end_date: row[idxEnd] ?? "",
      status: row[idxStatus] ?? "",
      target_promos: Number(row[idxTargetPromos] ?? "0") || 0,
      target_stores: Number(row[idxTargetStores] ?? "0") || 0,
    });
  }

  return data;
}

function parseCampaignsCsv(text: string): CampaignCsvRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("CSV de campañas vacío o sin encabezados.");
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => {
    const idx = header.indexOf(name.toLowerCase());
    if (idx === -1) {
      throw new Error(
        `Columna requerida faltante en event_campaigns_mx.csv: ${name}`,
      );
    }
    return idx;
  };

  const idxCampaignId = col("campaign_id");
  const idxEventId = col("event_id");
  const idxStoreId = col("store_id");
  const idxCreatedAt = col("created_at");

  const data: CampaignCsvRow[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length === 0) continue;

    data.push({
      campaign_id: row[idxCampaignId] ?? "",
      event_id: row[idxEventId] ?? "",
      store_id: row[idxStoreId] ?? "",
      created_at: row[idxCreatedAt] ?? "",
    });
  }

  return data;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatPercent(value: number): string {
  return `${value.toFixed(0)}%`;
}

function getProgressColorClass(promosPct: number): string {
  if (promosPct >= 80) {
    return "bg-emerald-500/15 border border-emerald-400/30";
  }
  if (promosPct >= 50) {
    return "bg-amber-400/15 border border-amber-300/30";
  }
  if (promosPct >= 30) {
    return "bg-orange-400/15 border border-orange-300/30";
  }
  return "bg-red-500/15 border border-red-400/30";
}

function getProgressDotClass(promosPct: number): string {
  if (promosPct >= 80) {
    return "bg-emerald-400";
  }
  if (promosPct >= 50) {
    return "bg-amber-300";
  }
  if (promosPct >= 30) {
    return "bg-orange-300";
  }
  return "bg-red-400";
}

function formatLastUpdated(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toCsvValue(value: string | number): string {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const lines = rows.map((r) => r.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([lines], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function sameDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type EventTimelineCategory = "ongoing" | "future" | "finished";

function getEventTimeline(
  today: Date,
  event: EventWithMetrics,
): {
  category: EventTimelineCategory;
  isFinished: boolean;
  isOngoing: boolean;
  isFuture: boolean;
} {
  const todayStart = toStartOfDay(today);
  const start = toStartOfDay(event.startDate);
  const end = toStartOfDay(event.endDate);

  const isFinished = todayStart > end;
  const isOngoing = todayStart >= start && todayStart <= end;
  const isFuture = todayStart < start;

  let category: EventTimelineCategory;
  if (isOngoing) {
    category = "ongoing";
  } else if (isFuture) {
    category = "future";
  } else {
    category = "finished";
  }

  return { category, isFinished, isOngoing, isFuture };
}

function getDaysToStartLabel(today: Date, event: EventWithMetrics): string {
  const { isFinished, isOngoing } = getEventTimeline(today, event);

  if (isFinished) return "Finalizado";
  if (isOngoing) return "En curso";

  const d = Math.round(event.daysToStart);
  if (d === 0) return "Hoy";
  if (d === 1) return "Mañana";
  if (d > 1) return `En ${d} días`;

  return "Hoy";
}

type CalendarViewProps = {
  events: EventWithMetrics[];
  currentMonth: Date;
  onChangeMonth: (next: Date) => void;
  today: Date;
};

function CalendarView({
  events,
  currentMonth,
  onChangeMonth,
  today,
}: CalendarViewProps) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const monthEvents = useMemo(
    () =>
      events.filter(
        (e) => e.startDate <= monthEnd && e.endDate >= monthStart,
      ),
    [events, monthEnd, monthStart],
  );

  const days: Date[] = [];
  {
    const d = new Date(monthStart);
    while (d <= monthEnd) {
      days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
  }

  const firstWeekday = (monthStart.getDay() + 6) % 7; // 0 = lunes
  const todayKey = sameDayKey(today);

  const [openMoreForDay, setOpenMoreForDay] = useState<string | null>(null);

  const handlePrevMonth = () => {
    const prev = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    onChangeMonth(prev);
    setOpenMoreForDay(null);
  };

  const handleNextMonth = () => {
    const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    onChangeMonth(next);
    setOpenMoreForDay(null);
  };

  const monthLabel = currentMonth.toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });

  const weekdayLabels = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="rounded-full border border-slate-700 px-3 py-1 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Mes anterior
          </button>
          <button
            type="button"
            onClick={handleNextMonth}
            className="rounded-full border border-slate-700 px-3 py-1 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Mes siguiente
          </button>
        </div>
        <div className="text-sm text-slate-300">
          Mostrando eventos que cruzan el mes seleccionado.
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-xl">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-50">{monthLabel}</h3>
          <div className="flex flex-col items-end gap-1 text-xs text-slate-400/80">
            <span>Hoy: {formatDate(today)}</span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>≥80%</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                <span>≥50%</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-300" />
                <span>≥30%</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                <span>&lt;30%</span>
              </span>
            </span>
          </div>
        </header>

        <div className="grid grid-cols-7 gap-1 text-xs font-medium text-slate-400">
          {weekdayLabels.map((label) => (
            <div
              key={label}
              className="flex h-6 items-center justify-center rounded-md bg-slate-900/80"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="mt-1.5 grid grid-cols-7 gap-1 text-xs">
          {Array.from({ length: firstWeekday }).map((_, idx) => (
            <div key={`empty-${idx}`} className="h-24 rounded-lg bg-slate-950/40" />
          ))}

          {days.map((day) => {
            const dayKey = sameDayKey(day);
            const eventsForDay = monthEvents.filter(
              (e) => e.startDate <= day && e.endDate >= day,
            );
            const visible = eventsForDay.slice(0, 3);
            const hidden = eventsForDay.slice(3);

            const isToday = dayKey === todayKey;

            return (
              <div
                key={dayKey}
                className={`relative flex h-24 flex-col rounded-lg border border-slate-800/60 bg-slate-950/60 p-1.5 ${
                  isToday ? "ring-1 ring-emerald-400/25" : ""
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-200">
                    {day.getDate()}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                  {visible.map((e) => {
                    const { isOngoing } = getEventTimeline(today, e);
                    return (
                      <div
                        key={e.id}
                        className={`flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium text-slate-50 ${getProgressColorClass(
                          e.promosPct,
                        )} ${
                          isOngoing
                            ? "ring-1 ring-emerald-400/25 shadow-[0_0_6px_rgba(16,185,129,0.32)]"
                            : ""
                        }`}
                      >
                        <span
                          className={`mr-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${getProgressDotClass(
                            e.promosPct,
                          )}`}
                        />
                        <span className="flex-1 truncate">
                          {e.name}{" "}
                          <span className="font-normal text-slate-100/90">
                            {e.promosToDate}/{e.targetPromos} (
                            {formatPercent(e.promosPct)})
                          </span>
                        </span>
                      </div>
                    );
                  })}

                  {hidden.length > 0 && (
                    <div className="mt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMoreForDay(
                            openMoreForDay === dayKey ? null : dayKey,
                          )
                        }
                        className="w-full rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-100 hover:bg-slate-700"
                      >
                        +{hidden.length} más
                      </button>
                      {openMoreForDay === dayKey && (
                        <div className="mt-1 max-h-24 space-y-0.5 overflow-auto rounded-md border border-slate-700 bg-slate-900 p-1 text-[10px] shadow-lg">
                          {hidden.map((e) => {
                            const { isOngoing } = getEventTimeline(today, e);
                            return (
                              <div
                                key={e.id}
                                className={`flex items-center justify-between gap-1 rounded-sm px-1 py-0.5 text-[10px] text-slate-50 ${getProgressColorClass(
                                  e.promosPct,
                                )} ${
                                  isOngoing
                                    ? "ring-1 ring-emerald-400/25 shadow-[0_0_6px_rgba(16,185,129,0.32)]"
                                    : ""
                                }`}
                              >
                                <span
                                  className={`mr-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${getProgressDotClass(
                                    e.promosPct,
                                  )}`}
                                />
                                <div className="flex flex-1 flex-col">
                                  <span className="font-semibold text-slate-50">
                                    {e.name}
                                  </span>
                                  <span className="text-[9px] text-slate-100/90">
                                    {e.promosToDate}/{e.targetPromos} (
                                    {formatPercent(e.promosPct)})
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => setOpenMoreForDay(null)}
                            className="mt-0.5 w-full rounded-sm bg-slate-700/80 py-0.5 text-center text-[9px] font-medium text-slate-100 hover:bg-slate-600"
                          >
                            Cerrar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

type TableViewProps = {
  events: EventWithMetrics[];
  today: Date;
};

function TableView({ events, today }: TableViewProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const filtered = useMemo(
    () =>
      events.filter((e) =>
        e.name.toLowerCase().includes(search.toLowerCase().trim()),
      ),
    [events, search],
  );

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (sortKey === "default") {
        const ta = getEventTimeline(today, a);
        const tb = getEventTimeline(today, b);

        const rank: Record<EventTimelineCategory, number> = {
          ongoing: 0,
          future: 1,
          finished: 2,
        };

        if (rank[ta.category] !== rank[tb.category]) {
          return rank[ta.category] - rank[tb.category];
        }

        if (ta.category === "future") {
          if (a.daysToStart !== b.daysToStart) {
            return a.daysToStart - b.daysToStart;
          }
          if (a.promosPct !== b.promosPct) {
            return a.promosPct - b.promosPct;
          }
        }

        if (ta.category === "ongoing") {
          if (a.promosPct !== b.promosPct) {
            return a.promosPct - b.promosPct;
          }
        }

        if (a.endDate.getTime() !== b.endDate.getTime()) {
          return b.endDate.getTime() - a.endDate.getTime();
        }

        return a.name.localeCompare(b.name, "es");
      }

      const dir = sortDir === "asc" ? 1 : -1;

      const getValue = (e: EventWithMetrics): string | number => {
        switch (sortKey) {
          case "name":
            return e.name;
          case "start":
            return e.startDate.getTime();
          case "end":
            return e.endDate.getTime();
          case "status":
            return e.status;
          case "promos":
            return e.promosToDate;
          case "promosPct":
            return e.promosPct;
          case "gapPromos":
            return e.gapPromos;
          case "stores":
            return e.storesToDate;
          case "storesPct":
            return e.storesPct;
          case "gapStores":
            return e.gapStores;
          case "daysToStart":
            return e.daysToStart;
          default:
            return 0;
        }
      };

      const va = getValue(a);
      const vb = getValue(b);

      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb, "es") * dir;
      }

      const na = Number(va);
      const nb = Number(vb);
      if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
      if (na === nb) return 0;
      return na > nb ? dir : -dir;
    });
    return copy;
  }, [filtered, sortDir, sortKey, today]);

  const handleSortChange = (key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setSortDir("asc");
      return key;
    });
  };

  const handleExport = () => {
    const header = [
      "Event Name",
      "Description",
      "Start",
      "End",
      "Status",
      "Promos",
      "Promos %",
      "Gap Promos",
      "Stores",
      "Stores %",
      "Gap Stores",
      "Days to Start",
    ];

    const rows: (string | number)[][] = [header];

    for (const e of sorted) {
      rows.push([
        e.name,
        e.description,
        e.startDate.toISOString().slice(0, 10),
        e.endDate.toISOString().slice(0, 10),
        e.status,
        e.promosToDate,
        e.promosPct,
        e.gapPromos,
        e.storesToDate,
        e.storesPct,
        e.gapStores,
        e.daysToStart,
      ]);
    }

    downloadCsv("events_metrics.csv", rows);
  };

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return "·";
    return sortDir === "asc" ? "▲" : "▼";
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre de evento..."
            className="w-full rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-72"
          />
          <button
            type="button"
            onClick={handleExport}
            className="rounded-full border border-emerald-500 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20"
          >
            Exportar CSV
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {sorted.length} evento{sorted.length === 1 ? "" : "s"} encontrados.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 shadow-xl">
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-full text-left text-xs text-slate-100">
            <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
              <tr>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("name")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Event Name <span className="text-[9px]">{sortIndicator("name")}</span>
                  </button>
                </th>
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-300">
                  Description
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("start")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Start <span className="text-[9px]">{sortIndicator("start")}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("end")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    End <span className="text-[9px]">{sortIndicator("end")}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("status")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Status{" "}
                    <span className="text-[9px]">{sortIndicator("status")}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("promosPct")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Promos{" "}
                    <span className="text-[9px]">
                      {sortIndicator("promosPct")}
                    </span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("gapPromos")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Gap Promos{" "}
                    <span className="text-[9px]">
                      {sortIndicator("gapPromos")}
                    </span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("stores")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Stores{" "}
                    <span className="text-[9px]">{sortIndicator("stores")}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("storesPct")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Stores %{" "}
                    <span className="text-[9px]">
                      {sortIndicator("storesPct")}
                    </span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("gapStores")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Gap Stores{" "}
                    <span className="text-[9px]">
                      {sortIndicator("gapStores")}
                    </span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("daysToStart")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Days to Start{" "}
                    <span className="text-[9px]">
                      {sortIndicator("daysToStart")}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-[11px]">
              {sorted.map((e) => {
                const timeline = getEventTimeline(today, e);
                const daysLabel = getDaysToStartLabel(today, e);
                const coverage = e.promosPct / 100;
                const showRiskBadge =
                  !timeline.isFinished &&
                  (e.daysToStart <= 7 || timeline.isOngoing);

                let riskLevel: "none" | "risk" | "critical" = "none";
                if (showRiskBadge) {
                  if (coverage < 0.1) {
                    riskLevel = "Riesgo";
                  } else if (coverage < 0.3) {
                    riskLevel = "critical";
                  }
                }

                const isRisk = riskLevel === "Riesgo";
                const isCritical = riskLevel === "critical";

                const gapPromosColor =
                  e.gapPromos > 200
                    ? "text-red-400"
                    : e.gapPromos >= 100
                      ? "text-amber-300"
                      : "text-slate-100";

                return (
                  <tr
                    key={e.id}
                    className={`hover:bg-slate-900/80 ${
                      isCritical
                        ? "border-l-[3px] border-red-500/70 bg-red-500/5"
                        : ""
                    } ${
                      isRisk
                        ? "border-l-[3px] border-amber-500/70 bg-amber-500/5"
                        : ""
                    }`}
                  >
                    <td className="max-w-[220px] px-3 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-[12px] font-semibold text-slate-50">
                          {e.name}
                        </span>
                        {!timeline.isFinished && isCritical && (
                          <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium leading-none border border-red-500/15 bg-red-500/8 text-red-300">
                            ▲ Crítico
                          </span>
                        )}
                        {!timeline.isFinished && isRisk && !isCritical && (
                          <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium leading-none border border-amber-400/15 bg-amber-400/8 text-amber-200">
                            ▲ Riesgo
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-slate-400/80">
                      <span className="line-clamp-2">{e.description}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-200">
                      {formatDate(e.startDate)}
                    </td>
                    <td className="px-3 py-2 text-slate-200">
                      {formatDate(e.endDate)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-slate-800/60 px-2 py-0.5 text-[9px] font-medium text-slate-300">
                        {e.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] font-semibold text-emerald-200">
                      {e.promosToDate}/{e.targetPromos} ({formatPercent(e.promosPct)})
                    </td>
                    <td className={`px-3 py-2 ${gapPromosColor}`}>
                      {e.gapPromos.toLocaleString("es-MX")}
                    </td>
                    <td className="px-3 py-2 text-slate-400/80">
                      {e.storesToDate.toLocaleString("es-MX")}
                    </td>
                    <td className="px-3 py-2 text-slate-400/80">
                      {formatPercent(e.storesPct)}
                    </td>
                    <td className="px-3 py-2 text-slate-100">
                      {e.gapStores.toLocaleString("es-MX")}
                    </td>
                    <td className="px-3 py-2 text-slate-100">
                      {daysLabel}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="px-3 py-6 text-center text-slate-400"
                  >
                    No se encontraron eventos con el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [storedData, setStoredData] = useState<StoredData | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [today, setToday] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());

  const [eventsFile, setEventsFile] = useState<File | null>(null);
  const [campaignsFile, setCampaignsFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReplace, setShowReplace] = useState(false);

  useEffect(() => {
    setToday(new Date());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setInitialized(true);
        return;
      }
      const parsed = JSON.parse(raw) as StoredData;
      if (Array.isArray(parsed.events) && Array.isArray(parsed.campaigns)) {
        setStoredData(parsed);
      }
    } catch {
      // si hay error de parseo, ignoramos y seguimos sin data
    } finally {
      setInitialized(true);
    }
  }, []);

  const eventsWithMetrics: EventWithMetrics[] = useMemo(() => {
    if (!storedData || !today) return [];
    return computeEventMetrics(storedData.events, storedData.campaigns, today);
  }, [storedData, today]);

  const handleApplyData = (events: EventCsvRow[], campaigns: CampaignCsvRow[]) => {
    const payload: StoredData = {
      events,
      campaigns,
      lastUpdated: new Date().toISOString(),
    };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }
    setStoredData(payload);
    setError(null);
    setShowReplace(false);
  };

  const handleLoadSample = () => {
    handleApplyData(SAMPLE_EVENTS, SAMPLE_CAMPAIGNS);
  };

  const handleProcessCsvFiles = async () => {
    if (!eventsFile || !campaignsFile) return;
    setProcessing(true);
    setError(null);
    try {
      const [eventsText, campaignsText] = await Promise.all([
        eventsFile.text(),
        campaignsFile.text(),
      ]);
      const events = parseEventsCsv(eventsText);
      const campaigns = parseCampaignsCsv(campaignsText);
      handleApplyData(events, campaigns);
      setEventsFile(null);
      setCampaignsFile(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error inesperado al procesar CSV.";
      setError(message);
    } finally {
      setProcessing(false);
    }
  };

  const handleClear = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setStoredData(null);
    setShowReplace(false);
  };

  const hasData = storedData !== null && eventsWithMetrics.length > 0;

  const totalEvents = storedData?.events.length ?? 0;
  const totalCampaigns = storedData?.campaigns.length ?? 0;

  if (!initialized || !today) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-8 py-6 text-center shadow-xl">
          <p className="text-sm text-slate-300">
            Cargando calendario comercial...
          </p>
        </div>
      </main>
    );
  }

  const UploadArea = ({ compact }: { compact?: boolean }) => (
    <div
      className={`rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-4 ${
        compact ? "mt-3" : "mt-6"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-100">
            Cargar CSV de eventos y campañas
          </p>
          <p className="text-xs text-slate-400">
            Espera archivos `events_mx.csv` y `event_campaigns_mx.csv` con los
            campos requeridos.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-xs text-slate-200">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-300">
              events_mx.csv
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setEventsFile(e.target.files?.[0] ?? null);
              }}
              className="block w-full cursor-pointer rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] file:mr-3 file:rounded-full file:border-0 file:bg-emerald-500 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-slate-950 hover:border-emerald-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-300">
              event_campaigns_mx.csv
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setCampaignsFile(e.target.files?.[0] ?? null);
              }}
              className="block w-full cursor-pointer rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] file:mr-3 file:rounded-full file:border-0 file:bg-emerald-500 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-slate-950 hover:border-emerald-500"
            />
          </label>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>
            Ambos archivos son obligatorios para procesar datos nuevos.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleProcessCsvFiles}
            disabled={!eventsFile || !campaignsFile || processing}
            className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-emerald-800/60"
          >
            {processing ? "Procesando..." : "Procesar CSV"}
          </button>
          {!compact && (
            <button
              type="button"
              onClick={handleLoadSample}
              className="rounded-full border border-slate-600 bg-slate-900 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:border-emerald-500"
            >
              Load sample data
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-3 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-7 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-slate-50 sm:text-2xl">
              Commercial Events Calendar (MX)
            </h1>
            <p className="text-xs text-slate-400">
              MVP read-only para visualizar eventos comerciales en vista
              calendario y tabla, a partir de CSV de eventos y campañas.
            </p>
          </div>

          {hasData && (
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-900/80 p-1 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("calendar")}
                className={`rounded-full px-3 py-1 font-medium ${
                  viewMode === "calendar"
                    ? "bg-emerald-500 text-slate-950"
                    : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`rounded-full px-3 py-1 font-medium ${
                  viewMode === "table"
                    ? "bg-emerald-500 text-slate-950"
                    : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                Table
              </button>
            </div>
          )}
        </header>

        {!hasData && (
          <section className="mt-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 shadow-xl">
              <h2 className="text-base font-semibold text-slate-50">
                Carga inicial de datos
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                No se encontró información persistida en{" "}
                <span className="font-mono text-xs text-emerald-300">
                  localStorage
                </span>
                . Sube los CSV de eventos y campañas o usa los mocks de ejemplo
                para comenzar.
              </p>
              <UploadArea />
            </div>
          </section>
        )}

            {hasData && (
          <>
            <section className="space-y-2.5">
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Estado de datos
                  </p>
                  <p className="text-sm text-slate-100">
                    {totalEvents} evento{totalEvents === 1 ? "" : "s"} ·{" "}
                    {totalCampaigns} campaña
                    {totalCampaigns === 1 ? "" : "s"} en total.
                  </p>
                  <p className="text-xs text-slate-400">
                    Última actualización:{" "}
                    <span className="font-mono text-emerald-300">
                      {formatLastUpdated(storedData?.lastUpdated)}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReplace((prev) => !prev)}
                    className="rounded-full border border-slate-700 bg-slate-900 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:border-emerald-500"
                  >
                    {showReplace ? "Cancelar" : "Replace data"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="rounded-full border border-red-500/70 bg-red-500/10 px-4 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                  >
                    Clear data
                  </button>
                </div>
              </div>
              {showReplace && <UploadArea compact />}
            </section>

            {viewMode === "calendar" ? (
              <CalendarView
                events={eventsWithMetrics}
                currentMonth={currentMonth}
                onChangeMonth={setCurrentMonth}
                today={today}
              />
            ) : (
              <TableView events={eventsWithMetrics} today={today} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

