import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Download, Search } from 'lucide-react';

export interface DataTableColumn<T> {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DataTableProps<T extends Record<string, any>> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyField: keyof T;
  searchable?: boolean;
  searchPlaceholder?: string;
  exportFilename?: string;
  className?: string;
  emptyMessage?: string;
  stickyHeader?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportCSV<T extends Record<string, any>>(
  data: T[],
  columns: DataTableColumn<T>[],
  filename: string
) {
  const headers = columns.map(c => c.label).join(',');
  const rows = data.map(row =>
    columns
      .map(col => {
        const val = row[col.key as keyof T];
        if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
        return val ?? '';
      })
      .join(',')
  );
  const csv = [headers, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyField,
  searchable = false,
  searchPlaceholder = 'Search…',
  exportFilename,
  className = '',
  emptyMessage = 'No data',
  stickyHeader = true,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const filtered = useMemo(() => {
    let rows = [...data];
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(row =>
        columns.some(col => {
          const val = row[col.key as keyof T];
          return String(val ?? '').toLowerCase().includes(q);
        })
      );
    }
    if (sortKey) {
      rows.sort((a, b) => {
        const av = a[sortKey as keyof T];
        const bv = b[sortKey as keyof T];
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, columns, search, sortKey, sortDir]);

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>
      {/* Toolbar */}
      {(searchable || exportFilename) && (
        <div className="flex items-center gap-2 p-3 border-b border-slate-100">
          {searchable && (
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          )}
          {exportFilename && (
            <button
              onClick={() => exportCSV(filtered, columns, exportFilename)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 transition"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={`bg-slate-50 ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
            <tr>
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  onClick={col.sortable ? () => handleSort(String(col.key)) : undefined}
                  className={`px-3 py-2 text-left font-semibold text-slate-600 select-none ${col.sortable ? 'cursor-pointer hover:bg-slate-100 transition' : ''} ${col.className ?? ''}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === String(col.key) && (
                      sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={String(row[keyField])}
                  className={`border-t border-slate-100 hover:bg-slate-50 transition ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                >
                  {columns.map(col => (
                    <td key={String(col.key)} className={`px-3 py-2.5 ${col.className ?? ''}`}>
                      {col.render ? col.render(row) : String(row[col.key as keyof T] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="px-3 py-2 border-t border-slate-100 text-[10px] text-slate-400">
          {filtered.length} of {data.length} rows
        </div>
      )}
    </div>
  );
}
