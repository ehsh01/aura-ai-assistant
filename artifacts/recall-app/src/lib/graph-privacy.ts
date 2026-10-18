export function maskGraphDisplayText(value: string): string {
  return value.replace(/(?:\*{4})?\d{5,}/g, (match) => {
    const digits = match.replace(/\*/g, "");
    return `****${digits.slice(-4)}`;
  });
}

export function graphTooltipText(label: string, links: number): string {
  return `${maskGraphDisplayText(label)} · ${links} links`;
}
