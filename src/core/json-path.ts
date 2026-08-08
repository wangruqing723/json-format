export function propertyPath(parent: string, key: string, isArray: boolean): string {
  if (isArray) return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}
