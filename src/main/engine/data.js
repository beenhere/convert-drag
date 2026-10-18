'use strict';

const fs = require('node:fs/promises');
const Papa = require('papaparse');
const { outputFor } = require('./naming');
const { formatOfPath } = require('../catalog');
const { escapeHtml } = require('./docs');

/** Read a table as {headers, rows} where rows are arrays of strings. */
async function readTable(src) {
  const fmt = formatOfPath(src);
  if (fmt === 'xlsx') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(src);
    const ws = wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const all = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      for (let c = 1; c <= ws.columnCount; c++) values.push(cellText(row.getCell(c).value));
      all.push(values);
    });
    return { headers: all[0] || [], rows: all.slice(1) };
  }
  const text = (await fs.readFile(src, 'utf8')).replace(/^﻿/, '');
  if (fmt === 'json') return fromJson(JSON.parse(text));
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy', delimiter: fmt === 'tsv' ? '\t' : '' });
  const all = parsed.data.map((r) => r.map((v) => String(v ?? '')));
  return { headers: all[0] || [], rows: all.slice(1) };
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('error' in v) return String(v.error);
    return JSON.stringify(v);
  }
  return String(v);
}

function fromJson(data) {
  if (!Array.isArray(data)) {
    // {key: [..]} -> the first array; a single object -> one row.
    const arr = data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : null;
    data = arr || [data];
  }
  if (data.every(Array.isArray)) return { headers: (data[0] || []).map(String), rows: data.slice(1).map((r) => r.map(stringify)) };
  const headers = [];
  for (const row of data) if (row && typeof row === 'object') for (const k of Object.keys(row)) if (!headers.includes(k)) headers.push(k);
  if (!headers.length) return { headers: ['value'], rows: data.map((v) => [stringify(v)]) };
  return { headers, rows: data.map((row) => headers.map((h) => stringify(row?.[h]))) };
}

function stringify(v) {
  if (v == null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Turn numeric-looking strings back into numbers for JSON/XLSX output. */
function typed(v) {
  if (v === '') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(v) && v.length < 16) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  return v;
}

async function writeTable(table, target, out) {
  const { headers, rows } = table;
  switch (target) {
    case 'csv':
    case 'tsv':
      await fs.writeFile(out, Papa.unparse([headers, ...rows], { delimiter: target === 'tsv' ? '\t' : ',', newline: '\n' }) + '\n');
      return;
    case 'json': {
      const objects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h || `column${i + 1}`, typed(r[i] ?? '')])));
      await fs.writeFile(out, JSON.stringify(objects, null, 2) + '\n');
      return;
    }
    case 'xlsx': {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(headers);
      ws.getRow(1).font = { bold: true };
      for (const r of rows) ws.addRow(r.map(typed));
      ws.columns.forEach((col, i) => {
        const longest = Math.max(String(headers[i] ?? '').length, ...rows.slice(0, 500).map((r) => String(r[i] ?? '').length));
        col.width = Math.min(60, Math.max(8, longest + 2));
      });
      await wb.xlsx.writeFile(out);
      return;
    }
    case 'md': {
      const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
      const cols = Math.max(headers.length, ...rows.map((r) => r.length));
      const line = (r) => `| ${Array.from({ length: cols }, (_, i) => cell(r[i])).join(' | ')} |`;
      await fs.writeFile(out, [line(headers), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.map(line)].join('\n') + '\n');
      return;
    }
    case 'html': {
      const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
      const trs = rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('\n');
      const css = 'body{font:14px -apple-system,Segoe UI,Arial,sans-serif;margin:24px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f3f3f3}';
      await fs.writeFile(out, `<!doctype html><meta charset="utf-8"><style>${css}</style><table><thead><tr>${th}</tr></thead><tbody>\n${trs}\n</tbody></table>\n`);
      return;
    }
    default:
      throw new Error(`Can't convert tables to ${target.toUpperCase()}`);
  }
}

async function convert(src, target, ctx) {
  const table = await readTable(src);
  const out = outputFor(src, { ext: target, outDir: ctx.outDir });
  await writeTable(table, target, out);
  return out;
}

module.exports = { convert, readTable, writeTable };
