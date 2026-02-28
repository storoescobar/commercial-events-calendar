## Commercial Events Calendar (MX)

MVP **read-only** construido con **Next.js (App Router) + TypeScript + Tailwind** para explorar un calendario comercial en dos vistas:

- **Calendar**: vista mensual con barras por evento en sus fechas.
- **Table**: tabla detallada con métricas agregadas por evento.

La data se carga desde dos archivos CSV locales:

- `events_mx.csv`
- `event_campaigns_mx.csv`

y se persiste en `localStorage` bajo la llave:

```text
commercial_calendar_mx_v1
```

## Getting Started

### 1. Instalar dependencias

```bash
npm install
```

### 2. Levantar el servidor de desarrollo

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Flujo de uso

### 1. Carga de datos inicial

Al abrir la app:

- Si **no hay datos** en `localStorage`, verás una pantalla de carga con:
  - Inputs para subir `events_mx.csv` y `event_campaigns_mx.csv`.
  - Botón **"Load sample data"** que usa los mocks incluidos en el código.
- Si **ya hay datos** guardados, verás:
  - Un banner con:
    - Número total de eventos.
    - Número total de campañas.
    - `lastUpdated` (fecha/hora de la última carga).
  - Botones:
    - **"Replace data"**: permite volver a subir ambos CSV y reemplazar la data.
    - **"Clear data"**: limpia `localStorage` y vuelve al estado inicial.

### 2. Formato esperado de CSV

#### `events_mx.csv`

Debe tener, al menos, las siguientes columnas (encabezados exactos, case-insensitive):

- `event_id`
- `event_name`
- `description`
- `start_date` (YYYY-MM-DD)
- `end_date` (YYYY-MM-DD)
- `status`
- `target_promos`
- `target_stores`

#### `event_campaigns_mx.csv`

Columnas requeridas:

- `campaign_id`
- `event_id`
- `store_id`
- `created_at` (YYYY-MM-DD)

#### `stores_mx.csv`

Columnas requeridas:

- `store_id`
- `brand` (obligatorio; cada tienda pertenece a una sola marca)
- `region`
- `city`
- `commercial`
- `segment`
- `ops_zone`
- `gmv_last_30d` (numérico, obligatorio; no negativo)
- `gmv_last_7d` (numérico, opcional; no negativo)

#### `event_targets_mx.csv` (V3, opcional)

Columnas: `event_id`, `store_id`. Una fila = una tienda elegible para un evento. Si no se carga, los eventos se tratan como "Open Event" (target_stores del CSV de eventos).

### 3. Validación (V3)

Al procesar los CSV se ejecuta una validación estricta:

- **Errores bloqueantes** (impiden activar la carga): `event_id` o `store_id` duplicados; referencias a eventos o tiendas inexistentes; fechas inválidas; `campaign_id` duplicado; `store_id` duplicado en stores; `brand` faltante o vacío en stores; `gmv_last_30d` faltante, no numérico o negativo en stores.
- **Advertencias** (no bloquean): `target_stores` distinto al conteo de `event_targets`; campañas con `created_at` fuera del rango del evento; eventos sin `event_targets` (Open Event); marca con tiendas objetivo en un evento pero sin campañas.

Si hay errores bloqueantes, se muestra el **Validation Report** y no se activa la data hasta corregir.

### 4. Lógica de negocio principal

- Un evento aparece en un mes si:

  \[
  start\_date \leq month\_end \quad \text{AND} \quad end\_date \geq month\_start
  \]

- Para cada evento se calculan:
  - `promos_to_date`: número de campañas con `created_at <= hoy` (fecha del cliente).
  - `stores_to_date`: número de tiendas únicas (`store_id`) con `created_at <= hoy`.
  - `promos_pct`: `promos_to_date / target_promos`.
  - `stores_pct`: `stores_to_date / target_stores`.
  - `gap_promos`: `max(target_promos - promos_to_date, 0)`.
  - `gap_stores`: `max(target_stores - stores_to_date, 0)`.
  - `days_to_start`: días (puede ser negativo) desde hoy a `start_date`.

**V3 – Fill rate:** Si el evento tiene `event_targets`, `target_stores` = conteo de targets para ese evento (respeta filtros). `fill_rate` = tiendas con promo / target_stores. La lógica de riesgo usa `fill_rate`. Sin targets se usa `event.target_stores` y se marca "Open Event".

### 5. Filtros globales (V2)

- Filtros por dimensión de tienda:
  - Region
  - City
  - Ops Zone
  - Commercial
  - Segment
- Comportamiento:
  - Los filtros se aplican **tanto a la vista Calendar como a Table**.
  - Se construye un subconjunto de tiendas (`filteredStores`) y solo se consideran campañas cuya `store_id` está en ese subconjunto.
  - Las métricas por evento (`promos_to_date`, `stores_to_date`, `%`, gaps, riesgo) se recalculan en función de ese subconjunto filtrado.
  - Si no se carga `stores_mx.csv`, los filtros se deshabilitan y la app funciona como en V1.

### 6. Vista Calendar

- Grid mensual.
- Un evento se dibuja en todas las fechas que esté activo dentro del mes seleccionado.
- Cada barra muestra:

  ```text
  event_name promos_to_date/target_promos (xx%)
  ```

- Manejo de solapes:
  - Se muestran hasta **3 barras por día**.
  - Si hay más, aparece un botón **`+N más`** que abre un pequeño popover de lista (sin hover, solo click).

### 7. Vista Table

- Columnas:
  - Event Name
  - Description
  - Start
  - End
  - Status
  - Promos
  - Promos %
  - Gap Promos
  - Stores
  - Stores %
  - Gap Stores
  - Days to Start
- Funcionalidad:
  - **Search** por nombre del evento.
  - **Sort** haciendo click en los encabezados.
  - **Export CSV** con el contenido actual de la tabla (filtrado + ordenado).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

**UX polish applied**: date labels en `Days to Start`, risk badges por nivel de cobertura de promos, y color coding en el calendario basado en `promos_pct`.

**V2 filters & stores**: soporte de `stores_mx.csv`, filtros globales por dimensión de tienda y recálculo de métricas.

**V3 Control Tower**: `event_targets_mx.csv`, validación estricta con reporte (errores/warnings), fill rate por targets, badges "Open Event", y drilldown Events → Event → City → Commercial → Brand → Store con métricas por nivel y breadcrumb. **V3.5**: dimensión Brand en la jerarquía; `stores_mx.csv` con columna `brand` obligatoria; pestaña Brands en EventDetail; CommercialDetail agrupa por Brand con badges de penetración; vista BrandDetail con tiendas y toggle "solo sin promo". **V4**: Executive Summary en EventDetail (fill rate, promos, GMV cobertura, top 3 ciudades/marcas); `stores_mx.csv` con `gmv_last_30d` (obligatorio) y `gmv_last_7d` (opcional); métricas GMV por evento y por marca; filtro global por Marca y búsqueda en dropdowns de filtros; Exportar tiendas sin promo (CSV) en CommercialDetail y BrandDetail; orden por GMV gap en tablas de marcas. **V4.1**: snapshots locales en localStorage (últimos 30 días o 2000 filas); deltas vs 48h y 7d (fill rate y GMV cobertura) en el Executive Summary; columnas GMV (objetivo, cubierto, cobertura %, gap) en tablas Ciudad y Comercial; deduplicación de snapshots dentro de 30 min por evento.
