export type GraphDeviceProfile = {
  reducedMotion: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
};

/**
 * Keep the interactive canvas off devices that explicitly request less motion
 * or expose very limited CPU/RAM. The grid remains the complete browse fallback.
 */
export function shouldUseGridFallback(profile: GraphDeviceProfile): boolean {
  return (
    profile.reducedMotion ||
    (Boolean(profile.hardwareConcurrency) && profile.hardwareConcurrency! <= 2) ||
    (profile.deviceMemory != null && profile.deviceMemory <= 2)
  );
}
