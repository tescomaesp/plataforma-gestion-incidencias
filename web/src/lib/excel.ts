// Lectura y descarga de Excel. Las librerías se cargan solo cuando se usan.

export type Fila = Record<string, string>;

/** Normaliza un encabezado: "Fecha de compra" → "fecha_de_compra". */
const clave = (s: unknown) => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Convierte una celda en texto. Las fechas salen como AAAA-MM-DD. */
function texto(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/AAAA
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

/**
 * Lee la primera hoja de un Excel y devuelve una fila por línea, con las
 * columnas renombradas según `alias` (encabezado normalizado → nombre interno).
 */
export async function leerExcel(archivo: File, alias: Record<string, string>): Promise<Fila[]> {
  const { readSheet } = await import('read-excel-file/browser');
  const filas = (await readSheet(archivo)) as unknown[][];
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos.');
  const columnas = filas[0].map((h) => alias[clave(h)] ?? null);
  if (!columnas.some(Boolean)) throw new Error('No reconozco las columnas del archivo. Usa la plantilla.');
  return filas.slice(1)
    .filter((f) => f.some((c) => texto(c) !== ''))
    .map((f) => {
      const o: Fila = {};
      columnas.forEach((col, i) => { if (col) o[col] = texto(f[i]); });
      return o;
    });
}

export interface Hoja {
  nombre: string;
  columnas: { titulo: string; ancho?: number; texto?: boolean }[];
  filas: (string | number | null | undefined)[][];
}

/** Descarga un Excel con una o varias hojas. */
export async function descargarExcel(archivo: string, hojas: Hoja[]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = hojas.map((h) => ({
    sheet: h.nombre.slice(0, 31),
    columns: h.columnas.map((c) => ({ width: c.ancho ?? 18 })),
    stickyRowsCount: 1,
    data: [
      h.columnas.map((c) => ({ value: c.titulo, fontWeight: 'bold' as const })),
      ...h.filas.map((f) => f.map((v, i) => {
        // Las referencias se guardan como texto para que Excel no convierta 306048.30 en 306048,3.
        if (h.columnas[i]?.texto) return { value: v == null ? '' : String(v), type: String, format: '@' };
        return v == null || v === '' ? null : { value: v };
      })),
    ],
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeXlsxFile(sheets as any).toFile(archivo);
}
