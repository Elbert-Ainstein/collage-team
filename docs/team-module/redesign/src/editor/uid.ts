let counter = 0

/** Small unique id generator for doc nodes and sub-items. */
export function uid(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}
