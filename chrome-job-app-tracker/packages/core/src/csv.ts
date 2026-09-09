export interface AppRow {
  date: string;
  company: string;
  role: string;
  track: string;
  region: string;
  status: string;
  url: string;
  folder: string;
}

export const CSV_HEADER = "date,company,role,track,region,status,url,folder";

/** Split one CSV record (no newlines inside — records are split first). */
function parseRecord(rec: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= rec.length) {
    if (rec[i] === '"') {
      let field = "";
      i++;
      while (i < rec.length) {
        if (rec[i] === '"') {
          if (rec[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += rec[i];
          i++;
        }
      }
      fields.push(field);
      if (rec[i] === ",") i++;
      else break;
    } else {
      const j = rec.indexOf(",", i);
      if (j === -1) {
        fields.push(rec.slice(i));
        break;
      }
      fields.push(rec.slice(i, j));
      i = j + 1;
    }
  }
  return fields;
}

/** Split text into records; newlines inside quotes don't split. */
function splitRecords(text: string): string[] {
  const records: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // "" inside a quoted field is an escaped quote, not a boundary.
      if (quoted && text[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        quoted = !quoted;
        cur += c;
      }
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      records.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) records.push(cur);
  return records;
}

export function parseCsv(text: string): { header: string; rows: AppRow[] } {
  const nl = text.indexOf("\n");
  const header = nl === -1 ? text : text.slice(0, nl).replace(/\r$/, "");
  const rest = nl === -1 ? "" : text.slice(nl + 1);
  const rows: AppRow[] = [];
  for (const rec of splitRecords(rest)) {
    if (rec.trim().length === 0) continue;
    const f = parseRecord(rec);
    if (f.length < 8) continue;
    rows.push({
      date: f[0],
      company: f[1],
      role: f[2],
      track: f[3],
      region: f[4],
      status: f[5],
      url: f[6],
      folder: f[7],
    });
  }
  return { header, rows };
}

/** add-job quotes every field, doubling inner quotes. */
export function quoteField(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export function formatRow(r: AppRow): string {
  return [r.date, r.company, r.role, r.track, r.region, r.status, r.url, r.folder]
    .map(quoteField)
    .join(",");
}
