import type { PressableStateCallbackType } from "react-native";

/** react-native-web adds `hovered` to the Pressable state; native platforms leave it out. */
export function isHovered(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}
