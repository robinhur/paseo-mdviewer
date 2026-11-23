import { KATEX_CSS, MERMAID_SCRIPT, MERMAID_VERSION, PURIFY_SCRIPT } from "./generated/runtime";

/** Browser runtimes the preview frame loads: Mermaid, DOMPurify and the KaTeX stylesheet. */
export function loadRuntime() {
  return { script: MERMAID_SCRIPT, purify: PURIFY_SCRIPT, css: KATEX_CSS, version: MERMAID_VERSION };
}
