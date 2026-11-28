export const objectPrefix = 'catalog/v1/';
export function storageKey(name) {
  return objectPrefix + name + (/\.(ly|xml|musicxml|txt|md)$/.test(name) ? '.gz' : '');
}
