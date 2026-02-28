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

### 3. Lógica de negocio principal

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

### 4. Vista Calendar

- Grid mensual.
- Un evento se dibuja en todas las fechas que esté activo dentro del mes seleccionado.
- Cada barra muestra:

  ```text
  event_name promos_to_date/target_promos (xx%)
  ```

- Manejo de solapes:
  - Se muestran hasta **3 barras por día**.
  - Si hay más, aparece un botón **`+N más`** que abre un pequeño popover de lista (sin hover, solo click).

### 5. Vista Table

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
