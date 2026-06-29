export interface UpdateCheckResult {
  available: boolean;
  version: string | null;
}

async function invokeTauri<T>(command: string): Promise<T | null> {
  try {
    const mod = await import('@tauri-apps/api/core');
    return await mod.invoke<T>(command);
  } catch {
    return null;
  }
}

export async function checkForDesktopUpdate(): Promise<UpdateCheckResult | null> {
  return invokeTauri<UpdateCheckResult>('check_for_update_now');
}

export async function installDesktopUpdate(): Promise<boolean> {
  return (await invokeTauri<void>('install_update_now')) !== null;
}
