# Blitz Planning — project conventions

## Stack

Single-file PWA: `public/index.html`  
Serverless backend: `netlify/functions/` (ES modules, Netlify Blobs `blitz-data` store, `consistency: 'strong'`)

## Excel exports (browser-side)

**Use ExcelJS, not SheetJS.**  
SheetJS community edition (v0.18.5, the free build) silently ignores the `.s` cell style property — styled output looks completely unstyled with no error. ExcelJS supports full cell styling.

```html
<script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>
```

All Excel exports must auto-size columns and rows so all text is always visible:
- Dynamic column width: `max(header_length + 2, max_data_length + 1, 8)`, capped at 36 (non-wrap) or `WRAP_MAX` for wrap columns
- Dynamic row height: `Math.ceil(text.length / (colWidth * 1.15)) * 14 + 2`

## TicketLog export — field mappings

| Excel column | Source field | Values |
|---|---|---|
| Type | `rd.interventieType` | Interventie / Installatie |
| Prio | `rd.prioriteit` / `_wizTicket.priority` | Laag / Middel / Hoog |
| Notities | `rd.probleem` | vrije tekst (gerapporteerd probleem) |
| Actie | `rd.acties` | vrije tekst (uitgevoerde werkzaamheden) |

**Type is NOT the charger hardware type** — it is the visit type (Interventie vs Installatie), stored in `R.interventieType`.

## Rapport wizard — R object key fields

- `R.interventieType` — "Interventie" | "Installatie" (type bezoek, radio in stap Algemeen)
- `R.probleem` — gerapporteerd probleem (Notities in TicketLog)
- `R.acties` — uitgevoerde acties (Actie in TicketLog)
- `R.prioriteit` — comes from `_wizTicket.priority`, stored in archief POST body
- Installateur betrokken: leeg = "Nee", gevuld = "Ja" (source: `rd.installateur`)
