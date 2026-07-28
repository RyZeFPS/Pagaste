import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppButton, AppInput, AppText, Card, ScreenContainer } from '@/components/ui';
import { PageHeader, RequireAuth } from '@/components/app-shell';
import { GroupAvatarPicker } from '@/components/group-avatar-picker';
import { useI18n } from '@/i18n';
import { pickProcessedGroupAvatar } from '@/lib/group-avatar-image';
import { repository } from '@/lib/repository';
import { useAuth } from '@/providers/auth-provider';
import { useAppColors } from '@/providers/app-providers';
import { radii, spacing } from '@/theme';

const groupTypes = ['friends', 'couple', 'household', 'trip', 'work', 'family', 'other'] as const;

export default function NewGroupScreen() {
  return (
    <RequireAuth>
      <NewGroupContent />
    </RequireAuth>
  );
}

function NewGroupContent() {
  const auth = useAuth();
  const router = useRouter();
  const palette = useAppColors();
  const { t } = useI18n();
  const cache = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('friends');
  const [avatarUri, setAvatarUri] = useState<string>();
  const [selectingPhoto, setSelectingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string>();
  const [error, setError] = useState<string>();

  const pickAvatar = async () => {
    setPhotoError(undefined);
    setSelectingPhoto(true);
    try {
      const nextUri = await pickProcessedGroupAvatar();
      if (nextUri) setAvatarUri(nextUri);
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : t('groups.avatarPrepareError'));
    } finally {
      setSelectingPhoto(false);
    }
  };

  const create = useMutation({
    mutationFn: async () => {
      setError(undefined);
      if (!auth.user) throw new Error(t('groups.authError'));
      if (name.trim().length < 2) throw new Error(t('groups.nameError'));
      const group = await repository.createGroup(auth.user.id, {
        name: name.trim(),
        description: description.trim(),
        type,
        currency: auth.profile?.default_currency || 'EUR',
      });

      if (!avatarUri) return { group, avatarUploadFailed: false };
      try {
        return {
          group: await repository.uploadGroupAvatar(group.id, avatarUri),
          avatarUploadFailed: false,
        };
      } catch {
        return { group, avatarUploadFailed: true };
      }
    },
    onSuccess: async ({ group, avatarUploadFailed }) => {
      await cache.invalidateQueries({ queryKey: ['groups'] });
      router.replace({
        pathname: '/group/[groupId]',
        params: {
          groupId: group.id,
          ...(avatarUploadFailed ? { avatarUploadFailed: '1' } : {}),
        },
      });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t('groups.createError')),
  });

  return (
    <ScreenContainer>
      <View style={styles.screen}>
        <PageHeader title={t('groups.newTitle')} subtitle={t('groups.newSubtitle')} />

        <View style={styles.intro}>
          <GroupAvatarPicker
            name={name.trim() || t('groups.newAvatarName')}
            uri={avatarUri}
            size={84}
            busy={selectingPhoto || create.isPending}
            onPick={() => void pickAvatar()}
            onRemove={avatarUri ? () => setAvatarUri(undefined) : undefined}
          />
          <AppText variant="bodySmall" color={palette.textSecondary} style={styles.introText}>
            {t('groups.newInviteHint')}
          </AppText>
          {photoError ? (
            <View style={[styles.error, { backgroundColor: palette.dangerLight }]}>
              <AppText variant="bodySmall" color={palette.dangerInk}>
                {photoError}
              </AppText>
            </View>
          ) : null}
        </View>

        <Card variant="elevated" padding="spacious" style={styles.formCard}>
          <AppInput
            label={t('groups.name')}
            placeholder={t('groups.namePlaceholder')}
            value={name}
            maxLength={60}
            autoFocus
            onChangeText={setName}
          />
          <AppInput
            label={t('groups.description')}
            placeholder={t('groups.descriptionPlaceholder')}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={180}
            style={styles.descriptionInput}
          />

          <View style={styles.typeSection}>
            <View style={styles.typeHeading}>
              <AppText variant="label">{t('groups.type')}</AppText>
              <AppText variant="caption" color={palette.textSecondary}>
                {t('groups.typeHint')}
              </AppText>
            </View>
            <View style={styles.types}>
              {groupTypes.map((option) => (
                <AppButton
                  key={option}
                  title={
                    option === 'friends'
                      ? t('groups.typeFriends')
                      : option === 'couple'
                        ? t('groups.typeCouple')
                        : option === 'household'
                          ? t('groups.typeHousehold')
                          : option === 'trip'
                            ? t('groups.typeTrip')
                            : option === 'work'
                              ? t('groups.typeWork')
                              : option === 'family'
                                ? t('groups.typeFamily')
                                : t('groups.typeOther')
                  }
                  size="sm"
                  variant={type === option ? 'primary' : 'secondary'}
                  accessibilityState={{ selected: type === option }}
                  onPress={() => setType(option)}
                />
              ))}
            </View>
          </View>

          <View style={[styles.currencyRow, { borderColor: palette.divider }]}>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {t('groups.currency')}
            </AppText>
            <AppText variant="label">{auth.profile?.default_currency || 'EUR'}</AppText>
          </View>

          {error ? (
            <View style={[styles.error, { backgroundColor: palette.dangerLight }]}>
              <AppText variant="bodySmall" color={palette.dangerInk}>
                {error}
              </AppText>
            </View>
          ) : null}

          <AppButton
            title={t('groups.create')}
            size="lg"
            fullWidth
            loading={create.isPending}
            onPress={() => create.mutate()}
          />
        </Card>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: '100%',
    gap: spacing.lg,
  },
  intro: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xs,
  },
  introText: {
    maxWidth: 320,
    textAlign: 'center',
  },
  formCard: {
    gap: spacing.xl,
  },
  descriptionInput: {
    minHeight: 94,
    textAlignVertical: 'top',
  },
  typeSection: {
    gap: spacing.md,
  },
  typeHeading: {
    gap: 2,
  },
  types: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  currencyRow: {
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  error: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
});
