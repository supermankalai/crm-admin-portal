import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useBrand } from "@/hooks/use-brand";

/**
 * Small, accessible building blocks. Touch targets are at least 48pt, every control has a
 * screen-reader role/label, text uses the system font scale, and colours work in light and dark.
 */

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityHint?: string;
  testID?: string;
};

export function Button({ label, onPress, variant = "primary", loading, disabled, icon, accessibilityHint, testID }: ButtonProps) {
  const { brand, onBrand } = useBrand();
  const isDisabled = disabled || loading;
  const styles = {
    primary: { container: "", text: "", bg: brand, fg: onBrand },
    secondary: { container: "border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900", text: "text-zinc-900 dark:text-zinc-50", bg: undefined, fg: undefined },
    ghost: { container: "bg-transparent", text: "text-zinc-700 dark:text-zinc-200", bg: undefined, fg: undefined },
    danger: { container: "bg-red-600", text: "text-white", bg: undefined, fg: undefined },
  }[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-xl px-4 ${styles.container} ${isDisabled ? "opacity-50" : "active:opacity-80"}`}
      style={styles.bg ? { backgroundColor: styles.bg } : undefined}
    >
      {loading ? <ActivityIndicator color={styles.fg ?? undefined} /> : icon ? <Ionicons name={icon} size={20} color={styles.fg ?? (variant === "danger" ? "#fff" : "#71717a")} /> : null}
      <Text className={`text-base font-semibold ${styles.text}`} style={styles.fg ? { color: styles.fg } : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

type FieldProps = TextInputProps & { label: string; error?: string; hint?: string; secureToggle?: boolean };

export const TextField = forwardRef<TextInput, FieldProps>(function TextField({ label, error, hint, secureToggle, secureTextEntry, ...props }, ref) {
  const [hidden, setHidden] = useState(!!secureTextEntry);
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</Text>
      <View className={`min-h-12 flex-row items-center rounded-xl border bg-white px-3 dark:bg-zinc-900 ${error ? "border-red-500" : "border-zinc-300 dark:border-zinc-700"}`}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor="#a1a1aa"
          className="flex-1 py-3 text-base text-zinc-900 dark:text-zinc-50"
          secureTextEntry={hidden}
          {...props}
        />
        {secureToggle && (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? "Show password" : "Hide password"} onPress={() => setHidden((h) => !h)} hitSlop={12} className="p-1">
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color="#71717a" />
          </Pressable>
        )}
      </View>
      {hint && !error ? <Text className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" className="rounded-xl bg-red-50 p-3 dark:bg-red-950">
      <Text className="text-sm text-red-700 dark:text-red-300">{message}</Text>
    </View>
  );
}

export function Banner({ tone, icon, children }: { tone: "info" | "warning" | "danger"; icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  const style = {
    info: "bg-sky-50 dark:bg-sky-950 border-sky-200 dark:border-sky-800",
    warning: "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800",
    danger: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800",
  }[tone];
  const color = { info: "#0369a1", warning: "#b45309", danger: "#b91c1c" }[tone];
  return (
    <View accessibilityRole="alert" className={`flex-row items-start gap-2 border-b px-4 py-2.5 ${style}`}>
      <Ionicons name={icon} size={18} color={color} />
      <Text className="flex-1 text-sm text-zinc-800 dark:text-zinc-100">{children}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; description?: string; action?: ReactNode }) {
  return (
    <View className="items-center gap-3 px-6 py-12">
      <View className="rounded-full bg-zinc-100 p-4 dark:bg-zinc-800">
        <Ionicons name={icon} size={28} color="#71717a" />
      </View>
      <Text accessibilityRole="header" className="text-center text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </Text>
      {description ? <Text className="text-center text-base text-zinc-600 dark:text-zinc-400">{description}</Text> : null}
      {action}
    </View>
  );
}

/** A pulsing placeholder block while data loads. */
export function Skeleton({ className = "h-5 w-full" }: { className?: string }) {
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ opacity }} className={`rounded-lg bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>{children}</View>;
}

export function ListRow({ title, subtitle, icon, onPress, right, accessibilityHint, destructive }: { title: string; subtitle?: string; icon?: keyof typeof Ionicons.glyphMap; onPress?: () => void; right?: ReactNode; accessibilityHint?: string; destructive?: boolean }) {
  const content = (
    <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
      {icon ? <Ionicons name={icon} size={22} color={destructive ? "#dc2626" : "#71717a"} /> : null}
      <View className="flex-1">
        <Text className={`text-base ${destructive ? "text-red-600" : "text-zinc-900 dark:text-zinc-50"}`}>{title}</Text>
        {subtitle ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color="#a1a1aa" /> : null)}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} accessibilityHint={accessibilityHint} onPress={onPress} className="active:bg-zinc-100 dark:active:bg-zinc-800">
      {content}
    </Pressable>
  ) : (
    content
  );
}

/** A single-choice row of chips (filters, payment method, location). */
export function ChipGroup<T extends string | undefined>({ label, options, value, onChange }: { label?: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View className="gap-1.5">
      {label ? <Text className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</Text> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.label}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on, checked: on }}
              onPress={() => onChange(o.value)}
              className={`min-h-11 justify-center rounded-full border px-4 ${on ? "border-zinc-900 bg-zinc-900 dark:border-zinc-50 dark:bg-zinc-50" : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}
            >
              <Text className={on ? "font-semibold text-white dark:text-zinc-900" : "text-zinc-800 dark:text-zinc-200"}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
