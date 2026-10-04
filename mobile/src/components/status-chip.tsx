import { Text, View } from "react-native";

const TONES = {
  green: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300",
  amber: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300",
  red: "bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300",
  sky: "bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300",
  zinc: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
} as const;

/** A small label. Colour is never the only signal: the text says the state. */
export function StatusChip({ label, tone }: { label: string; tone: keyof typeof TONES }) {
  const [bg, darkBg, fg, darkFg] = TONES[tone].split(" ");
  return (
    <View className={`self-start rounded-full px-2.5 py-0.5 ${bg} ${darkBg}`}>
      <Text className={`text-xs font-semibold ${fg} ${darkFg}`}>{label}</Text>
    </View>
  );
}

export const MEMBERSHIP_STATE: Record<string, { label: string; tone: keyof typeof TONES }> = {
  active: { label: "Active", tone: "green" },
  frozen: { label: "Frozen", tone: "sky" },
  upcoming: { label: "Starts soon", tone: "sky" },
  expired: { label: "Expired", tone: "red" },
  cancelled: { label: "Cancelled", tone: "zinc" },
};
