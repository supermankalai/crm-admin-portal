"use client";

import { useState } from "react";
import { hourLabel, intensity, WEEKDAYS } from "@/domain/reports";

/** Sequential single-hue steps (blank → strong), mixed with the card colour so dark mode works. */
const STEP_BG = [
  "var(--muted)",
  "color-mix(in oklab, var(--chart-1) 18%, var(--card))",
  "color-mix(in oklab, var(--chart-1) 36%, var(--card))",
  "color-mix(in oklab, var(--chart-1) 55%, var(--card))",
  "color-mix(in oklab, var(--chart-1) 75%, var(--card))",
  "var(--chart-1)",
];

/**
 * Check-ins by weekday (rows) and hour (columns). Hovering a cell shows its exact count; the
 * same data is available as a table for screen readers and printing.
 */
export function Heatmap({ grid, firstHour, lastHour }: { grid: number[][]; firstHour: number; lastHour: number }) {
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const max = Math.max(0, ...grid.flat());
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const hovered = hover ? grid[hover.d][hover.h] : null;

  return (
    <div className="grid gap-3">
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {hover ? (
          <>
            <span className="font-medium text-foreground">
              {WEEKDAYS[hover.d].label} {hourLabel(hover.h)}–{hourLabel((hover.h + 1) % 24)}
            </span>
            : <span className="font-mono font-medium text-foreground tabular-nums">{hovered!.toLocaleString("en-IN")}</span> check-ins
          </>
        ) : (
          "Hover a cell to see the exact count."
        )}
      </p>
      <div className="overflow-x-auto" aria-hidden>
        <div className="grid min-w-[560px] gap-0.5" style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-[10px] text-muted-foreground">
              {h % 2 === firstHour % 2 ? hourLabel(h) : ""}
            </span>
          ))}
          {WEEKDAYS.map((day, d) => (
            <div key={day.label} className="contents">
              <span className="self-center text-xs text-muted-foreground">{day.label}</span>
              {hours.map((h) => (
                <span
                  key={h}
                  className="h-7 rounded-[4px] ring-offset-1 ring-offset-card data-[active=true]:ring-2 data-[active=true]:ring-foreground"
                  style={{ backgroundColor: STEP_BG[intensity(grid[d][h], max)] }}
                  data-active={hover?.d === d && hover?.h === h}
                  onMouseEnter={() => setHover({ d, h })}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden>
        Fewer
        {STEP_BG.slice(1).map((bg) => (
          <span key={bg} className="size-3.5 rounded-[3px]" style={{ backgroundColor: bg }} />
        ))}
        More
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Check-ins by weekday and hour</caption>
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left">Day</th>
                {hours.map((h) => (
                  <th key={h} scope="col" className="p-1 font-normal text-muted-foreground">
                    {hourLabel(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((day, d) => (
                <tr key={day.label} className="border-t">
                  <th scope="row" className="p-1 text-left font-medium">
                    {day.label}
                  </th>
                  {hours.map((h) => (
                    <td key={h} className="p-1 text-center">
                      {grid[d][h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
