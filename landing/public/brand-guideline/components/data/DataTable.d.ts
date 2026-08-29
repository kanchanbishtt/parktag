import * as React from "react";

/**
 * @startingPoint section="Surfaces" subtitle="Admin E-Tags table" viewport="700x220"
 */
export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column headers — rendered uppercase 0.72rem on a #FAFBFC strip. */
  columns: string[];
  /** Row cells, already formatted (pass <Pill />/<Badge /> nodes for status cells). */
  rows: React.ReactNode[][];
  /** Min table width before horizontal scroll kicks in. Default 860px. */
  minWidth?: string | number;
}

export declare function DataTable(props: DataTableProps): JSX.Element;
