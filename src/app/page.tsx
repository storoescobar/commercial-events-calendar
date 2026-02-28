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

type StoreCsvRow = {
  store_id: string;
  brand: string;
  region: string;
  city: string;
  commercial: string;
  segment: string;
  ops_zone: string;
  gmv_last_30d: number;
  gmv_last_7d?: number;
};

type EventTargetRow = {
  event_id: string;
  store_id: string;
};

type FiltersState = {
  regions: string[];
  cities: string[];
  commercials: string[];
  segments: string[];
  opsZones: string[];
  brands: string[];
};

type StoredData = {
  events: EventCsvRow[];
  campaigns: CampaignCsvRow[];
  stores?: StoreCsvRow[];
  event_targets?: EventTargetRow[];
  filters?: FiltersState;
  lastUpdated: string;
  version?: "v1" | "v2" | "v3";
};

type ValidationResult = {
  hardErrors: string[];
  warnings: string[];
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
  fillRate: number;
  openEvent: boolean;
  gapPromos: number;
  gapStores: number;
  daysToStart: number;
  gmvTarget: number;
  gmvCovered: number;
  gmvCoverage: number;
  gmvGap: number;
};

const STORAGE_KEY_V1 = "commercial_calendar_mx_v1";
const STORAGE_KEY_V2 = "commercial_calendar_mx_v2";
const SNAPSHOTS_STORAGE_KEY = "commercial_calendar_snapshots_v1";

const THIRTY_MINS_MS = 30 * 60 * 1000;
const RETENTION_DAYS = 30;
const RETENTION_MAX_ROWS = 2000;
const TOLERANCE_48H_MS = 24 * 60 * 60 * 1000; // 24h → window 36h–72h around 48h
const TOLERANCE_7D_MS = 2 * 24 * 60 * 60 * 1000; // 2d → window 5d–9d around 7d

type EventSnapshotRow = {
  event_id: string;
  snapshot_at: string;
  target_stores: number;
  stores_with_promo: number;
  fill_rate: number;
  target_promos: number;
  promos_to_date: number;
  gmv_target: number;
  gmv_covered: number;
  gmv_coverage: number;
};

function loadSnapshots(): EventSnapshotRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SNAPSHOTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EventSnapshotRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEventSnapshots(
  currentEventMetrics: {
    id: string;
    targetStores: number;
    storesToDate: number;
    fillRate: number;
    targetPromos: number;
    promosToDate: number;
    gmvTarget: number;
    gmvCovered: number;
    gmvCoverage: number;
  }[],
): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const snapshotAt = new Date().toISOString();
  const existing = loadSnapshots();

  const newRows: EventSnapshotRow[] = currentEventMetrics.map((m) => ({
    event_id: m.id,
    snapshot_at: snapshotAt,
    target_stores: m.targetStores,
    stores_with_promo: m.storesToDate,
    fill_rate: m.fillRate,
    target_promos: m.targetPromos,
    promos_to_date: m.promosToDate,
    gmv_target: m.gmvTarget,
    gmv_covered: m.gmvCovered,
    gmv_coverage: m.gmvCoverage,
  }));

  const cutoff30min = now - THIRTY_MINS_MS;
  const existingFiltered: EventSnapshotRow[] = [];
  const eventIdsToDedupe = new Set(newRows.map((r) => r.event_id));
  for (const row of existing) {
    const t = new Date(row.snapshot_at).getTime();
    const isRecentForEvent = eventIdsToDedupe.has(row.event_id) && t >= cutoff30min;
    if (isRecentForEvent) continue;
    existingFiltered.push(row);
  }
  const merged = [...existingFiltered, ...newRows];

  const retentionCutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const withinRetention = merged.filter((r) => new Date(r.snapshot_at).getTime() >= retentionCutoff);
  const sorted = withinRetention.sort(
    (a, b) => new Date(b.snapshot_at).getTime() - new Date(a.snapshot_at).getTime(),
  );
  const kept = sorted.slice(0, RETENTION_MAX_ROWS);

  try {
    window.localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // ignore quota or other errors
  }
}

function findClosestSnapshot(
  eventId: string,
  targetTime: Date,
  toleranceMs?: number,
): EventSnapshotRow | null {
  const snapshots = loadSnapshots().filter((r) => r.event_id === eventId);
  if (snapshots.length === 0) return null;
  const targetTs = targetTime.getTime();
  let filtered = snapshots;
  if (toleranceMs != null) {
    filtered = snapshots.filter((r) => {
      const t = new Date(r.snapshot_at).getTime();
      return Math.abs(t - targetTs) <= toleranceMs;
    });
    if (filtered.length === 0) return null;
  }
  let best = filtered[0];
  let bestDiff = Math.abs(new Date(best.snapshot_at).getTime() - targetTs);
  for (let i = 1; i < filtered.length; i++) {
    const r = filtered[i];
    const diff = Math.abs(new Date(r.snapshot_at).getTime() - targetTs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

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

const SAMPLE_STORES: StoreCsvRow[] = [
  { store_id: "ST1001", brand: "Alpha", region: "Centro", city: "CDMX", commercial: "Ana", segment: "Local Hero", ops_zone: "Zona Norte", gmv_last_30d: 120000 },
  { store_id: "ST1002", brand: "Alpha", region: "Centro", city: "CDMX", commercial: "Ana", segment: "Local Hero", ops_zone: "Zona Sur", gmv_last_30d: 95000 },
  { store_id: "ST1003", brand: "Beta", region: "Centro", city: "CDMX", commercial: "Luis", segment: "Local Chain", ops_zone: "Zona Centro", gmv_last_30d: 180000 },
  { store_id: "ST1004", brand: "Beta", region: "Centro", city: "CDMX", commercial: "Luis", segment: "Corpo", ops_zone: "Zona Norte", gmv_last_30d: 210000 },
  { store_id: "ST1005", brand: "Gamma", region: "Centro", city: "CDMX", commercial: "Sofia", segment: "Local SMB", ops_zone: "Zona Oriente", gmv_last_30d: 72000 },
  { store_id: "ST2001", brand: "Delta", region: "Occidente", city: "Guadalajara", commercial: "Carlos", segment: "Local Hero", ops_zone: "Zona Centro", gmv_last_30d: 150000 },
  { store_id: "ST2002", brand: "Delta", region: "Occidente", city: "Guadalajara", commercial: "Carlos", segment: "Local Chain", ops_zone: "Zona Norte", gmv_last_30d: 110000 },
  { store_id: "ST2003", brand: "Epsilon", region: "Occidente", city: "Guadalajara", commercial: "Mariana", segment: "Local SMB", ops_zone: "Zona Sur", gmv_last_30d: 88000 },
  { store_id: "ST2004", brand: "Epsilon", region: "Occidente", city: "Guadalajara", commercial: "Mariana", segment: "Corpo", ops_zone: "Zona Centro", gmv_last_30d: 195000 },
  { store_id: "ST3001", brand: "Zeta", region: "Norte", city: "Monterrey", commercial: "Diego", segment: "Local Hero", ops_zone: "Zona Norte", gmv_last_30d: 135000 },
  { store_id: "ST3002", brand: "Zeta", region: "Norte", city: "Monterrey", commercial: "Diego", segment: "Local Chain", ops_zone: "Zona Sur", gmv_last_30d: 102000 },
  { store_id: "ST3003", brand: "Eta", region: "Norte", city: "Monterrey", commercial: "Fernanda", segment: "Local SMB", ops_zone: "Zona Centro", gmv_last_30d: 78000 },
  { store_id: "ST3004", brand: "Eta", region: "Norte", city: "Monterrey", commercial: "Fernanda", segment: "Corpo", ops_zone: "Zona Norte", gmv_last_30d: 165000 },
  { store_id: "ST4001", brand: "Theta", region: "Centro", city: "Puebla", commercial: "Andrea", segment: "Local Hero", ops_zone: "Zona Centro", gmv_last_30d: 92000 },
  { store_id: "ST4002", brand: "Theta", region: "Centro", city: "Puebla", commercial: "Andrea", segment: "Local Chain", ops_zone: "Zona Sur", gmv_last_30d: 118000 },
  { store_id: "ST5001", brand: "Gamma", region: "Centro", city: "CDMX", commercial: "Sofia", segment: "Local SMB", ops_zone: "Zona Norte", gmv_last_30d: 68000 },
  { store_id: "ST5002", brand: "Gamma", region: "Centro", city: "CDMX", commercial: "Sofia", segment: "Local SMB", ops_zone: "Zona Sur", gmv_last_30d: 74000 },
  { store_id: "ST5003", brand: "Beta", region: "Centro", city: "CDMX", commercial: "Luis", segment: "Corpo", ops_zone: "Zona Centro", gmv_last_30d: 205000 },
];

const SAMPLE_EVENT_TARGETS: EventTargetRow[] = [
  { event_id: "E001", store_id: "ST1001" },
  { event_id: "E001", store_id: "ST1002" },
  { event_id: "E001", store_id: "ST1003" },
  { event_id: "E001", store_id: "ST1004" },
  { event_id: "E002", store_id: "ST2001" },
  { event_id: "E002", store_id: "ST2002" },
  { event_id: "E002", store_id: "ST2003" },
  { event_id: "E003", store_id: "ST3001" },
  { event_id: "E003", store_id: "ST3002" },
  { event_id: "E003", store_id: "ST3003" },
  { event_id: "E004", store_id: "ST4001" },
  { event_id: "E004", store_id: "ST4002" },
  { event_id: "E005", store_id: "ST5001" },
  { event_id: "E005", store_id: "ST5002" },
  { event_id: "E005", store_id: "ST5003" },
];

type ViewMode = "calendar" | "table";

type RiskLevel = "none" | "risk" | "critical";

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
  options?: {
    storesById?: Map<string, StoreCsvRow>;
    allowedStoreIds?: Set<string> | null;
    eventTargets?: EventTargetRow[];
  },
): EventWithMetrics[] {
  const todayStart = toStartOfDay(today);
  const eventsSet = new Set(events.map((e) => e.event_id));
  const storesById = options?.storesById;
  const allowedStoreIds = options?.allowedStoreIds;
  const eventTargets = options?.eventTargets ?? [];

  const targetsByEvent = new Map<string, Set<string>>();
  for (const t of eventTargets) {
    if (!eventsSet.has(t.event_id)) continue;
    if (storesById && !storesById.has(t.store_id)) continue;
    if (allowedStoreIds && !allowedStoreIds.has(t.store_id)) continue;
    let set = targetsByEvent.get(t.event_id);
    if (!set) {
      set = new Set();
      targetsByEvent.set(t.event_id, set);
    }
    set.add(t.store_id);
  }

  const campaignsByEvent = new Map<string, { createdAt: Date; storeId: string }[]>();
  for (const c of campaigns) {
    if (!eventsSet.has(c.event_id)) continue;
    if (storesById && !storesById.has(c.store_id)) continue;
    if (allowedStoreIds && !allowedStoreIds.has(c.store_id)) continue;
    let createdAt: Date;
    try {
      createdAt = parseDate(c.created_at);
    } catch {
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
    const eventTargetStoreIds = targetsByEvent.get(e.event_id);
    const hasTargets = eventTargetStoreIds && eventTargetStoreIds.size > 0;

    let promosToDate = 0;
    const storesSet = new Set<string>();
    for (const c of eventCampaigns) {
      if (c.createdAt > todayStart) continue;
      if (hasTargets && !eventTargetStoreIds!.has(c.storeId)) continue;
      promosToDate += 1;
      storesSet.add(c.storeId);
    }
    const storesToDate = storesSet.size;

    const targetPromos = e.target_promos ?? 0;
    const targetStores = hasTargets
      ? (eventTargetStoreIds?.size ?? 0)
      : (e.target_stores ?? 0);
    const promosPct = targetPromos > 0 ? (promosToDate / targetPromos) * 100 : 0;
    const storesPct = targetStores > 0 ? (storesToDate / targetStores) * 100 : 0;
    const fillRate = targetStores > 0 ? (storesToDate / targetStores) * 100 : 0;
    const openEvent = !hasTargets;

    const gapPromos = Math.max(targetPromos - promosToDate, 0);
    const gapStores = Math.max(targetStores - storesToDate, 0);
    const daysToStart =
      (toStartOfDay(startDate).getTime() - todayStart.getTime()) /
      (1000 * 60 * 60 * 24);

    let gmvTarget = 0;
    let gmvCovered = 0;
    if (hasTargets && eventTargetStoreIds && storesById) {
      for (const sid of eventTargetStoreIds) {
        const store = storesById.get(sid);
        if (!store) continue;
        const gmv = store.gmv_last_30d ?? 0;
        gmvTarget += gmv;
        if (storesSet.has(sid)) gmvCovered += gmv;
      }
    }
    const gmvCoverage = gmvTarget > 0 ? (gmvCovered / gmvTarget) * 100 : 0;
    const gmvGap = Math.max(gmvTarget - gmvCovered, 0);

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
      fillRate,
      openEvent,
      gapPromos,
      gapStores,
      daysToStart,
      gmvTarget,
      gmvCovered,
      gmvCoverage,
      gmvGap,
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

function parseStoresCsv(text: string): StoreCsvRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("CSV de tiendas vacío o sin encabezados.");
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => {
    const idx = header.indexOf(name.toLowerCase());
    if (idx === -1) {
      throw new Error(`Columna requerida faltante en stores_mx.csv: ${name}`);
    }
    return idx;
  };

  const idxStoreId = col("store_id");
  const idxBrand = col("brand");
  const idxRegion = col("region");
  const idxCity = col("city");
  const idxCommercial = col("commercial");
  const idxSegment = col("segment");
  const idxOpsZone = col("ops_zone");
  const idxGmv30 = col("gmv_last_30d");
  const idxGmv7 = header.indexOf("gmv_last_7d".toLowerCase());

  const data: StoreCsvRow[] = [];
  const seenStoreIds = new Set<string>();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length === 0) continue;

    const storeId = (row[idxStoreId] ?? "").trim();
    if (!storeId) {
      throw new Error("Se encontró una fila en stores_mx.csv sin store_id.");
    }
    if (seenStoreIds.has(storeId)) {
      throw new Error(
        `store_id duplicado en stores_mx.csv: ${storeId}. Debe ser único.`,
      );
    }
    seenStoreIds.add(storeId);

    const brand = (row[idxBrand] ?? "").trim();
    if (!brand) {
      throw new Error(
        `store_id ${storeId} en stores_mx.csv: brand es obligatorio y no puede estar vacío.`,
      );
    }

    const gmv30Raw = (row[idxGmv30] ?? "").trim();
    if (gmv30Raw === "") {
      throw new Error(
        `store_id ${storeId} en stores_mx.csv: gmv_last_30d es obligatorio.`,
      );
    }
    const gmv_last_30d = Number(gmv30Raw);
    if (Number.isNaN(gmv_last_30d)) {
      throw new Error(
        `store_id ${storeId} en stores_mx.csv: gmv_last_30d debe ser numérico.`,
      );
    }
    if (gmv_last_30d < 0) {
      throw new Error(
        `store_id ${storeId} en stores_mx.csv: gmv_last_30d no puede ser negativo.`,
      );
    }

    let gmv_last_7d: number | undefined;
    if (idxGmv7 >= 0 && (row[idxGmv7] ?? "").trim() !== "") {
      const raw7 = (row[idxGmv7] ?? "").trim();
      const v = Number(raw7);
      if (Number.isNaN(v) || v < 0) {
        throw new Error(
          `store_id ${storeId} en stores_mx.csv: gmv_last_7d debe ser numérico y no negativo.`,
        );
      }
      gmv_last_7d = v;
    }

    data.push({
      store_id: storeId,
      brand,
      region: row[idxRegion] ?? "",
      city: row[idxCity] ?? "",
      commercial: row[idxCommercial] ?? "",
      segment: row[idxSegment] ?? "",
      ops_zone: row[idxOpsZone] ?? "",
      gmv_last_30d,
      ...(gmv_last_7d !== undefined && { gmv_last_7d }),
    });
  }

  return data;
}

function parseEventTargetsCsv(text: string): EventTargetRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("CSV de event_targets vacío o sin encabezados.");
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => {
    const idx = header.indexOf(name.toLowerCase());
    if (idx === -1) {
      throw new Error(
        `Columna requerida faltante en event_targets_mx.csv: ${name}`,
      );
    }
    return idx;
  };
  const idxEventId = col("event_id");
  const idxStoreId = col("store_id");
  const data: EventTargetRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length === 0) continue;
    data.push({
      event_id: (row[idxEventId] ?? "").trim(),
      store_id: (row[idxStoreId] ?? "").trim(),
    });
  }
  return data;
}

function validateData(
  events: EventCsvRow[],
  campaigns: CampaignCsvRow[],
  stores: StoreCsvRow[],
  eventTargets: EventTargetRow[],
): ValidationResult {
  const hardErrors: string[] = [];
  const warnings: string[] = [];

  const eventIds = new Set(events.map((e) => e.event_id));
  const storeIds = new Set(stores.map((s) => s.store_id));

  const seenEventId = new Set<string>();
  for (const e of events) {
    if (seenEventId.has(e.event_id)) {
      hardErrors.push(`event_id duplicado en events: ${e.event_id}`);
    } else {
      seenEventId.add(e.event_id);
    }
    try {
      const start = parseDate(e.start_date);
      const end = parseDate(e.end_date);
      if (start > end) {
        hardErrors.push(
          `Evento ${e.event_id}: start_date posterior a end_date.`,
        );
      }
    } catch {
      hardErrors.push(
        `Evento ${e.event_id}: fechas inválidas (${e.start_date} / ${e.end_date}).`,
      );
    }
  }

  const seenCampaignId = new Set<string>();
  for (const c of campaigns) {
    if (seenCampaignId.has(c.campaign_id)) {
      hardErrors.push(`campaign_id duplicado: ${c.campaign_id}`);
    } else {
      seenCampaignId.add(c.campaign_id);
    }
    if (!eventIds.has(c.event_id)) {
      hardErrors.push(
        `Campaña ${c.campaign_id}: event_id no existe en events: ${c.event_id}`,
      );
    }
    if (!storeIds.has(c.store_id)) {
      hardErrors.push(
        `Campaña ${c.campaign_id}: store_id no existe en stores: ${c.store_id}`,
      );
    }
  }

  const targetsKey = (eid: string, sid: string) => `${eid}\t${sid}`;
  const seenTargets = new Set<string>();
  for (const t of eventTargets) {
    const key = targetsKey(t.event_id, t.store_id);
    if (seenTargets.has(key)) {
      hardErrors.push(
        `event_targets duplicado: event_id=${t.event_id}, store_id=${t.store_id}`,
      );
    } else {
      seenTargets.add(key);
    }
    if (!eventIds.has(t.event_id)) {
      hardErrors.push(
        `event_targets: event_id no existe en events: ${t.event_id}`,
      );
    }
    if (!storeIds.has(t.store_id)) {
      hardErrors.push(
        `event_targets: store_id no existe en stores: ${t.store_id}`,
      );
    }
  }

  const targetsCountByEvent = new Map<string, number>();
  for (const t of eventTargets) {
    if (eventIds.has(t.event_id) && storeIds.has(t.store_id)) {
      targetsCountByEvent.set(
        t.event_id,
        (targetsCountByEvent.get(t.event_id) ?? 0) + 1,
      );
    }
  }
  for (const e of events) {
    const count = targetsCountByEvent.get(e.event_id) ?? 0;
    if (count > 0 && e.target_stores !== count) {
      warnings.push(
        `Evento ${e.event_id} (${e.event_name}): target_stores (${e.target_stores}) no coincide con count(event_targets)=${count}.`,
      );
    }
    if (count === 0) {
      warnings.push(
        `Evento ${e.event_id} (${e.event_name}): sin event_targets; se trata como Open Event.`,
      );
    }
  }

  const eventStartEnd = new Map<
    string,
    { start: Date; end: Date }
  >();
  for (const e of events) {
    try {
      eventStartEnd.set(e.event_id, {
        start: parseDate(e.start_date),
        end: parseDate(e.end_date),
      });
    } catch {
      // skip invalid
    }
  }
  for (const c of campaigns) {
    const range = eventStartEnd.get(c.event_id);
    if (!range) continue;
    let createdAt: Date;
    try {
      createdAt = parseDate(c.created_at);
    } catch {
      continue;
    }
    if (createdAt < range.start || createdAt > range.end) {
      warnings.push(
        `Campaña ${c.campaign_id}: created_at fuera del rango del evento ${c.event_id}.`,
      );
    }
  }

  const storesById = new Map(stores.map((s) => [s.store_id, s]));
  const targetStoresByEventBrand = new Map<string, Set<string>>();
  for (const t of eventTargets) {
    if (!eventIds.has(t.event_id) || !storeIds.has(t.store_id)) continue;
    const store = storesById.get(t.store_id);
    if (!store?.brand) continue;
    const key = `${t.event_id}\t${store.brand}`;
    let set = targetStoresByEventBrand.get(key);
    if (!set) {
      set = new Set();
      targetStoresByEventBrand.set(key, set);
    }
    set.add(t.store_id);
  }
  const campaignStoresByEventBrand = new Map<string, Set<string>>();
  for (const c of campaigns) {
    if (!eventIds.has(c.event_id) || !storeIds.has(c.store_id)) continue;
    const store = storesById.get(c.store_id);
    if (!store?.brand) continue;
    const key = `${c.event_id}\t${store.brand}`;
    let set = campaignStoresByEventBrand.get(key);
    if (!set) {
      set = new Set();
      campaignStoresByEventBrand.set(key, set);
    }
    set.add(c.store_id);
  }
  for (const [key, targetStoreIds] of targetStoresByEventBrand) {
    const [eventId, brand] = key.split("\t");
    const campaignStores = campaignStoresByEventBrand.get(key) ?? new Set();
    if (targetStoreIds.size > 0 && campaignStores.size === 0) {
      const ev = events.find((e) => e.event_id === eventId);
      warnings.push(
        `Brand "${brand}" has ${targetStoreIds.size} target store(s) in event ${eventId}${ev ? ` (${ev.event_name})` : ""} but no campaigns.`,
      );
    }
  }

  return { hardErrors, warnings };
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

function formatGmv(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

function formatDeltaPP(value: number | null): string {
  if (value === null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} pp`;
}

function deltaColorClass(value: number | null): string {
  if (value === null) return "text-slate-500";
  if (value > 0) return "text-emerald-400/90";
  if (value < 0) return "text-red-400/90";
  return "text-slate-500";
}

function downloadCsvMissingStores(
  eventId: string,
  rows: { store: StoreCsvRow; hasPromo: boolean }[],
): void {
  const header = ["event_id", "store_id", "brand", "region", "city", "commercial", "segment", "ops_zone", "gmv_last_30d", "has_promo"];
  const missing = rows.filter((r) => !r.hasPromo);
  const data = missing.map((r) => [
    eventId,
    r.store.store_id,
    r.store.brand,
    r.store.region,
    r.store.city,
    r.store.commercial,
    r.store.segment,
    r.store.ops_zone,
    String(r.store.gmv_last_30d ?? 0),
    "No",
  ]);
  const csv = [header.join(","), ...data.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `missing_stores_${eventId}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function getPenetrationLabel(fillRate: number): string {
  if (fillRate <= 0) return "Sin activación";
  if (fillRate < 50) return "Baja penetración";
  if (fillRate < 100) return "Cobertura parcial";
  return "Cobertura total";
}

function getPenetrationClass(fillRate: number): string {
  if (fillRate <= 0) return "border-slate-500/20 bg-slate-500/10 text-slate-400";
  if (fillRate < 50) return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  if (fillRate < 100) return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
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

type FiltersBarProps = {
  stores: StoreCsvRow[];
  filters: FiltersState;
  onChange: (next: FiltersState) => void;
  disabled: boolean;
};

function FilterDropdown({
  label,
  options,
  value,
  onChange,
  disabled,
  searchQuery,
  onSearchChange,
  isOpen,
  onToggle,
  onClose,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, searchQuery]);
  const toggleOption = (opt: string) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <div className="space-y-1 relative">
      <label className="block text-[11px] font-medium text-slate-300">{label}</label>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-left text-[11px] text-slate-100 outline-none focus:border-emerald-500 disabled:bg-slate-950"
      >
        {value.length === 0 ? "Ninguno" : value.length === 1 ? value[0] : `${value.length} seleccionados`}
      </button>
      {isOpen && (
        <>
          <div className="absolute top-full left-0 right-0 z-10 mt-0.5 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar..."
              className="w-full border-b border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100 placeholder:text-slate-500 outline-none"
            />
            <div className="max-h-40 overflow-auto p-1">
              {filtered.map((opt) => (
                <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={value.includes(opt)}
                    onChange={() => toggleOption(opt)}
                    className="rounded border-slate-600"
                  />
                  {opt}
                </label>
              ))}
              {filtered.length === 0 && <p className="px-1.5 py-1 text-[11px] text-slate-500">Sin resultados</p>}
            </div>
          </div>
          <div className="fixed inset-0 z-[9]" aria-hidden onClick={onClose} />
        </>
      )}
    </div>
  );
}

function FiltersBar({ stores, filters, onChange, disabled }: FiltersBarProps) {
  const [openFilter, setOpenFilter] = useState<keyof FiltersState | null>(null);
  const [filterSearch, setFilterSearch] = useState<Record<keyof FiltersState, string>>({
    regions: "", cities: "", commercials: "", segments: "", opsZones: "", brands: "",
  });

  const unique = (values: string[]) =>
    Array.from(new Set(values.filter((v) => v && v.trim().length > 0))).sort(
      (a, b) => a.localeCompare(b, "es"),
    );

  const regionOptions = useMemo(
    () => unique(stores.map((s) => s.region)),
    [stores],
  );

  const storesByRegion = useMemo(() => {
    if (filters.regions.length === 0) return stores;
    return stores.filter((s) => filters.regions.includes(s.region));
  }, [filters.regions, stores]);

  const cityOptions = useMemo(
    () => unique(storesByRegion.map((s) => s.city)),
    [storesByRegion],
  );

  const filteredStoresBase = useMemo(() => {
    if (filters.cities.length === 0) return storesByRegion;
    return storesByRegion.filter((s) => filters.cities.includes(s.city));
  }, [filters.cities, storesByRegion]);

  const commercialOptions = useMemo(
    () => unique(filteredStoresBase.map((s) => s.commercial)),
    [filteredStoresBase],
  );

  const segmentOptions = useMemo(
    () => unique(filteredStoresBase.map((s) => s.segment)),
    [filteredStoresBase],
  );

  const opsZoneOptions = useMemo(
    () => unique(filteredStoresBase.map((s) => s.ops_zone)),
    [filteredStoresBase],
  );

  const brandOptions = useMemo(
    () => unique(stores.map((s) => s.brand)),
    [stores],
  );

  const handleMultiSelectChange = (
    key: keyof FiltersState,
    values: readonly string[],
  ) => {
    onChange({
      ...filters,
      [key]: Array.from(values),
    });
  };

  const brandsFilter = filters.brands ?? [];
  const hasActiveFilters =
    filters.regions.length > 0 ||
    filters.cities.length > 0 ||
    filters.commercials.length > 0 ||
    filters.segments.length > 0 ||
    filters.opsZones.length > 0 ||
    brandsFilter.length > 0;

  const removeFilterValue = (key: keyof FiltersState, value: string) => {
    const prev = filters[key];
    onChange({
      ...filters,
      [key]: prev.filter((v) => v !== value),
    });
  };

  const activeChips: { key: keyof FiltersState; label: string; value: string }[] = [
    ...filters.regions.map((value) => ({ key: "regions" as const, label: "Región", value })),
    ...filters.cities.map((value) => ({ key: "cities" as const, label: "Ciudad", value })),
    ...filters.opsZones.map((value) => ({ key: "opsZones" as const, label: "Zona ops", value })),
    ...filters.commercials.map((value) => ({ key: "commercials" as const, label: "Comercial", value })),
    ...filters.segments.map((value) => ({ key: "segments" as const, label: "Segmento", value })),
    ...(filters.brands ?? []).map((value) => ({ key: "brands" as const, label: "Marca", value })),
  ];

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 shadow-xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Filtros por tiendas
          </p>
          <p className="text-[11px] text-slate-400/80">
            Aplica filtros por región, ciudad, zona y segmento para recalcular
            métricas de eventos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              onChange({
                regions: [],
                cities: [],
                commercials: [],
                segments: [],
                opsZones: [],
                brands: [],
              })
            }
            disabled={!hasActiveFilters || disabled}
            className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-slate-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500 hover:border-emerald-500 hover:text-emerald-200"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-slate-500">Activos:</span>
          {activeChips.map(({ key, label, value }) => (
            <span
              key={`${key}-${value}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-200"
            >
              <span className="text-slate-400">{label}:</span>
              <span>{value}</span>
              <button
                type="button"
                onClick={() => removeFilterValue(key, value)}
                disabled={disabled}
                className="ml-0.5 rounded-full p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Quitar ${label} ${value}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-2.5 md:grid-cols-6">
        <FilterDropdown
          label="Región"
          options={regionOptions}
          value={filters.regions}
          onChange={(v) => handleMultiSelectChange("regions", v)}
          disabled={disabled}
          searchQuery={filterSearch.regions}
          onSearchChange={(q) => setFilterSearch((s) => ({ ...s, regions: q }))}
          isOpen={openFilter === "regions"}
          onToggle={() => setOpenFilter((k) => (k === "regions" ? null : "regions"))}
          onClose={() => setOpenFilter(null)}
        />
        <FilterDropdown
          label="Ciudad"
          options={cityOptions}
          value={filters.cities}
          onChange={(v) => handleMultiSelectChange("cities", v)}
          disabled={disabled}
          searchQuery={filterSearch.cities}
          onSearchChange={(q) => setFilterSearch((s) => ({ ...s, cities: q }))}
          isOpen={openFilter === "cities"}
          onToggle={() => setOpenFilter((k) => (k === "cities" ? null : "cities"))}
          onClose={() => setOpenFilter(null)}
        />
        <FilterDropdown
          label="Zona ops"
          options={opsZoneOptions}
          value={filters.opsZones}
          onChange={(v) => handleMultiSelectChange("opsZones", v)}
          disabled={disabled}
          searchQuery={filterSearch.opsZones}
          onSearchChange={(q) => setFilterSearch((s) => ({ ...s, opsZones: q }))}
          isOpen={openFilter === "opsZones"}
          onToggle={() => setOpenFilter((k) => (k === "opsZones" ? null : "opsZones"))}
          onClose={() => setOpenFilter(null)}
        />
        <FilterDropdown
          label="Comercial"
          options={commercialOptions}
          value={filters.commercials}
          onChange={(v) => handleMultiSelectChange("commercials", v)}
          disabled={disabled}
          searchQuery={filterSearch.commercials}
          onSearchChange={(q) => setFilterSearch((s) => ({ ...s, commercials: q }))}
          isOpen={openFilter === "commercials"}
          onToggle={() => setOpenFilter((k) => (k === "commercials" ? null : "commercials"))}
          onClose={() => setOpenFilter(null)}
        />
        <FilterDropdown
          label="Segmento"
          options={segmentOptions}
          value={filters.segments}
          onChange={(v) => handleMultiSelectChange("segments", v)}
          disabled={disabled}
          searchQuery={filterSearch.segments}
          onSearchChange={(q) => setFilterSearch((s) => ({ ...s, segments: q }))}
          isOpen={openFilter === "segments"}
          onToggle={() => setOpenFilter((k) => (k === "segments" ? null : "segments"))}
          onClose={() => setOpenFilter(null)}
        />
        <FilterDropdown
          label="Marca"
          options={brandOptions}
          value={filters.brands ?? []}
          onChange={(v) => handleMultiSelectChange("brands", v)}
          disabled={disabled}
          searchQuery={filterSearch.brands}
          onSearchChange={(q) => setFilterSearch((s) => ({ ...s, brands: q }))}
          isOpen={openFilter === "brands"}
          onToggle={() => setOpenFilter((k) => (k === "brands" ? null : "brands"))}
          onClose={() => setOpenFilter(null)}
        />
      </div>
      {disabled && (
        <p className="mt-2 text-[11px] text-slate-500">
          Sube un archivo <span className="font-mono text-slate-300">stores_mx.csv</span> para
          habilitar los filtros por tiendas.
        </p>
      )}
    </section>
  );
}

type DetailView =
  | { view: "list" }
  | { view: "event"; eventId: string }
  | { view: "city"; eventId: string; city: string }
  | { view: "commercial"; eventId: string; city: string; commercial: string }
  | { view: "brand"; eventId: string; city: string; commercial: string; brand: string }
  | {
      view: "store";
      eventId: string;
      city: string;
      commercial: string;
      brand: string;
      storeId: string;
    };

type EventDeltas = {
  deltaFillRate48h: number | null;
  deltaFillRate7d: number | null;
  deltaGmvCoverage48h: number | null;
  deltaGmvCoverage7d: number | null;
};

type DrilldownPanelProps = {
  detailView: DetailView;
  setDetailView: (v: DetailView) => void;
  storedData: StoredData;
  eventsWithMetrics: EventWithMetrics[];
  eventDeltas: Map<string, EventDeltas>;
  stores: StoreCsvRow[];
  storesById: Map<string, StoreCsvRow>;
  storesByBrand: Map<string, StoreCsvRow[]>;
  targetsByEvent: Map<string, Set<string>>;
  campaignsByEventId: Map<string, { storeId: string; createdAt: Date }[]>;
  campaignsByEventAndStore: Map<string, CampaignCsvRow[]>;
  today: Date;
  filteredStoreIds: Set<string> | null;
};

function DrilldownPanel({
  detailView,
  setDetailView,
  storedData,
  eventsWithMetrics,
  eventDeltas,
  stores,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- prop kept for API consistency
  storesById: _storesById,
  storesByBrand,
  targetsByEvent,
  campaignsByEventId,
  campaignsByEventAndStore,
  today,
  filteredStoreIds,
}: DrilldownPanelProps) {
  const todayStart = toStartOfDay(today);
  const eventMap = useMemo(
    () => new Map(eventsWithMetrics.map((e) => [e.id, e])),
    [eventsWithMetrics],
  );

  const event =
    detailView.view !== "list"
      ? storedData.events.find((e) => e.event_id === detailView.eventId)
      : null;
  const eventName =
    event?.event_name ??
    ("eventId" in detailView ? detailView.eventId : "");

  const breadcrumbs: { label: string; onClick: () => void }[] = [
    { label: "Eventos", onClick: () => setDetailView({ view: "list" }) },
  ];
  if (detailView.view !== "list") {
    breadcrumbs.push({
      label: eventName,
      onClick: () => setDetailView({ view: "event", eventId: detailView.eventId }),
    });
  }
  if (detailView.view === "city" || detailView.view === "commercial" || detailView.view === "brand" || detailView.view === "store") {
    breadcrumbs.push({
      label: detailView.city,
      onClick: () =>
        setDetailView({ view: "city", eventId: detailView.eventId, city: detailView.city }),
    });
  }
  if (detailView.view === "commercial" || detailView.view === "brand" || detailView.view === "store") {
    breadcrumbs.push({
      label: detailView.commercial,
      onClick: () =>
        setDetailView({
          view: "commercial",
          eventId: detailView.eventId,
          city: detailView.city,
          commercial: detailView.commercial,
        }),
    });
  }
  if (detailView.view === "brand" || detailView.view === "store") {
    const brand = detailView.view === "store" ? detailView.brand : detailView.brand;
    breadcrumbs.push({
      label: brand,
      onClick: () =>
        setDetailView({
          view: "brand",
          eventId: detailView.eventId,
          city: detailView.city,
          commercial: detailView.commercial,
          brand,
        }),
    });
  }
  if (detailView.view === "store") {
    breadcrumbs.push({
      label: detailView.storeId,
      onClick: () => {},
    });
  }

  const [eventDetailTab, setEventDetailTab] = useState<"cities" | "commercials" | "brands">("cities");
  const [brandDetailOnlyNoPromo, setBrandDetailOnlyNoPromo] = useState(false);

  if (detailView.view === "list") return null;

  const targetStoreIds = targetsByEvent.get(detailView.eventId);
  const hasTargets = targetStoreIds && targetStoreIds.size > 0;
  const eventCampaigns = campaignsByEventId.get(detailView.eventId) ?? [];
  const storesWithPromoSet = new Set(
    eventCampaigns
      .filter((c) => c.createdAt <= todayStart)
      .map((c) => c.storeId),
  );

  const content = (() => {
    if (detailView.view === "event") {
      const storesInScope = hasTargets
        ? stores.filter((s) => targetStoreIds!.has(s.store_id))
        : stores.filter((s) => !filteredStoreIds || filteredStoreIds.has(s.store_id));
      const evMetrics = eventMap.get(detailView.eventId);
      const byCity = new Map<string, StoreCsvRow[]>();
      for (const s of storesInScope) {
        const list = byCity.get(s.city) ?? [];
        list.push(s);
        byCity.set(s.city, list);
      }
      const cityRows = Array.from(byCity.entries()).map(([city, cityStores]) => {
        const targetCount = hasTargets
          ? cityStores.filter((s) => targetStoreIds!.has(s.store_id)).length
          : cityStores.length;
        const withPromo = cityStores.filter((s) =>
          storesWithPromoSet.has(s.store_id),
        ).length;
        const fillRate = targetCount > 0 ? (withPromo / targetCount) * 100 : 0;
        const promosCreated = eventCampaigns.filter(
          (c) =>
            c.createdAt <= todayStart &&
            cityStores.some((s) => s.store_id === c.storeId),
        ).length;
        const gapStores = Math.max(targetCount - withPromo, 0);
        const gmvTarget = cityStores.reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
        const gmvCovered = cityStores.filter((s) => storesWithPromoSet.has(s.store_id)).reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
        const gmvCoverage = gmvTarget > 0 ? (gmvCovered / gmvTarget) * 100 : 0;
        const gmvGap = Math.max(gmvTarget - gmvCovered, 0);
        const coverage = fillRate / 100;
        const ev = eventMap.get(detailView.eventId);
        const daysToStart = ev?.daysToStart ?? 0;
        const isFinished = ev?.endDate ? todayStart > toStartOfDay(ev.endDate) : false;
        const isOngoing =
          ev?.startDate && ev?.endDate
            ? todayStart >= toStartOfDay(ev.startDate) &&
              todayStart <= toStartOfDay(ev.endDate)
            : false;
        const showRisk =
          !isFinished && (daysToStart <= 7 || isOngoing);
        let riskLevel: RiskLevel = "none";
        if (showRisk) {
          if (coverage < 0.1) riskLevel = "risk";
          else if (coverage < 0.3) riskLevel = "critical";
        }
        return {
          city,
          targetStores: targetCount,
          storesWithPromo: withPromo,
          fillRate,
          promosCreated,
          gapStores,
          riskLevel,
          gmvTarget,
          gmvCovered,
          gmvCoverage,
          gmvGap,
        };
      });
      cityRows.sort((a, b) => a.fillRate - b.fillRate);

      const byBrandForSummary = new Map<string, { gmvTarget: number; gmvCovered: number }>();
      for (const s of storesInScope) {
        const gmv = s.gmv_last_30d ?? 0;
        const cur = byBrandForSummary.get(s.brand) ?? { gmvTarget: 0, gmvCovered: 0 };
        cur.gmvTarget += gmv;
        if (storesWithPromoSet.has(s.store_id)) cur.gmvCovered += gmv;
        byBrandForSummary.set(s.brand, cur);
      }
      const brandGapRows = Array.from(byBrandForSummary.entries())
        .map(([brand, v]) => ({ brand, gmvGap: Math.max(v.gmvTarget - v.gmvCovered, 0) }))
        .filter((r) => r.gmvGap > 0)
        .sort((a, b) => b.gmvGap - a.gmvGap)
        .slice(0, 3);

      const targetStoresTotal = storesInScope.length;
      const storesWithPromoTotal = storesInScope.filter((s) => storesWithPromoSet.has(s.store_id)).length;
      const storesWithoutPromoTotal = Math.max(targetStoresTotal - storesWithPromoTotal, 0);

      const deltas = eventDeltas.get(detailView.eventId);
      const summaryPanel = (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Cobertura tiendas</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{evMetrics ? formatPercent(evMetrics.fillRate) : "—"}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
              <span className={deltaColorClass(deltas?.deltaFillRate48h ?? null)}>Δ48h: {formatDeltaPP(deltas?.deltaFillRate48h ?? null)}</span>
              <span className={deltaColorClass(deltas?.deltaFillRate7d ?? null)}>Δ7d: {formatDeltaPP(deltas?.deltaFillRate7d ?? null)}</span>
            </p>
            <p className="text-[11px] text-slate-400">Objetivo: {targetStoresTotal} · Con promo: {storesWithPromoTotal} · Sin promo: {storesWithoutPromoTotal}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Promos vs objetivo</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{evMetrics ? `${evMetrics.promosToDate} / ${evMetrics.targetPromos}` : "—"}</p>
            <p className="text-[11px] text-slate-400">Gap promos: {evMetrics?.gapPromos ?? 0}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">GMV cobertura</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{evMetrics && evMetrics.gmvTarget > 0 ? formatPercent(evMetrics.gmvCoverage) : "—"}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
              <span className={deltaColorClass(deltas?.deltaGmvCoverage48h ?? null)}>Δ48h: {formatDeltaPP(deltas?.deltaGmvCoverage48h ?? null)}</span>
              <span className={deltaColorClass(deltas?.deltaGmvCoverage7d ?? null)}>Δ7d: {formatDeltaPP(deltas?.deltaGmvCoverage7d ?? null)}</span>
            </p>
            <p className="text-[11px] text-slate-400">Cubierto: {evMetrics ? formatGmv(evMetrics.gmvCovered) : "—"} · Gap: {evMetrics ? formatGmv(evMetrics.gmvGap) : "—"}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Prioridad</p>
            <p className="mt-1 text-[11px] text-slate-300">Ciudades (menor cobertura): {cityRows.slice(0, 3).map((r) => r.city).join(", ") || "—"}</p>
            <p className="mt-0.5 text-[11px] text-slate-300">Marcas (mayor gap GMV): {brandGapRows.map((r) => r.brand).join(", ") || "—"}</p>
          </div>
        </div>
      );

      if (eventDetailTab === "commercials") {
        const byCommercial = new Map<string, StoreCsvRow[]>();
        for (const s of storesInScope) {
          const list = byCommercial.get(s.commercial) ?? [];
          list.push(s);
          byCommercial.set(s.commercial, list);
        }
        const commercialRows = Array.from(byCommercial.entries()).map(
          ([commercial, commStores]) => {
            const targetCount = hasTargets
              ? commStores.filter((s) => targetStoreIds!.has(s.store_id)).length
              : commStores.length;
            const withPromo = commStores.filter((s) =>
              storesWithPromoSet.has(s.store_id),
            ).length;
            const fillRate = targetCount > 0 ? (withPromo / targetCount) * 100 : 0;
            const gapStores = Math.max(targetCount - withPromo, 0);
            const gmvTarget = commStores.reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
            const gmvCovered = commStores.filter((s) => storesWithPromoSet.has(s.store_id)).reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
            const gmvCoverage = gmvTarget > 0 ? (gmvCovered / gmvTarget) * 100 : 0;
            const gmvGap = Math.max(gmvTarget - gmvCovered, 0);
            return {
              commercial,
              targetStores: targetCount,
              storesWithPromo: withPromo,
              fillRate,
              gapStores,
              gmvTarget,
              gmvCovered,
              gmvCoverage,
              gmvGap,
            };
          },
        );
        commercialRows.sort((a, b) => a.fillRate - b.fillRate);

        return (
          <>
            {summaryPanel}
            <div className="space-y-3">
              <div className="flex gap-2 border-b border-slate-700 pb-2">
                <button type="button" onClick={() => setEventDetailTab("cities")} className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">Ciudades</button>
                <button type="button" onClick={() => setEventDetailTab("commercials")} className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-200 border border-emerald-400/30">Comerciales</button>
                <button type="button" onClick={() => setEventDetailTab("brands")} className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">Marcas</button>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-800">
                <table className="min-w-full text-left text-xs text-slate-100">
                  <thead className="bg-slate-900/95">
                    <tr>
                      <th className="px-3 py-2 text-slate-300">Comercial</th>
                      <th className="px-3 py-2 text-slate-300">Tiendas objetivo</th>
                      <th className="px-3 py-2 text-slate-300">Con promo</th>
                      <th className="px-3 py-2 text-slate-300">Cobertura</th>
                      <th className="px-3 py-2 text-slate-300">Gap tiendas</th>
                      <th className="px-3 py-2 text-slate-300">GMV objetivo</th>
                      <th className="px-3 py-2 text-slate-300">GMV cubierto</th>
                      <th className="px-3 py-2 text-slate-300">GMV cobertura %</th>
                      <th className="px-3 py-2 text-slate-300">GMV gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {commercialRows.map((r) => (
                    <tr key={r.commercial} className="hover:bg-slate-900/80">
                      <td className="px-3 py-2 font-medium text-slate-50">{r.commercial}</td>
                      <td className="px-3 py-2">{r.targetStores}</td>
                      <td className="px-3 py-2">{r.storesWithPromo}</td>
                      <td className="px-3 py-2">{formatPercent(r.fillRate)}</td>
                      <td className="px-3 py-2">{r.gapStores}</td>
                      <td className="px-3 py-2">{formatGmv(r.gmvTarget)}</td>
                      <td className="px-3 py-2">{formatGmv(r.gmvCovered)}</td>
                      <td className="px-3 py-2">{formatPercent(r.gmvCoverage)}</td>
                      <td className="px-3 py-2">{formatGmv(r.gmvGap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
        );
      }

      if (eventDetailTab === "brands") {
        const byBrand = new Map<string, StoreCsvRow[]>();
        for (const s of storesInScope) {
          const list = byBrand.get(s.brand) ?? [];
          list.push(s);
          byBrand.set(s.brand, list);
        }
        const brandRows = Array.from(byBrand.entries()).map(([brand, brandStores]) => {
          const targetCount = hasTargets
            ? brandStores.filter((s) => targetStoreIds!.has(s.store_id)).length
            : brandStores.length;
          const withPromo = brandStores.filter((s) => storesWithPromoSet.has(s.store_id)).length;
          const fillRate = targetCount > 0 ? (withPromo / targetCount) * 100 : 0;
          const gapStores = Math.max(targetCount - withPromo, 0);
          const cityCount = new Set(brandStores.map((s) => s.city)).size;
          const gmvTarget = brandStores.reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
          const gmvCovered = brandStores.filter((s) => storesWithPromoSet.has(s.store_id)).reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
          const gmvCoverage = gmvTarget > 0 ? (gmvCovered / gmvTarget) * 100 : 0;
          const gmvGap = Math.max(gmvTarget - gmvCovered, 0);
          return { brand, cityCount, targetStores: targetCount, storesWithPromo: withPromo, fillRate, gapStores, gmvTarget, gmvCovered, gmvCoverage, gmvGap };
        });
        brandRows.sort((a, b) => b.gmvGap - a.gmvGap);

        return (
          <>
            {summaryPanel}
            <div className="space-y-3">
              <div className="flex gap-2 border-b border-slate-700 pb-2">
                <button type="button" onClick={() => setEventDetailTab("cities")} className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">Ciudades</button>
                <button type="button" onClick={() => setEventDetailTab("commercials")} className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">Comerciales</button>
                <button type="button" onClick={() => setEventDetailTab("brands")} className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-200 border border-emerald-400/30">Marcas</button>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-800">
                <table className="min-w-full text-left text-xs text-slate-100">
                  <thead className="bg-slate-900/95">
                    <tr>
                      <th className="px-3 py-2 text-slate-300">Marca</th>
                      <th className="px-3 py-2 text-slate-300">Ciudades</th>
                      <th className="px-3 py-2 text-slate-300">Tiendas objetivo</th>
                      <th className="px-3 py-2 text-slate-300">Con promo</th>
                      <th className="px-3 py-2 text-slate-300">Cobertura</th>
                      <th className="px-3 py-2 text-slate-300">Gap</th>
                      <th className="px-3 py-2 text-slate-300">GMV objetivo</th>
                      <th className="px-3 py-2 text-slate-300">GMV cubierto</th>
                      <th className="px-3 py-2 text-slate-300">GMV cobertura %</th>
                      <th className="px-3 py-2 text-slate-300">GMV gap</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {brandRows.map((r) => (
                      <tr key={r.brand} className="hover:bg-slate-900/80">
                        <td className="px-3 py-2 font-medium text-slate-50">{r.brand}</td>
                        <td className="px-3 py-2">{r.cityCount}</td>
                        <td className="px-3 py-2">{r.targetStores}</td>
                        <td className="px-3 py-2">{r.storesWithPromo}</td>
                        <td className="px-3 py-2">{formatPercent(r.fillRate)}</td>
                        <td className="px-3 py-2">{r.gapStores}</td>
                        <td className="px-3 py-2">{formatGmv(r.gmvTarget)}</td>
                        <td className="px-3 py-2">{formatGmv(r.gmvCovered)}</td>
                        <td className="px-3 py-2">{formatPercent(r.gmvCoverage)}</td>
                        <td className="px-3 py-2">{formatGmv(r.gmvGap)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        );
      }

      return (
        <>
          {summaryPanel}
          <div className="space-y-3">
            <div className="flex gap-2 border-b border-slate-700 pb-2">
              <button
                type="button"
                onClick={() => setEventDetailTab("cities")}
                className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-200 border border-emerald-400/30"
              >
                Ciudades
              </button>
              <button
                type="button"
                onClick={() => setEventDetailTab("commercials")}
                className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Comerciales
              </button>
              <button
                type="button"
                onClick={() => setEventDetailTab("brands")}
                className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Marcas
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <table className="min-w-full text-left text-xs text-slate-100">
                <thead className="bg-slate-900/95">
                <tr>
                  <th className="px-3 py-2 text-slate-300">Ciudad</th>
                  <th className="px-3 py-2 text-slate-300">Tiendas objetivo</th>
                  <th className="px-3 py-2 text-slate-300">Con promo</th>
                  <th className="px-3 py-2 text-slate-300">Cobertura</th>
                  <th className="px-3 py-2 text-slate-300">Promos creadas</th>
                  <th className="px-3 py-2 text-slate-300">Gap tiendas</th>
                  <th className="px-3 py-2 text-slate-300">GMV objetivo</th>
                  <th className="px-3 py-2 text-slate-300">GMV cubierto</th>
                  <th className="px-3 py-2 text-slate-300">GMV cobertura %</th>
                  <th className="px-3 py-2 text-slate-300">GMV gap</th>
                  <th className="px-3 py-2 text-slate-300">Riesgo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                  {cityRows.map((r) => (
                  <tr
                    key={r.city}
                    className="hover:bg-slate-900/80 cursor-pointer"
                    onClick={() =>
                      setDetailView({
                        view: "city",
                        eventId: detailView.eventId,
                        city: r.city,
                      })
                    }
                  >
                    <td className="px-3 py-2 font-medium text-slate-50">{r.city}</td>
                    <td className="px-3 py-2">{r.targetStores}</td>
                    <td className="px-3 py-2">{r.storesWithPromo}</td>
                    <td className="px-3 py-2">{formatPercent(r.fillRate)}</td>
                    <td className="px-3 py-2">{r.promosCreated}</td>
                    <td className="px-3 py-2">{r.gapStores}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvTarget)}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvCovered)}</td>
                    <td className="px-3 py-2">{formatPercent(r.gmvCoverage)}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvGap)}</td>
                    <td className="px-3 py-2">
                      {r.riskLevel === "critical" && (
                        <span className="rounded-full border border-red-500/15 bg-red-500/8 px-2 py-0.5 text-[10px] font-medium text-red-300">
                          ▲ Crítico
                        </span>
                      )}
                      {r.riskLevel === "risk" && (
                        <span className="rounded-full border border-amber-400/15 bg-amber-400/8 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                          ▲ Riesgo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
          </>
      );
    }

    if (detailView.view === "city") {
      const storesInCity = stores.filter(
        (s) =>
          s.city === detailView.city &&
          (!filteredStoreIds || filteredStoreIds.has(s.store_id)) &&
          (!targetStoreIds || targetStoreIds.has(s.store_id)),
      );
      const byCommercial = new Map<string, StoreCsvRow[]>();
      for (const s of storesInCity) {
        const list = byCommercial.get(s.commercial) ?? [];
        list.push(s);
        byCommercial.set(s.commercial, list);
      }
      const commercialRows = Array.from(byCommercial.entries()).map(
        ([commercial, commStores]) => {
          const targetCount = commStores.length;
          const withPromo = commStores.filter((s) =>
            storesWithPromoSet.has(s.store_id),
          ).length;
          const fillRate = targetCount > 0 ? (withPromo / targetCount) * 100 : 0;
          const gapStores = Math.max(targetCount - withPromo, 0);
          const gmvTarget = commStores.reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
          const gmvCovered = commStores.filter((s) => storesWithPromoSet.has(s.store_id)).reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
          const gmvCoverage = gmvTarget > 0 ? (gmvCovered / gmvTarget) * 100 : 0;
          const gmvGap = Math.max(gmvTarget - gmvCovered, 0);
          return {
            commercial,
            targetStores: targetCount,
            storesWithPromo: withPromo,
            fillRate,
            gapStores,
            gmvTarget,
            gmvCovered,
            gmvCoverage,
            gmvGap,
          };
        },
      );
      commercialRows.sort((a, b) => a.fillRate - b.fillRate);
      const cityTargetTotal = commercialRows.reduce((sum, r) => sum + r.targetStores, 0);
      const cityWithPromoTotal = commercialRows.reduce((sum, r) => sum + r.storesWithPromo, 0);
      const cityGapTotal = commercialRows.reduce((sum, r) => sum + r.gapStores, 0);

      return (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">
            {cityWithPromoTotal} tiendas con promo de {cityTargetTotal} objetivo
            {cityGapTotal > 0 && (
              <> · <span className="text-amber-200">{cityGapTotal} sin promo</span></>
            )}
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="min-w-full text-left text-xs text-slate-100">
              <thead className="bg-slate-900/95">
                <tr>
                  <th className="px-3 py-2 text-slate-300">Comercial</th>
                  <th className="px-3 py-2 text-slate-300">Tiendas objetivo</th>
                  <th className="px-3 py-2 text-slate-300">Con promo</th>
                  <th className="px-3 py-2 text-slate-300">Cobertura</th>
                  <th className="px-3 py-2 text-slate-300">Gap tiendas</th>
                  <th className="px-3 py-2 text-slate-300">GMV objetivo</th>
                  <th className="px-3 py-2 text-slate-300">GMV cubierto</th>
                  <th className="px-3 py-2 text-slate-300">GMV cobertura %</th>
                  <th className="px-3 py-2 text-slate-300">GMV gap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {commercialRows.map((r) => (
                  <tr
                    key={r.commercial}
                    className="hover:bg-slate-900/80 cursor-pointer"
                    onClick={() =>
                      setDetailView({
                        view: "commercial",
                        eventId: detailView.eventId,
                        city: detailView.city,
                        commercial: r.commercial,
                      })
                    }
                  >
                    <td className="px-3 py-2 font-medium text-slate-50">{r.commercial}</td>
                    <td className="px-3 py-2">{r.targetStores}</td>
                    <td className="px-3 py-2">{r.storesWithPromo}</td>
                    <td className="px-3 py-2">{formatPercent(r.fillRate)}</td>
                    <td className="px-3 py-2">{r.gapStores}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvTarget)}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvCovered)}</td>
                    <td className="px-3 py-2">{formatPercent(r.gmvCoverage)}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvGap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (detailView.view === "commercial") {
      const storesInComm = stores.filter(
        (s) =>
          s.city === detailView.city &&
          s.commercial === detailView.commercial &&
          (!filteredStoreIds || filteredStoreIds.has(s.store_id)) &&
          (!targetStoreIds || targetStoreIds.has(s.store_id)),
      );
      const byBrand = new Map<string, StoreCsvRow[]>();
      for (const s of storesInComm) {
        const list = byBrand.get(s.brand) ?? [];
        list.push(s);
        byBrand.set(s.brand, list);
      }
      const brandRows = Array.from(byBrand.entries()).map(([brand, brandStores]) => {
        const targetCount = brandStores.length;
        const withPromo = brandStores.filter((s) => storesWithPromoSet.has(s.store_id)).length;
        const fillRate = targetCount > 0 ? (withPromo / targetCount) * 100 : 0;
        const gapStores = Math.max(targetCount - withPromo, 0);
        const gmvTarget = brandStores.reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
        const gmvCovered = brandStores.filter((s) => storesWithPromoSet.has(s.store_id)).reduce((sum, s) => sum + (s.gmv_last_30d ?? 0), 0);
        const gmvCoverage = gmvTarget > 0 ? (gmvCovered / gmvTarget) * 100 : 0;
        const gmvGap = Math.max(gmvTarget - gmvCovered, 0);
        return { brand, targetStores: targetCount, storesWithPromo: withPromo, fillRate, gapStores, gmvTarget, gmvCovered, gmvCoverage, gmvGap };
      });
      brandRows.sort((a, b) => b.gmvGap - a.gmvGap);
      const commGapTotal = brandRows.reduce((sum, r) => sum + r.gapStores, 0);
      const missingStoresForExport = storesInComm.map((store) => ({
        store,
        hasPromo: storesWithPromoSet.has(store.store_id),
      }));
      const missingCount = missingStoresForExport.filter((r) => !r.hasPromo).length;

      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {commGapTotal > 0 && (
              <p className="text-[11px] text-slate-400">
                <span className="text-amber-200">{commGapTotal} tienda{commGapTotal === 1 ? "" : "s"} sin promo</span> en este comercial
              </p>
            )}
            {missingCount > 0 && (
              <button
                type="button"
                onClick={() => downloadCsvMissingStores(detailView.eventId, missingStoresForExport)}
                className="rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500 hover:text-emerald-200"
              >
                Exportar tiendas sin promo
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="min-w-full text-left text-xs text-slate-100">
              <thead className="bg-slate-900/95">
                <tr>
                  <th className="px-3 py-2 text-slate-300">Marca</th>
                  <th className="px-3 py-2 text-slate-300">Tiendas objetivo</th>
                  <th className="px-3 py-2 text-slate-300">Con promo</th>
                  <th className="px-3 py-2 text-slate-300">Cobertura</th>
                  <th className="px-3 py-2 text-slate-300">Gap</th>
                  <th className="px-3 py-2 text-slate-300">GMV objetivo</th>
                  <th className="px-3 py-2 text-slate-300">GMV cubierto</th>
                  <th className="px-3 py-2 text-slate-300">GMV cobertura %</th>
                  <th className="px-3 py-2 text-slate-300">GMV gap</th>
                  <th className="px-3 py-2 text-slate-300">Penetración</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {brandRows.map((r) => (
                  <tr
                    key={r.brand}
                    className="hover:bg-slate-900/80 cursor-pointer"
                    onClick={() =>
                      setDetailView({
                        view: "brand",
                        eventId: detailView.eventId,
                        city: detailView.city,
                        commercial: detailView.commercial,
                        brand: r.brand,
                      })
                    }
                  >
                    <td className="px-3 py-2 font-medium text-slate-50">{r.brand}</td>
                    <td className="px-3 py-2">{r.targetStores}</td>
                    <td className="px-3 py-2">{r.storesWithPromo}</td>
                    <td className="px-3 py-2">{formatPercent(r.fillRate)}</td>
                    <td className="px-3 py-2">{r.gapStores}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvTarget)}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvCovered)}</td>
                    <td className="px-3 py-2">{formatPercent(r.gmvCoverage)}</td>
                    <td className="px-3 py-2">{formatGmv(r.gmvGap)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getPenetrationClass(r.fillRate)}`}>
                        {getPenetrationLabel(r.fillRate)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (detailView.view === "brand") {
      const brandStores = storesByBrand.get(detailView.brand) ?? [];
      const storesInBrand = brandStores.filter(
        (s) =>
          s.city === detailView.city &&
          s.commercial === detailView.commercial &&
          (!filteredStoreIds || filteredStoreIds.has(s.store_id)) &&
          (!targetStoreIds || targetStoreIds.has(s.store_id)),
      );
      const storeRows = storesInBrand.map((s) => {
        const key = `${detailView.eventId}:${s.store_id}`;
        const campList = campaignsByEventAndStore.get(key) ?? [];
        const withPromo = campList.filter((c) => {
          try {
            return parseDate(c.created_at) <= todayStart;
          } catch {
            return false;
          }
        });
        const hasPromo = withPromo.length > 0;
        const lastCreated = hasPromo
          ? withPromo.reduce((latest, c) => {
              const d = parseDate(c.created_at);
              return d > latest ? d : latest;
            }, new Date(0))
          : null;
        const numPromos = withPromo.length;
        return { store: s, hasPromo, numPromos, lastCreated, gap: hasPromo ? 0 : 1 };
      });
      const filtered = brandDetailOnlyNoPromo
        ? storeRows.filter((r) => !r.hasPromo)
        : storeRows;
      filtered.sort((a, b) => {
        if (a.hasPromo !== b.hasPromo) return a.hasPromo ? 1 : -1;
        if (a.lastCreated && b.lastCreated)
          return a.lastCreated.getTime() - b.lastCreated.getTime();
        return 0;
      });

      const noPromoCount = storeRows.filter((r) => !r.hasPromo).length;
      const missingForExport = storeRows.map((r) => ({ store: r.store, hasPromo: r.hasPromo }));
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBrandDetailOnlyNoPromo((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                brandDetailOnlyNoPromo
                  ? "border-amber-500/50 bg-amber-500/20 text-amber-200"
                  : "border-slate-600 bg-slate-800/80 text-slate-300 hover:border-slate-500 hover:bg-slate-800"
              }`}
            >
              Solo tiendas sin promo {noPromoCount > 0 && `(${noPromoCount})`}
            </button>
            {noPromoCount > 0 && (
              <button
                type="button"
                onClick={() => downloadCsvMissingStores(detailView.eventId, missingForExport)}
                className="rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500 hover:text-emerald-200"
              >
                Exportar tiendas sin promo
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="min-w-full text-left text-xs text-slate-100">
              <thead className="bg-slate-900/95">
                <tr>
                  <th className="px-3 py-2 text-slate-300">Tienda</th>
                  <th className="px-3 py-2 text-slate-300">Segmento</th>
                  <th className="px-3 py-2 text-slate-300">Zona ops</th>
                  <th className="px-3 py-2 text-slate-300">Tiene promo</th>
                  <th className="px-3 py-2 text-slate-300"># Promos</th>
                  <th className="px-3 py-2 text-slate-300">Última creación</th>
                  <th className="px-3 py-2 text-slate-300">Gap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filtered.map((r) => (
                  <tr
                    key={r.store.store_id}
                    className="hover:bg-slate-900/80 cursor-pointer"
                    onClick={() =>
                      setDetailView({
                        view: "store",
                        eventId: detailView.eventId,
                        city: detailView.city,
                        commercial: detailView.commercial,
                        brand: detailView.brand,
                        storeId: r.store.store_id,
                      })
                    }
                  >
                    <td className="px-3 py-2 font-medium text-slate-50">{r.store.store_id}</td>
                    <td className="px-3 py-2">{r.store.segment}</td>
                    <td className="px-3 py-2">{r.store.ops_zone}</td>
                    <td className="px-3 py-2">{r.hasPromo ? "Sí" : "No"}</td>
                    <td className="px-3 py-2">{r.numPromos}</td>
                    <td className="px-3 py-2">{r.lastCreated ? formatDate(r.lastCreated) : "—"}</td>
                    <td className="px-3 py-2">{r.gap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (detailView.view === "store") {
      const key = `${detailView.eventId}:${detailView.storeId}`;
      const campList = campaignsByEventAndStore.get(key) ?? [];
      const sorted = [...campList].sort((a, b) => {
        const da = parseDate(a.created_at);
        const db = parseDate(b.created_at);
        return da.getTime() - db.getTime();
      });

      return (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-xs text-slate-100">
            <thead className="bg-slate-900/95">
              <tr>
                <th className="px-3 py-2 text-slate-300">campaign_id</th>
                <th className="px-3 py-2 text-slate-300">created_at</th>
                <th className="px-3 py-2 text-slate-300">start_date</th>
                <th className="px-3 py-2 text-slate-300">status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sorted.map((c) => (
                <tr key={c.campaign_id} className="hover:bg-slate-900/80">
                  <td className="px-3 py-2 font-medium text-slate-50">{c.campaign_id}</td>
                  <td className="px-3 py-2">{formatDate(parseDate(c.created_at))}</td>
                  <td className="px-3 py-2">—</td>
                  <td className="px-3 py-2">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return null;
  })();

  return (
    <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setDetailView(
              detailView.view === "store"
                ? {
                    view: "brand",
                    eventId: detailView.eventId,
                    city: detailView.city,
                    commercial: detailView.commercial,
                    brand: detailView.brand,
                  }
                : detailView.view === "brand"
                  ? {
                      view: "commercial",
                      eventId: detailView.eventId,
                      city: detailView.city,
                      commercial: detailView.commercial,
                    }
                  : detailView.view === "commercial"
                    ? {
                        view: "city",
                        eventId: detailView.eventId,
                        city: detailView.city,
                      }
                    : detailView.view === "city"
                      ? { view: "event", eventId: detailView.eventId }
                      : { view: "list" },
            )
          }
          className="rounded-full border border-slate-600 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500"
        >
          ← Volver
        </button>
        <nav className="flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-600">/</span>}
              <button
                type="button"
                onClick={b.onClick}
                className="hover:text-emerald-300"
              >
                {b.label}
              </button>
            </span>
          ))}
        </nav>
      </div>
      <div className="mt-3">{content}</div>
    </section>
  );
}

type TableViewProps = {
  events: EventWithMetrics[];
  today: Date;
  onSelectEvent?: (eventId: string) => void;
};

function TableView({ events, today, onSelectEvent }: TableViewProps) {
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
                    Nombre <span className="text-[9px]">{sortIndicator("name")}</span>
                  </button>
                </th>
                <th className="px-3 py-2 text-[11px] font-semibold text-slate-300">
                  Descripción
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("start")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Inicio <span className="text-[9px]">{sortIndicator("start")}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("end")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Fin <span className="text-[9px]">{sortIndicator("end")}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("status")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Estado{" "}
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
                    Gap promos{" "}
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
                    Tiendas{" "}
                    <span className="text-[9px]">{sortIndicator("stores")}</span>
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleSortChange("storesPct")}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-300"
                  >
                    Cobertura %{" "}
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
                    Gap tiendas{" "}
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
                    Días al inicio{" "}
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
                const coverage = e.fillRate / 100;
                const showRiskBadge =
                  !timeline.isFinished &&
                  (e.daysToStart <= 7 || timeline.isOngoing);

                let riskLevel: RiskLevel = "none";
                if (showRiskBadge) {
                  if (coverage < 0.1) {
                    riskLevel = "risk";
                  } else if (coverage < 0.3) {
                    riskLevel = "critical";
                  }
                }

                const isRisk = riskLevel === "risk";
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
                        {onSelectEvent ? (
                          <button
                            type="button"
                            onClick={() => onSelectEvent(e.id)}
                            className="min-w-0 truncate text-left text-[12px] font-semibold text-slate-50 underline decoration-slate-500 underline-offset-2 hover:text-emerald-200 hover:decoration-emerald-400"
                          >
                            {e.name}
                          </button>
                        ) : (
                          <span className="min-w-0 truncate text-[12px] font-semibold text-slate-50">
                            {e.name}
                          </span>
                        )}
                        {e.openEvent && (
                          <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-medium leading-none border border-slate-500/20 bg-slate-500/10 text-slate-300">
                            Evento abierto
                          </span>
                        )}
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
  const [storesFile, setStoresFile] = useState<File | null>(null);
  const [eventTargetsFile, setEventTargetsFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showReplace, setShowReplace] = useState(false);
  const [showValidationReport, setShowValidationReport] = useState(false);

  const [detailView, setDetailView] = useState<DetailView>({ view: "list" });

  const [filters, setFilters] = useState<FiltersState>({
    regions: [],
    cities: [],
    commercials: [],
    segments: [],
    opsZones: [],
    brands: [],
  });

  useEffect(() => {
    setToday(new Date());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2);
      const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);

      let parsed: StoredData | null = null;

      if (rawV2) {
        parsed = JSON.parse(rawV2) as StoredData;
      } else if (rawV1) {
        const legacy = JSON.parse(rawV1) as {
          events?: EventCsvRow[];
          campaigns?: CampaignCsvRow[];
          lastUpdated?: string;
        };
        if (Array.isArray(legacy.events) && Array.isArray(legacy.campaigns)) {
          parsed = {
            events: legacy.events,
            campaigns: legacy.campaigns,
            stores: undefined,
            filters: {
              regions: [],
              cities: [],
              commercials: [],
              segments: [],
              opsZones: [],
              brands: [],
            },
            lastUpdated: legacy.lastUpdated ?? new Date().toISOString(),
            version: "v1",
          };
        }
      }

      if (parsed && Array.isArray(parsed.events) && Array.isArray(parsed.campaigns)) {
        setStoredData(parsed);
        if (parsed.filters) {
          setFilters({
            regions: parsed.filters.regions ?? [],
            cities: parsed.filters.cities ?? [],
            commercials: parsed.filters.commercials ?? [],
            segments: parsed.filters.segments ?? [],
            opsZones: parsed.filters.opsZones ?? [],
            brands: parsed.filters.brands ?? [],
          });
        }
      }
    } catch {
      // si hay error de parseo, ignoramos y seguimos sin data
    } finally {
      setInitialized(true);
    }
  }, []);

  const stores = useMemo(() => storedData?.stores ?? [], [storedData?.stores]);
  const hasStores = stores.length > 0;

  const storesById = useMemo(() => {
    const map = new Map<string, StoreCsvRow>();
    if (!hasStores) return map;
    for (const s of stores) {
      map.set(s.store_id, s);
    }
    return map;
  }, [hasStores, stores]);

  const storesByBrand = useMemo(() => {
    const map = new Map<string, StoreCsvRow[]>();
    if (!hasStores) return map;
    for (const s of stores) {
      const list = map.get(s.brand) ?? [];
      list.push(s);
      map.set(s.brand, list);
    }
    return map;
  }, [hasStores, stores]);

  const filteredStoreIds: Set<string> | null = useMemo(() => {
    if (!hasStores) return null;
    const brands = filters.brands ?? [];
    if (
      filters.regions.length === 0 &&
      filters.cities.length === 0 &&
      filters.commercials.length === 0 &&
      filters.segments.length === 0 &&
      filters.opsZones.length === 0 &&
      brands.length === 0
    ) {
      return new Set(stores.map((s) => s.store_id));
    }

    const set = new Set<string>();
    for (const s of stores) {
      if (filters.regions.length > 0 && !filters.regions.includes(s.region)) continue;
      if (filters.cities.length > 0 && !filters.cities.includes(s.city)) continue;
      if (filters.commercials.length > 0 && !filters.commercials.includes(s.commercial)) continue;
      if (filters.segments.length > 0 && !filters.segments.includes(s.segment)) continue;
      if (filters.opsZones.length > 0 && !filters.opsZones.includes(s.ops_zone)) continue;
      if (brands.length > 0 && !brands.includes(s.brand)) continue;
      set.add(s.store_id);
    }
    return set;
  }, [filters, hasStores, stores]);

  const scopeSummary = useMemo(() => {
    const brands = filters.brands ?? [];
    const filtersActive =
      filters.regions.length > 0 ||
      filters.cities.length > 0 ||
      filters.commercials.length > 0 ||
      filters.segments.length > 0 ||
      filters.opsZones.length > 0 ||
      brands.length > 0;
    if (!filtersActive || !filteredStoreIds || !storedData?.campaigns || !today) return null;
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const storesInScope = filteredStoreIds.size;
    const withPromoSet = new Set<string>();
    for (const c of storedData.campaigns) {
      if (!filteredStoreIds.has(c.store_id)) continue;
      try {
        const d = new Date(c.created_at);
        d.setHours(0, 0, 0, 0);
        if (d <= todayStart) withPromoSet.add(c.store_id);
      } catch {
        // skip invalid date
      }
    }
    const storesWithPromo = withPromoSet.size;
    const gap = Math.max(storesInScope - storesWithPromo, 0);
    const singleCity = filters.cities.length === 1 ? filters.cities[0] : null;
    return { storesInScope, storesWithPromo, gap, singleCity };
  }, [filters, filteredStoreIds, storedData?.campaigns, today]);

  const eventsWithMetrics: EventWithMetrics[] = useMemo(() => {
    if (!storedData || !today) return [];
    const options: Parameters<typeof computeEventMetrics>[3] =
      hasStores && storesById.size > 0
        ? {
            storesById,
            allowedStoreIds: filteredStoreIds,
            eventTargets: storedData.event_targets,
          }
        : { eventTargets: storedData.event_targets };
    return computeEventMetrics(
      storedData.events,
      storedData.campaigns,
      today,
      options,
    );
  }, [storedData, today, hasStores, storesById, filteredStoreIds]);

  const eventDeltas = useMemo((): Map<string, EventDeltas> => {
    const map = new Map<string, EventDeltas>();
    if (!today) return map;
    const now = today.getTime();
    const target48 = new Date(now - 48 * 60 * 60 * 1000);
    const target7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
    for (const ev of eventsWithMetrics) {
      const s48 = findClosestSnapshot(ev.id, target48, TOLERANCE_48H_MS);
      const s7 = findClosestSnapshot(ev.id, target7d, TOLERANCE_7D_MS);
      map.set(ev.id, {
        deltaFillRate48h: s48 != null ? ev.fillRate - s48.fill_rate : null,
        deltaFillRate7d: s7 != null ? ev.fillRate - s7.fill_rate : null,
        deltaGmvCoverage48h: s48 != null && ev.gmvTarget > 0 ? ev.gmvCoverage - s48.gmv_coverage : null,
        deltaGmvCoverage7d: s7 != null && ev.gmvTarget > 0 ? ev.gmvCoverage - s7.gmv_coverage : null,
      });
    }
    return map;
  }, [eventsWithMetrics, today]);

  const targetsByEvent = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const targets = storedData?.event_targets ?? [];
    for (const t of targets) {
      if (filteredStoreIds && !filteredStoreIds.has(t.store_id)) continue;
      if (storesById.size > 0 && !storesById.has(t.store_id)) continue;
      let set = map.get(t.event_id);
      if (!set) {
        set = new Set();
        map.set(t.event_id, set);
      }
      set.add(t.store_id);
    }
    return map;
  }, [storedData?.event_targets, filteredStoreIds, storesById]);

  const campaignsByEventId = useMemo(() => {
    const map = new Map<string, { storeId: string; createdAt: Date }[]>();
    const campaigns = storedData?.campaigns ?? [];
    for (const c of campaigns) {
      if (filteredStoreIds && !filteredStoreIds.has(c.store_id)) continue;
      if (storesById.size > 0 && !storesById.has(c.store_id)) continue;
      let createdAt: Date;
      try {
        createdAt = parseDate(c.created_at);
      } catch {
        continue;
      }
      const list = map.get(c.event_id) ?? [];
      list.push({ storeId: c.store_id, createdAt });
      map.set(c.event_id, list);
    }
    return map;
  }, [storedData?.campaigns, filteredStoreIds, storesById]);

  const campaignsByEventAndStore = useMemo(() => {
    const map = new Map<string, CampaignCsvRow[]>();
    const campaigns = storedData?.campaigns ?? [];
    for (const c of campaigns) {
      if (filteredStoreIds && !filteredStoreIds.has(c.store_id)) continue;
      if (storesById.size > 0 && !storesById.has(c.store_id)) continue;
      const key = `${c.event_id}:${c.store_id}`;
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return map;
  }, [storedData?.campaigns, filteredStoreIds, storesById]);

  const handleApplyData = (
    events: EventCsvRow[],
    campaigns: CampaignCsvRow[],
    storesData?: StoreCsvRow[],
    nextFilters?: FiltersState,
    eventTargets?: EventTargetRow[],
    asOfDate?: Date,
  ) => {
    const payload: StoredData = {
      events,
      campaigns,
      stores: storesData,
      event_targets: eventTargets,
      filters:
        nextFilters ??
        (storedData?.filters ?? {
          regions: [],
          cities: [],
          commercials: [],
          segments: [],
          opsZones: [],
          brands: [],
        }),
      lastUpdated: new Date().toISOString(),
      version: eventTargets?.length ? "v3" : storesData?.length ? "v2" : "v1",
    };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(payload));
      window.localStorage.removeItem(STORAGE_KEY_V1);
    }
    setStoredData(payload);
    if (payload.filters) {
      setFilters(payload.filters);
    }
    setError(null);
    setUploadWarnings([]);
    setShowReplace(false);

    const todayForSnapshot = asOfDate ?? new Date();
    const storesByIdForSnapshot = new Map<string, StoreCsvRow>();
    if (storesData?.length) {
      for (const s of storesData) storesByIdForSnapshot.set(s.store_id, s);
    }
    const metricsForSnapshot = computeEventMetrics(
      events,
      campaigns,
      todayForSnapshot,
      {
        storesById: storesByIdForSnapshot.size > 0 ? storesByIdForSnapshot : undefined,
        allowedStoreIds: null,
        eventTargets: eventTargets ?? [],
      },
    );
    saveEventSnapshots(
      metricsForSnapshot.map((m) => ({
        id: m.id,
        targetStores: m.targetStores,
        storesToDate: m.storesToDate,
        fillRate: m.fillRate,
        targetPromos: m.targetPromos,
        promosToDate: m.promosToDate,
        gmvTarget: m.gmvTarget,
        gmvCovered: m.gmvCovered,
        gmvCoverage: m.gmvCoverage,
      })),
    );
  };

  const handleLoadSample = () => {
    handleApplyData(
      SAMPLE_EVENTS,
      SAMPLE_CAMPAIGNS,
      SAMPLE_STORES,
      {
        regions: [],
        cities: [],
        commercials: [],
        segments: [],
        opsZones: [],
        brands: [],
      },
      SAMPLE_EVENT_TARGETS,
      today ?? new Date(),
    );
    setValidationResult(null);
  };

  const handleProcessCsvFiles = async () => {
    if (!eventsFile || !campaignsFile || !storesFile) return;
    setProcessing(true);
    setError(null);
    setValidationResult(null);
    try {
      const filesToRead: Promise<string>[] = [
        eventsFile.text(),
        campaignsFile.text(),
        storesFile.text(),
      ];
      if (eventTargetsFile) {
        filesToRead.push(eventTargetsFile.text());
      }
      const results = await Promise.all(filesToRead);
      const eventsText = results[0];
      const campaignsText = results[1];
      const storesText = results[2];
      const eventTargetsText = results[3];

      const events = parseEventsCsv(eventsText);
      const campaigns = parseCampaignsCsv(campaignsText);
      const storesData = parseStoresCsv(storesText);
      const eventTargets: EventTargetRow[] = eventTargetsText
        ? parseEventTargetsCsv(eventTargetsText)
        : [];

      const validation = validateData(
        events,
        campaigns,
        storesData,
        eventTargets,
      );

      setValidationResult(validation);
      setShowValidationReport(true);

      if (validation.hardErrors.length > 0) {
        setError(
          "Hay errores de validación. Corrige los datos y vuelve a subir. No se activó la carga.",
        );
        return;
      }

      handleApplyData(events, campaigns, storesData, {
        regions: [],
        cities: [],
        commercials: [],
        segments: [],
        opsZones: [],
        brands: [],
      }, eventTargets.length > 0 ? eventTargets : undefined, today ?? new Date());
      setUploadWarnings(validation.warnings);
      setEventsFile(null);
      setCampaignsFile(null);
      setStoresFile(null);
      setEventTargetsFile(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error inesperado al procesar CSV.";
      setError(message);
      setValidationResult(null);
    } finally {
      setProcessing(false);
    }
  };

  const handleClear = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY_V1);
      window.localStorage.removeItem(STORAGE_KEY_V2);
    }
    setStoredData(null);
    setFilters({
      regions: [],
      cities: [],
      commercials: [],
      segments: [],
      opsZones: [],
      brands: [],
    });
    setUploadWarnings([]);
    setValidationResult(null);
    setShowValidationReport(false);
    setShowReplace(false);
  };

  const hasData = storedData !== null && eventsWithMetrics.length > 0;

  const totalEvents = storedData?.events.length ?? 0;
  const totalCampaigns = storedData?.campaigns.length ?? 0;
  const totalStores = storedData?.stores?.length ?? 0;
  const totalEventTargets = storedData?.event_targets?.length ?? 0;

  const hasActiveFilters =
    filters.regions.length > 0 ||
    filters.cities.length > 0 ||
    filters.commercials.length > 0 ||
    filters.segments.length > 0 ||
    filters.opsZones.length > 0 ||
    (filters.brands ?? []).length > 0;

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
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-300">
              stores_mx.csv
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setStoresFile(e.target.files?.[0] ?? null);
              }}
              className="block w-full cursor-pointer rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] file:mr-3 file:rounded-full file:border-0 file:bg-emerald-500 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-slate-950 hover:border-emerald-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-300">
              event_targets_mx.csv (opcional)
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setEventTargetsFile(e.target.files?.[0] ?? null);
              }}
              className="block w-full cursor-pointer rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] file:mr-3 file:rounded-full file:border-0 file:bg-emerald-500 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-slate-950 hover:border-emerald-500"
            />
          </label>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>
            Obligatorios: events_mx.csv, event_campaigns_mx.csv, stores_mx.csv.
            Opcional: event_targets_mx.csv (event_id, store_id).
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleProcessCsvFiles}
            disabled={!eventsFile || !campaignsFile || !storesFile || processing}
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
      {uploadWarnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-300">
          {uploadWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {validationResult && (
        <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
          <button
            type="button"
            onClick={() => setShowValidationReport((v) => !v)}
            className="flex w-full items-center justify-between text-left text-xs font-medium text-slate-200"
          >
            <span>
              Validation Report: {validationResult.hardErrors.length} hard error
              {validationResult.hardErrors.length !== 1 ? "s" : ""},{" "}
              {validationResult.warnings.length} warning
              {validationResult.warnings.length !== 1 ? "s" : ""}
            </span>
            <span className="text-slate-400">
              {showValidationReport ? "▼" : "▶"}
            </span>
          </button>
          {showValidationReport && (
            <div className="mt-2 space-y-2 border-t border-slate-700 pt-2 text-[11px]">
              {validationResult.hardErrors.length > 0 && (
                <div>
                  <p className="font-semibold text-red-300">Hard errors (block load)</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-red-200/90">
                    {validationResult.hardErrors.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
              {validationResult.warnings.length > 0 && (
                <div>
                  <p className="font-semibold text-amber-300">Warnings</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-200/90">
                    {validationResult.warnings.map((msg) => (
                      <li key={msg}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
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
              Panel para GMs: gestiona eventos y cobertura de campañas por ciudad.
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
                Calendario
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
                Tabla
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
                    {totalCampaigns === 1 ? "" : "s"} · {totalStores} tienda
                    {totalStores === 1 ? "" : "s"}
                    {totalEventTargets > 0
                      ? ` · ${totalEventTargets} objetivo${totalEventTargets === 1 ? "" : "s"}`
                      : ""}
                    .
                  </p>
                  {hasActiveFilters && (
                    <p className="text-xs text-amber-200/90">
                      Filtros activos: las métricas solo consideran las tiendas seleccionadas.
                    </p>
                  )}
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
                    {showReplace ? "Cancelar" : "Reemplazar datos"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClear}
                    className="rounded-full border border-red-500/70 bg-red-500/10 px-4 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                  >
                    Borrar datos
                  </button>
                </div>
              </div>
              {showReplace && <UploadArea compact />}
            </section>

            {storedData && !hasStores && (
              <section className="mt-1">
                <div className="rounded-2xl border border-amber-400/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
                  Falta el archivo de tiendas. Sube{" "}
                  <span className="font-mono text-amber-100">
                    stores_mx.csv
                  </span>{" "}
                  para habilitar filtros por tienda. La lógica actual sigue
                  funcionando sin filtros.
                </div>
              </section>
            )}

            {storedData && (
              <FiltersBar
                stores={stores}
                filters={filters}
                onChange={(next) => {
                  setFilters(next);
                  if (storedData) {
                    const nextStored: StoredData = {
                      ...storedData,
                      filters: next,
                      version: storedData.version ?? (hasStores ? "v2" : "v1"),
                    };
                    setStoredData(nextStored);
                    if (typeof window !== "undefined") {
                      window.localStorage.setItem(
                        STORAGE_KEY_V2,
                        JSON.stringify(nextStored),
                      );
                    }
                  }
                }}
                disabled={!hasStores}
              />
            )}

            {scopeSummary && (
              <section className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-4 py-3">
                <p className="text-xs font-medium text-emerald-200/90">
                  {scopeSummary.singleCity ? (
                    <>Vista ciudad: <span className="font-semibold text-emerald-100">{scopeSummary.singleCity}</span></>
                  ) : (
                    "Vista filtrada"
                  )}
                  {" · "}
                  {scopeSummary.storesInScope} tienda{scopeSummary.storesInScope === 1 ? "" : "s"} en alcance
                  {" · "}
                  {scopeSummary.storesWithPromo} con al menos una promo
                  {scopeSummary.gap > 0 && (
                    <> · <span className="text-amber-200">{scopeSummary.gap} sin promo</span></>
                  )}
                </p>
              </section>
            )}

            {detailView.view !== "list" ? (
              <DrilldownPanel
                detailView={detailView}
                setDetailView={setDetailView}
                storedData={storedData!}
                eventsWithMetrics={eventsWithMetrics}
                eventDeltas={eventDeltas}
                stores={stores}
                storesById={storesById}
                storesByBrand={storesByBrand}
                targetsByEvent={targetsByEvent}
                campaignsByEventId={campaignsByEventId}
                campaignsByEventAndStore={campaignsByEventAndStore}
                today={today}
                filteredStoreIds={filteredStoreIds}
              />
            ) : viewMode === "calendar" ? (
              <CalendarView
                events={eventsWithMetrics}
                currentMonth={currentMonth}
                onChangeMonth={setCurrentMonth}
                today={today}
              />
            ) : (
              <TableView
                events={eventsWithMetrics}
                today={today}
                onSelectEvent={(id) =>
                  setDetailView({ view: "event", eventId: id })
                }
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

