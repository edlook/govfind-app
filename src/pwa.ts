interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; listeners.forEach((f) => f()); });
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
export const canInstall = (): boolean => deferred !== null;
export const onInstallChange = (f: () => void): void => { listeners.add(f); };
export async function install(): Promise<void> { if (!deferred) return; await deferred.prompt(); await deferred.userChoice; deferred = null; listeners.forEach((f) => f()); }
