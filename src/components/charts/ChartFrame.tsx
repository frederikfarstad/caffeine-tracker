import type { ReactNode } from 'react'

export type ChartTableRow = { label: string; values: string[] }

/**
 * Shared chart wrapper: legend, plot, and an equivalent table.
 *
 * The table is visually hidden but real, so every chart on the page has a
 * non-visual equivalent rather than relying on the SVG alone.
 */
export function ChartFrame({
  legend,
  title,
  children,
  columns,
  rows,
  footnote,
}: {
  legend: string
  title: string
  children: ReactNode
  columns: string[]
  rows: ChartTableRow[]
  footnote?: ReactNode
}) {
  return (
    <figure className="panel space-y-3 p-4">
      <figcaption className="space-y-1">
        <p className="legend">{legend}</p>
        <h2 className="display text-lg leading-tight tracking-tight text-foam">
          {title}
        </h2>
      </figcaption>

      {children}

      {footnote && <p className="text-xs text-oat">{footnote}</p>}

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Bucket</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((value, index) => (
                <td key={index}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
