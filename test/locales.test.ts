import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../client/locales/en";
import { ko } from "../client/locales/ko";
import { DEFAULT_STRINGS } from "../client/shell";

type Resource = { readonly [key: string]: string | Resource };

function flatten(resource: Resource, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(resource)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else for (const [k, v] of flatten(value, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map((m) => m[1]).sort();
}

// Paseo rejects a translation with unknown keys or different placeholders when the plugin loads,
// which would stop the whole client from starting.
test("Korean text uses only English keys, with the same placeholders", () => {
  const base = flatten(en);
  const translated = flatten(ko);
  for (const [key, value] of translated) {
    assert.ok(base.has(key), `unknown key ${key}`);
    assert.deepEqual(placeholders(value), placeholders(base.get(key)!), `placeholders differ in ${key}`);
    assert.ok(value.trim().length > 0, `empty text for ${key}`);
  }
});

test("Korean text covers every English key", () => {
  const translated = flatten(ko);
  const missing = [...flatten(en).keys()].filter((key) => !translated.has(key));
  assert.deepEqual(missing, []);
});

test("the preview frame's built-in text matches the English resource", () => {
  assert.deepEqual({ ...en.frame }, DEFAULT_STRINGS);
});
