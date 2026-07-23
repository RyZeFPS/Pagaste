import { pickProcessedGroupAvatar } from '@/lib/group-avatar-image';

export async function pickProcessedProfileAvatar(): Promise<string | null> {
  return pickProcessedGroupAvatar();
}
