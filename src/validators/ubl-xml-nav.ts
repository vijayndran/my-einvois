/**
 * Minimal DOM navigation for UBL 2.1 XML documents.
 *
 * MyInvois XML consistently uses the "cac:" / "cbc:" prefixes for the core
 * document (and "ext:" / "sig:" / "sac:" / "sbc:" / "ds:" / "xades:" for the
 * digital signature block) exactly as shown in LHDN's own sample files.
 * Rather than doing fully namespace-URI-aware lookups (which would need a
 * namespace-aware query layer on top of whichever DOM implementation is
 * running -- the browser's native DOMParser, or a Node.js polyfill for
 * tests), this module matches on the literal tag name as written in the
 * source markup. That mirrors exactly how LHDN's own samples are authored
 * and is sufficient for a document-shape validator like this one; it is
 * not a fully general UBL/XML processor.
 */

type DomLike = {
  nodeType: number;
  nodeName?: string;
  tagName?: string;
  childNodes?: ArrayLike<DomLike>;
  textContent?: string | null;
  getAttribute?: (name: string) => string | null;
};

const ELEMENT_NODE = 1;

function isElement(node: DomLike | null | undefined): node is DomLike {
  return !!node && node.nodeType === ELEMENT_NODE;
}

function nameOf(node: DomLike): string | undefined {
  return node.tagName ?? node.nodeName;
}

export function children(parent: DomLike | null | undefined, tagName: string): DomLike[] {
  if (!parent?.childNodes) return [];
  const out: DomLike[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (isElement(node) && nameOf(node) === tagName) out.push(node);
  }
  return out;
}

export function child(parent: DomLike | null | undefined, tagName: string): DomLike | undefined {
  return children(parent, tagName)[0];
}

export function text(el: DomLike | null | undefined): string | undefined {
  if (!el) return undefined;
  const t = el.textContent?.trim();
  return t === "" ? undefined : t;
}

export function textOf(parent: DomLike | null | undefined, tagName: string): string | undefined {
  return text(child(parent, tagName));
}

export function numOf(parent: DomLike | null | undefined, tagName: string): number | undefined {
  const t = textOf(parent, tagName);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

export function attrOf(el: DomLike | null | undefined, name: string): string | undefined {
  if (!el?.getAttribute) return undefined;
  const v = el.getAttribute(name);
  return v === null ? undefined : v;
}

export type { DomLike };
