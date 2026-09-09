import type { World } from "./runtime.ts";

export async function openPage(world: World) {
  const response = await fetch(`${world.baseURL}/`, { signal: AbortSignal.timeout(5_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Root page failed: ${response.status}`);
  world.pageHTML = body;
}

export function getPageHTML(world: World) {
  if (world.pageHTML === undefined) throw new Error("Open the root page before asserting page content");
  return world.pageHTML;
}

function textContent(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractVisibleElements(html: string, tag: string) {
  const elements: string[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    if (/\bhidden\b/i.test(attributes) || /aria-hidden\s*=\s*["']true["']/i.test(attributes)) continue;
    if (/style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes)) continue;
    elements.push(textContent(match[2] ?? ""));
  }
  return elements;
}
