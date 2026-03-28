export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_match, expr: string) => {
    const value = resolvePath(expr.trim(), context);
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

function resolvePath(path: string, context: Record<string, unknown>): unknown {
  // Tokenize the path: split on dots and bracket notation
  // e.g. "messages[0].from" -> ["messages", "0", "from"]
  const segments: string[] = [];

  for (const part of path.split(".")) {
    // Handle bracket notation: "messages[0]" -> "messages", "0"
    const bracketMatch = part.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (bracketMatch) {
      segments.push(bracketMatch[1]);
      if (bracketMatch[2] !== undefined) {
        segments.push(bracketMatch[2]);
      }
    } else {
      segments.push(part);
    }
  }

  let current: unknown = context;
  for (const segment of segments) {
    if (current === undefined || current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
