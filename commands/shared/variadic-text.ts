export function stringFromVariadicArgument(value: unknown): string {
  if (value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(' ');
  }

  return String(value);
}
