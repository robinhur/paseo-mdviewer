import { Linking, Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface FrameElement {
  style: { [key: string]: string };
  srcdoc: string;
  contentWindow: { postMessage(message: unknown, origin: string): void } | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
interface HostElement {
  appendChild(child: FrameElement): void;
}
interface MessageEventLike {
  source: unknown;
  data: unknown;
}
declare const window: {
  open(url: string, target: string, features: string): unknown;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
};
declare const document: { createElement(tag: "iframe"): FrameElement };

export const supportsFrame = Platform.OS === "web";

export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}

export interface MountedFrame {
  post(message: unknown): void;
  destroy(): void;
}

/** Puts a script-enabled, origin-isolated iframe inside `host` (a react-native-web View node). */
export function mountFrame(
  host: unknown,
  html: string,
  onMessage: (data: unknown) => void,
): MountedFrame | null {
  if (!supportsFrame || !host) return null;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", "Markdown preview");
  Object.assign(frame.style, {
    border: "0",
    width: "100%",
    height: "100%",
    display: "block",
    background: "transparent",
  });
  frame.srcdoc = html;
  const listener = (event: MessageEventLike) => {
    if (event.source === frame.contentWindow) onMessage(event.data);
  };
  window.addEventListener("message", listener);
  (host as HostElement).appendChild(frame);
  return {
    post(message) {
      frame.contentWindow?.postMessage(message, "*");
    },
    destroy() {
      window.removeEventListener("message", listener);
      frame.remove();
    },
  };
}

interface ContextTarget {
  addEventListener(type: "contextmenu", listener: (event: { preventDefault(): void }) => void): void;
  removeEventListener(type: "contextmenu", listener: (event: { preventDefault(): void }) => void): void;
}

/** Calls `handler` on right-click of a react-native-web node, suppressing the browser menu. */
export function onContextMenu(node: unknown, handler: () => void): () => void {
  if (!supportsFrame || !node) return () => undefined;
  const target = node as ContextTarget;
  const listener = (event: { preventDefault(): void }) => {
    event.preventDefault();
    handler();
  };
  target.addEventListener("contextmenu", listener);
  return () => target.removeEventListener("contextmenu", listener);
}
