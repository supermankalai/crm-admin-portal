import { onColor, safeBrand } from "@/lib/colors";
import { useSession } from "./use-session";

/** The selected gym's brand colour and a readable text colour to put on it. */
export function useBrand(override?: string | null) {
  const { gym } = useSession();
  const brand = safeBrand(override ?? gym?.brandColor);
  return { brand, onBrand: onColor(brand) };
}
