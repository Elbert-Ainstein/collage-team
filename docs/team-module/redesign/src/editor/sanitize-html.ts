const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'SPAN',
  'DIV',
  'P',
  'H1',
  'H2',
  'H3',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'A',
  'CODE',
  'BR',
  'FONT',
])

const ALLOWED_STYLES = new Set(['background-color', 'text-align', 'color'])

function cleanElement(el: Element): void {
  if (!ALLOWED_TAGS.has(el.tagName)) {
    // unwrap unknown elements, keeping their children
    const parent = el.parentNode
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    }
    return
  }
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'style') {
      const kept = attr.value
        .split(';')
        .map((rule) => rule.trim())
        .filter((rule) => ALLOWED_STYLES.has(rule.split(':')[0]?.trim().toLowerCase() ?? ''))
        .join('; ')
      if (kept) el.setAttribute('style', kept)
      else el.removeAttribute('style')
    } else if (attr.name === 'href' && el.tagName === 'A') {
      const href = attr.value.trim()
      if (!/^https?:\/\//i.test(href)) el.removeAttribute('href')
    } else {
      el.removeAttribute(attr.name)
    }
  }
}

/**
 * Allowlist sanitizer for the rich-text HTML kept in text nodes. Strips
 * scripts, event handlers, and any tag/attribute outside the formatting the
 * floating toolbar can produce.
 */
export function sanitizeHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const walker = template.content.querySelectorAll('*')
  // iterate a static list; cleanElement may detach nodes
  for (const el of Array.from(walker)) cleanElement(el)
  return template.innerHTML
}
