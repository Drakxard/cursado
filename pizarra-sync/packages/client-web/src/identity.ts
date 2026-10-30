import { isGeneratedGuestName, pickUserColor, randomGuestName, randomId } from '@komuboard/shared';

export const PROFILE_KEY = 'komuboard-profile';
export interface BoardIdentity {
  id: string;
  name: string;
  color: string;
  photo?: string;
  customized: boolean;
  fresh: boolean;
}
function parse(raw: string | null): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
const name = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 40) : '';
const color = (value: unknown) => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value : '';

export function saveBoardIdentity(identity: BoardIdentity, storage: Storage = localStorage): void {
  // One durable record prevents a partially written name/color/id combination.
  storage.setItem(PROFILE_KEY, JSON.stringify({ version: 1, id: identity.id, name: identity.name, color: identity.color, photo: identity.photo, customized: identity.customized }));
  // Keep the previous keys readable by older tabs and versions.
  storage.setItem('komuboard-uid', identity.id);
  storage.setItem('komuboard-name', identity.name);
  storage.setItem('komuboard-color', identity.color);
  if (identity.photo) storage.setItem('komuboard-photo', identity.photo);
  else storage.removeItem('komuboard-photo');
}

export function loadBoardIdentity(storage: Storage = localStorage, account?: unknown): BoardIdentity {
  const saved = parse(storage.getItem(PROFILE_KEY));
  const previous = parse(storage.getItem('pizarra-perfil-copia'));
  const authenticated = account && typeof account === 'object' ? account as Record<string, unknown> : null;
  const legacy = authenticated && name(authenticated.display_name) ? authenticated : previous;
  const storedName = name(saved?.name) || name(storage.getItem('komuboard-name'));
  const customized = saved?.customized === true || !saved && !!storedName && !isGeneratedGuestName(storedName);
  const restorePrevious = !customized && !!name(legacy?.display_name);
  const displayName = restorePrevious ? name(legacy?.display_name) : storedName;
  const id = typeof saved?.id === 'string' && saved.id ? saved.id : storage.getItem('komuboard-uid') || randomId('u');
  const seed = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const identity: BoardIdentity = {
    id,
    name: displayName || randomGuestName(),
    color: (restorePrevious ? color(legacy?.color) : color(saved?.color) || color(storage.getItem('komuboard-color'))) || pickUserColor(seed),
    photo: typeof saved?.photo === 'string' ? saved.photo : storage.getItem('komuboard-photo') || undefined,
    customized: customized || restorePrevious,
    fresh: !displayName,
  };
  saveBoardIdentity(identity, storage);
  return identity;
}
