// Kleine Hilfen rund um den geladenen Index (Regionsnamen für Hinweise)
import type { DataIndex } from './types';
let idx: DataIndex | null = null;
export const setIndexForNotes = (i: DataIndex): void => { idx = i; };
export const allRegionNames = (): string => (idx?.regions.map((r) => r.name).join(', ') ?? '');
