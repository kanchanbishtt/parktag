import React from "react";

export function DataTable({ columns, rows, minWidth = "var(--table-min-width)", style, ...rest }) {
  return (
    <div style={{ overflow: "auto", ...style }} {...rest}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)", minWidth }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                style={{
                  textAlign: "left",
                  padding: "11px 12px",
                  borderBottom: "1px solid var(--pt-hairline)",
                  whiteSpace: "nowrap",
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--text-admin-faint)",
                  background: "var(--pt-gray-50)",
                  fontWeight: "var(--weight-bold)",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: "11px 12px",
                    borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--pt-hairline)",
                    whiteSpace: "nowrap",
                    color: "var(--text-strong)",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
