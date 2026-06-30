export interface UpdateCheckResult {
  available: boolean;
  version: string | null;
  currentVersion?: string | null;
  canInstall?: boolean;
  error?: string;
}

async function invokeTauri<T>(command: string): Promise<T | null> {
  try {
    const mod = await import('@tauri-apps/api/core');
    return await mod.invoke<T>(command);
  } catch {
    return null;
  }
}

export async function checkHostUpdateStatus(): Promise<UpdateCheckResult | null> {
  try {
    const res = await fetch('/api/update-status', { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as UpdateCheckResult;
  } catch {
    return null;
  }
}

export async function checkForDesktopUpdate(): Promise<UpdateCheckResult | null> {
  const result = await invokeTauri<UpdateCheckResult>('check_for_update_now');
  return result ? { ...result, canInstall: true } : null;
}

export async function installDesktopUpdate(): Promise<boolean> {
  return (await invokeTauri<void>('install_update_now')) !== null;
}
