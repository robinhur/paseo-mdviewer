import { KATEX_CSS, MERMAID_SCRIPT, MERMAID_VERSION } from "./generated/runtime";

export function loadRuntime() {
  return { script: MERMAID_SCRIPT, css: KATEX_CSS, version: MERMAID_VERSION };
}
