import { Screen } from "./screen";
import { EmptyState } from "./ui";
import type Ionicons from "@expo/vector-icons/Ionicons";

/** Placeholder for a tab whose feature arrives in a later phase. */
export function ComingSoon({ title, icon, phase, what }: { title: string; icon: keyof typeof Ionicons.glyphMap; phase: number; what: string }) {
  return (
    <Screen title={title}>
      <EmptyState icon={icon} title={`${title} is coming soon`} description={`${what} (mobile phase ${phase}).`} />
    </Screen>
  );
}
