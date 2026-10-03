import { useNetInfo } from "@react-native-community/netinfo";

/** True unless the device is known to be offline (unknown counts as online). */
export function useOnline(): boolean {
  const net = useNetInfo();
  return net.isConnected !== false;
}
