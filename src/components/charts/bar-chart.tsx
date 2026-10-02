"use client";

import { Bar, BarChart as ReBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Single-series bar chart (one measure → one colour, no legend needed; the card title names it).
 * Hover shows the exact value. Data comes fully computed from the server.
 */
export function BarChart({
  data,
  valueLabel,
  height = 240,
  layout = "horizontal",
}: {
  data: { label: string; value: number }[];
  valueLabel: string;
  height?: number;
  layout?: "horizontal" | "vertical";
}) {
  const vertical = layout === "vertical";
  return (
    <div role="img" aria-label={`${valueLabel}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height={height}>
        <ReBarChart data={data} layout={layout} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={vertical} horizontal={!vertical} stroke="var(--border)" />
          {vertical ? (
            <>
              <XAxis type="number" allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={90} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} width={32} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
            </>
          )}
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                  <div className="font-medium text-foreground">{label ?? payload[0].payload.label}</div>
                  <div className="text-muted-foreground">
                    <span className="font-mono font-medium text-foreground tabular-nums">{payload[0].value}</span> {valueLabel}
                  </div>
                </div>
              ) : null
            }
          />
          <Bar dataKey="value" name={valueLabel} fill="var(--chart-1)" radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={vertical ? 22 : 32} />
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}
