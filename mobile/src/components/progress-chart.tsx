import { useState } from "react";
import { Text, useColorScheme, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { chartScale } from "@/lib/fitness";
import { date as formatDate } from "@/lib/format";

/**
 * One measurement over time: a 2px line, an end dot, three hairline gridlines and min/max labels.
 * Press and drag to scrub — a crosshair snaps to the nearest measurement and shows its value.
 * Single series, so no legend: the title above names it. The list of entries under the chart is
 * its table view, and screen readers get a summary.
 */

// Validated single-series colour (dataviz palette slot 1), stepped for each mode.
const COLORS = {
  light: { series: "#2a78d6", grid: "#e4e4e7", surface: "#ffffff", crosshair: "#a1a1aa" },
  dark: { series: "#3987e5", grid: "#27272a", surface: "#18181b", crosshair: "#52525b" },
};
const HEIGHT = 160;
const PAD_X = 8;

export function ProgressChart({ points, unit, label }: { points: { date: string; value: number }[]; unit: string; label: string }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const c = COLORS[scheme];
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) return null;
  const { lo, hi, y } = chartScale(points.map((p) => p.value), HEIGHT);
  const plotW = Math.max(width - PAD_X * 2, 1);
  const x = (i: number) => PAD_X + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  const first = points[0];
  const latest = points[last];
  const change = Math.round((latest.value - first.value) * 10) / 10;
  const summary = `${label} chart: ${first.value} ${unit} on ${formatDate(first.date)}, ${latest.value} ${unit} on ${formatDate(latest.date)}${points.length > 1 ? `, a change of ${change > 0 ? "plus" : change < 0 ? "minus" : ""} ${Math.abs(change)} ${unit}` : ""}.`;

  const scrub = (e: GestureResponderEvent) => {
    const px = e.nativeEvent.locationX;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };
  const shown = active ?? last;
  const grid = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} className="gap-1">
      <View className="h-5 flex-row items-baseline justify-between">
        <Text className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {points[shown].value} {unit}
        </Text>
        <Text className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(points[shown].date)}</Text>
      </View>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={scrub}
        onResponderMove={scrub}
        onResponderRelease={() => setActive(null)}
        onResponderTerminate={() => setActive(null)}
        style={{ height: HEIGHT }}
      >
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {grid.map((g) => (
              <Line key={g} x1={0} x2={width} y1={y(g)} y2={y(g)} stroke={c.grid} strokeWidth={1} />
            ))}
            <Path d={d} stroke={c.series} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {active !== null ? <Line x1={x(active)} x2={x(active)} y1={0} y2={HEIGHT} stroke={c.crosshair} strokeWidth={1} /> : null}
            <Circle cx={x(shown)} cy={y(points[shown].value)} r={4} fill={c.series} stroke={c.surface} strokeWidth={2} />
          </Svg>
        ) : null}
        <Text className="absolute right-0 top-0 text-[10px] text-zinc-500 dark:text-zinc-400">{Math.round(grid[2] * 10) / 10}</Text>
        <Text className="absolute bottom-0 right-0 text-[10px] text-zinc-500 dark:text-zinc-400">{Math.round(grid[0] * 10) / 10}</Text>
      </View>
      <View className="flex-row justify-between">
        <Text className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(first.date)}</Text>
        {points.length > 1 ? <Text className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(latest.date)}</Text> : null}
      </View>
    </View>
  );
}
