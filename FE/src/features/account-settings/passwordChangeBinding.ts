import { isOpaqueSecret } from '../../services/passwordChangeEmailApi';

/**
 * The binding secret proves "same browser" for an emailed password-change link.
 * localStorage (not sessionStorage) so the link still works when the mail client
 * opens it in a new tab of the same browser. It is scoped to one user, expires with
 * the server challenge, is replaced by a newer request, and is removed after a
 * successful change only if it is still the one that change used. Failures never
 * remove it (they may belong to an older link). The emailed token is never stored.
 */
const key = (userId: number) => `bckl.passwordChangeBinding.${userId}`;
type Stored = { bindingSecret: string; expiresAt: string };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Returns false when the browser refuses storage: callers must not claim success. */
export function saveBinding(userId: number, value: Stored): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key(userId), JSON.stringify(value));
    return s.getItem(key(userId)) !== null;
  } catch {
    return false;
  }
}

export function loadBinding(userId: number, now = Date.now()): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Stored>;
    const expires = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
    if (!isOpaqueSecret(value.bindingSecret) || !Number.isFinite(expires) || expires <= now) {
      s.removeItem(key(userId));
      return null;
    }
    return value.bindingSecret;
  } catch {
    return null;
  }
}

/** Compare-and-delete: a late result must not erase a newer request's binding. */
export function clearBinding(userId: number, usedSecret: string) {
  try {
    const s = storage();
    const raw = s?.getItem(key(userId));
    if (!s || !raw) return;
    const value = JSON.parse(raw) as Partial<Stored>;
    if (value.bindingSecret === usedSecret) s.removeItem(key(userId));
  } catch {
    /* nothing else to clear */
  }
}
