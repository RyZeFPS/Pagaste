import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInLeft, ReduceMotion } from 'react-native-reanimated';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  FileSpreadsheet,
  Filter,
  Image as ImageIcon,
  MailCheck,
  SearchCheck,
  Share2,
  SlidersHorizontal,
  WalletCards,
  XCircle,
} from 'lucide-react-native';
import {
  AppButton,
  AppInput,
  AppText,
  Avatar,
  BottomSheet,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ScreenContainer,
} from '@/components/ui';
import { ListRowsSkeleton } from '@/components/loading-skeletons';
import { MerchantLogo } from '@/components/merchant-logo';
import {
  activityCounterparty,
  buildActivityCsv,
  buildParticipantSummary,
  countActiveActivityFilters,
  emptyActivityFilters,
  filterActivityHistory,
  isValidActivityFilterAmount,
  isValidActivityFilterDate,
  listActivityCounterparties,
  type ActivityFilterStatus,
  type ActivityHistoryFilters,
  type ActivityHistoryRecord,
} from '@/lib/activity-history';
import { listActivityHistory } from '@/lib/activity-history-query';
import {
  exportActivityCsv,
  exportActivityExcel,
  exportActivityPdf,
  exportParticipantSummaryImage,
} from '@/lib/activity-export';
import {
  buildActivityExcelXml,
  buildActivityPdf,
  buildActivityReportModel,
  buildParticipantSummarySvg,
} from '@/lib/activity-report';
import type { ClaimStatus } from '@/lib/models';
import { repository } from '@/lib/repository';
import {
  buildOutstandingClaimGroupSummary,
  groupOutstandingClaimsByPerson,
  type OutstandingClaimGroup,
} from '@/domain/grouped-claims';
import { getGroupedClaimsCopy } from '@/features/activity/grouped-claims-copy';
import { getActivityExportCopy } from '@/features/activity/export-copy';
import { useAppColors } from '@/providers/app-providers';
import { useAuth } from '@/providers/auth-provider';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { radii, spacing } from '@/theme';

const headerEnter = FadeInDown.duration(320).reduceMotion(ReduceMotion.System);
const activityEnter = (index: number) =>
  FadeInLeft.duration(330)
    .delay(55 + Math.min(index, 5) * 34)
    .reduceMotion(ReduceMotion.System);
const PAYMENT_CHECK_DELAY_MS = 10 * 60 * 1000;
const PAYMENT_CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

function paymentCheckAvailability(
  sentAt: string | null,
  events: { event_type: string; created_at: string }[] | undefined,
  t: Translate,
) {
  const now = Date.now();
  const sentTime = sentAt ? new Date(sentAt).getTime() : now;
  const readyAt = sentTime + PAYMENT_CHECK_DELAY_MS;
  const lastRequest = events
    ?.filter((event) => event.event_type === 'payment_check_requested')
    .reduce((latest, event) => Math.max(latest, new Date(event.created_at).getTime()), 0);
  if (readyAt > now) {
    return {
      enabled: false,
      label: t('activity.paymentCheckMinutes', {
        minutes: Math.max(1, Math.ceil((readyAt - now) / 60_000)),
      }),
    };
  }
  if (lastRequest && lastRequest + PAYMENT_CHECK_COOLDOWN_MS > now) {
    return { enabled: false, label: t('activity.paymentCheckSent') };
  }
  return { enabled: true, label: t('activity.paymentCheckRequest') };
}

function statusLabel(status: ClaimStatus, t: Translate): string {
  if (status === 'received') return t('activity.statusReceived');
  if (status === 'disputed') return t('activity.statusDisputed');
  if (status === 'cancelled') return t('activity.statusCancelled');
  if (status === 'reminder_sent') return t('activity.statusReminder');
  return t('activity.statusPending');
}

function StatusFilterChip({
  value,
  selected,
  label,
  onSelect,
}: {
  value: ActivityFilterStatus;
  selected: boolean;
  label: string;
  onSelect: (status: ActivityFilterStatus) => void;
}) {
  const palette = useAppColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(value)}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: selected ? palette.primary : palette.surface,
          borderColor: selected ? palette.primary : palette.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <AppText variant="caption" color={selected ? palette.white : palette.textSecondary}>
        {label}
      </AppText>
    </Pressable>
  );
}

export default function ActivityScreen() {
  const router = useRouter();
  const palette = useAppColors();
  const auth = useAuth();
  const { t, formatDate, formatMoney, locale } = useI18n();
  const cache = useQueryClient();
  const [feedback, setFeedback] = useState<string>();
  const [filters, setFilters] = useState<ActivityHistoryFilters>(emptyActivityFilters);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [exportVisible, setExportVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const query = useQuery({
    queryKey: ['claims', 'activity-history'],
    queryFn: listActivityHistory,
  });
  const filteredRecords = useMemo(
    () => filterActivityHistory(query.data ?? [], filters, auth.user?.id),
    [auth.user?.id, filters, query.data],
  );
  const counterparties = useMemo(
    () => listActivityCounterparties(filteredRecords, auth.user?.id),
    [auth.user?.id, filteredRecords],
  );
  const groupedClaimsCopy = getGroupedClaimsCopy(locale);
  const exportCopy = getActivityExportCopy(locale);
  const groupedOutstandingClaims = useMemo(
    () => groupOutstandingClaimsByPerson(filteredRecords, auth.user?.id),
    [auth.user?.id, filteredRecords],
  );
  const activeFilterCount = countActiveActivityFilters(filters);

  const paymentCheck = useMutation({
    mutationFn: repository.requestPaymentCheck,
    onSuccess: async () => {
      setFeedback(t('activity.feedbackSent'));
      await cache.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (error: Error) => setFeedback(error.message),
  });

  const updateFilter = <Key extends keyof ActivityHistoryFilters>(
    key: Key,
    value: ActivityHistoryFilters[Key],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  const exportLabels = {
    date: t('activity.csvDate'),
    person: t('activity.csvPerson'),
    direction: t('activity.csvDirection'),
    expense: t('activity.csvExpense'),
    merchant: t('activity.csvMerchant'),
    group: t('activity.csvGroup'),
    products: t('activity.csvProducts'),
    status: t('activity.csvStatus'),
    amount: t('activity.csvAmount'),
    currency: t('activity.csvCurrency'),
    incoming: t('activity.directionIncoming'),
    outgoing: t('activity.directionOutgoing'),
    notAvailable: t('activity.notAvailable'),
    statusLabel: (status: ClaimStatus) => statusLabel(status, t),
    formatDate,
  };

  const reportOptions = {
    userId: auth.user?.id,
    copy: exportCopy,
    labels: exportLabels,
    formatMoney,
    formatDate,
  };

  const buildAndroidReportFallback = () => {
    const report = buildActivityReportModel(filteredRecords, reportOptions);
    return [
      report.title,
      report.subtitle,
      '',
      `${exportCopy.pendingToReceive}: ${report.overview.pendingToReceive}`,
      `${exportCopy.pendingToPay}: ${report.overview.pendingToPay}`,
      `${exportCopy.received}: ${report.overview.received}`,
      `${exportCopy.issues}: ${report.overview.issues}`,
      '',
      ...report.movements.map(
        (movement) =>
          `• ${movement.date} · ${movement.person} · ${movement.expense} · ${movement.amount} · ${movement.status}`,
      ),
      '',
      exportCopy.androidFileFallback,
    ].join('\n');
  };

  const handleCsvExport = async () => {
    if (!filteredRecords.length) return;
    setExporting(true);
    setFeedback(undefined);
    try {
      const delimiter = locale === 'es' ? ';' : ',';
      const csv = buildActivityCsv(filteredRecords, auth.user?.id, exportLabels, delimiter);
      await exportActivityCsv(csv, t('activity.exportCsv'));
      setFeedback(t('activity.exportSuccess'));
      setExportVisible(false);
    } catch {
      setFeedback(t('activity.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const handlePdfExport = async () => {
    if (!filteredRecords.length) return;
    setExporting(true);
    setFeedback(undefined);
    try {
      const pdf = buildActivityPdf(filteredRecords, reportOptions);
      await exportActivityPdf(pdf, exportCopy.pdfAction, buildAndroidReportFallback());
      setFeedback(t('activity.exportSuccess'));
      setExportVisible(false);
    } catch {
      setFeedback(t('activity.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const handleExcelExport = async () => {
    if (!filteredRecords.length) return;
    setExporting(true);
    setFeedback(undefined);
    try {
      const spreadsheet = buildActivityExcelXml(filteredRecords, reportOptions);
      await exportActivityExcel(spreadsheet, exportCopy.excelAction, buildAndroidReportFallback());
      setFeedback(t('activity.exportSuccess'));
      setExportVisible(false);
    } catch {
      setFeedback(t('activity.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const handleParticipantSummary = async (participantKey: string) => {
    const message = buildParticipantSummary(filteredRecords, participantKey, auth.user?.id, {
      title: (name) => t('activity.summaryTitle', { name }),
      owedToYou: (amount) => t('activity.summaryOwedToYou', { amount }),
      youOwe: (amount) => t('activity.summaryYouOwe', { amount }),
      received: (amount) => t('activity.summaryReceived', { amount }),
      issues: (amount) => t('activity.summaryIssues', { amount }),
      movements: t('activity.summaryMovements'),
      incoming: t('activity.directionIncoming'),
      outgoing: t('activity.directionOutgoing'),
      notAvailable: t('activity.notAvailable'),
      statusLabel: (status) => statusLabel(status, t),
      formatMoney,
      formatDate,
    });
    if (!message) return;
    try {
      const visual = buildParticipantSummarySvg(
        filteredRecords,
        participantKey,
        reportOptions,
        message,
      );
      if (!visual) return;
      await exportParticipantSummaryImage(
        visual.svg,
        visual.name,
        exportCopy.visualSummaryAction(visual.name),
        visual.fallbackText,
      );
      setExportVisible(false);
    } catch {
      setFeedback(t('activity.summaryError'));
    }
  };

  const handleGroupedClaimSummary = async (group: OutstandingClaimGroup) => {
    const message = buildOutstandingClaimGroupSummary(group, {
      title: groupedClaimsCopy.summaryTitle,
      total: groupedClaimsCopy.summaryTotal,
      movements: groupedClaimsCopy.summaryMovements,
      item: groupedClaimsCopy.summaryItem,
      context: groupedClaimsCopy.summaryContext,
      footer: groupedClaimsCopy.summaryFooter,
      formatMoney,
      formatDate,
    });
    try {
      await Share.share({ message });
    } catch {
      setFeedback(groupedClaimsCopy.shareError);
    }
  };

  const statusOptions: { value: ActivityFilterStatus; label: string }[] = [
    { value: 'all', label: t('activity.filterAll') },
    { value: 'pending', label: t('activity.filterPending') },
    { value: 'received', label: t('activity.filterReceived') },
    { value: 'reminder_sent', label: t('activity.filterReminder') },
    { value: 'disputed', label: t('activity.filterDisputed') },
    { value: 'cancelled', label: t('activity.filterCancelled') },
  ];

  return (
    <ScreenContainer floatingTabs>
      <View style={styles.screen}>
        <Animated.View entering={headerEnter} style={styles.header}>
          <AppText variant="display" style={styles.title}>
            {t('activity.title')}
          </AppText>
          <AppText variant="bodySmall" color={palette.textSecondary}>
            {t('activity.subtitle')}
          </AppText>
        </Animated.View>

        <Card variant="flat" padding="compact" style={styles.searchCard}>
          <AppInput
            testID="activity-search"
            label={t('activity.searchLabel')}
            placeholder={t('activity.searchPlaceholder')}
            value={filters.query}
            onChangeText={(value) => updateFilter('query', value)}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          <View style={styles.actionRow}>
            <AppButton
              title={`${t('activity.filters')}${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
              variant="secondary"
              size="sm"
              leftIcon={<Filter color={palette.primary} size={17} />}
              style={styles.actionButton}
              onPress={() => setFiltersVisible(true)}
            />
            <AppButton
              title={t('activity.export')}
              variant="outline"
              size="sm"
              disabled={!filteredRecords.length}
              leftIcon={<Download color={palette.primary} size={17} />}
              style={styles.actionButton}
              onPress={() => setExportVisible(true)}
            />
          </View>
          {query.data?.length ? (
            <View style={styles.resultSummary}>
              <AppText
                variant="caption"
                color={palette.textSecondary}
                accessibilityLiveRegion="polite"
              >
                {t('activity.resultsCount', { count: filteredRecords.length })}
              </AppText>
              {activeFilterCount ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setFilters(emptyActivityFilters)}
                  hitSlop={8}
                >
                  <AppText variant="caption" color={palette.primary}>
                    {t('activity.clearFilters')}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Card>

        {feedback ? (
          <Card
            variant="flat"
            accessibilityLiveRegion="polite"
            style={{ backgroundColor: palette.primaryLight }}
          >
            <AppText variant="bodySmall" color={palette.primary}>
              {feedback}
            </AppText>
          </Card>
        ) : null}

        {groupedOutstandingClaims.length ? (
          <Animated.View entering={activityEnter(0)} style={styles.groupedSection}>
            <View style={styles.groupedHeader}>
              <AppText variant="sectionTitle">{groupedClaimsCopy.sectionTitle}</AppText>
              <AppText variant="bodySmall" color={palette.textSecondary}>
                {groupedClaimsCopy.sectionBody}
              </AppText>
            </View>
            <Card variant="grouped">
              {groupedOutstandingClaims.map((group, index) => (
                <View key={group.key}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={groupedClaimsCopy.shareA11y(group.personName)}
                    accessibilityHint={groupedClaimsCopy.share}
                    onPress={() => void handleGroupedClaimSummary(group)}
                    style={({ pressed }) => [
                      styles.groupedClaimRow,
                      pressed && { backgroundColor: palette.primaryLight },
                    ]}
                  >
                    <Avatar name={group.personName} uri={group.avatarPath} size={44} />
                    <View style={styles.groupedClaimCopy}>
                      <AppText variant="label" numberOfLines={1}>
                        {group.personName}
                      </AppText>
                      <AppText variant="caption" color={palette.textSecondary}>
                        {groupedClaimsCopy.expenseCount(group.expenseCount)}
                      </AppText>
                    </View>
                    <View style={styles.groupedClaimMeta}>
                      <AppText tabular numberOfLines={1} style={styles.groupedClaimAmount}>
                        {formatMoney(group.totalCents, group.currency)}
                      </AppText>
                      <View style={styles.groupedShareAction}>
                        <Share2 color={palette.primary} size={15} strokeWidth={2} />
                        <AppText variant="caption" color={palette.primary}>
                          {groupedClaimsCopy.share}
                        </AppText>
                      </View>
                    </View>
                  </Pressable>
                  {index < groupedOutstandingClaims.length - 1 ? <Divider inset={72} /> : null}
                </View>
              ))}
            </Card>
          </Animated.View>
        ) : null}

        {query.isPending && query.data === undefined ? (
          <Animated.View entering={activityEnter(0)}>
            <ListRowsSkeleton count={3} rowHeight={82} />
          </Animated.View>
        ) : query.isError ? (
          <Animated.View entering={activityEnter(0)}>
            <Card variant="grouped">
              <ErrorState body={t('activity.loadError')} onRetry={() => void query.refetch()} />
            </Card>
          </Animated.View>
        ) : !query.data?.length ? (
          <Animated.View entering={activityEnter(0)}>
            <Card variant="grouped" style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.primaryLight }]}>
                <WalletCards color={palette.primary} size={28} strokeWidth={1.8} />
              </View>
              <EmptyState
                title={t('activity.emptyTitle')}
                body={t('activity.emptyBody')}
                action={
                  <AppButton
                    title={t('activity.createExpense')}
                    onPress={() => router.push('/expense/new')}
                  />
                }
              />
            </Card>
          </Animated.View>
        ) : !filteredRecords.length ? (
          <Animated.View entering={activityEnter(0)}>
            <Card variant="grouped" style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: palette.primaryLight }]}>
                <SlidersHorizontal color={palette.primary} size={27} strokeWidth={1.8} />
              </View>
              <EmptyState
                title={t('activity.noResultsTitle')}
                body={t('activity.noResultsBody')}
                action={
                  <AppButton
                    title={t('activity.clearFilters')}
                    variant="outline"
                    onPress={() => setFilters(emptyActivityFilters)}
                  />
                }
              />
            </Card>
          </Animated.View>
        ) : (
          <Card variant="grouped">
            {filteredRecords.map((claim, index) => (
              <ActivityRow
                key={claim.id}
                claim={claim}
                index={index}
                isLast={index === filteredRecords.length - 1}
                currentUserId={auth.user?.id}
                paymentCheckPending={paymentCheck.isPending && paymentCheck.variables === claim.id}
                onRequestPaymentCheck={() => paymentCheck.mutate(claim.id)}
              />
            ))}
          </Card>
        )}
      </View>

      <BottomSheet
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        title={t('activity.filterTitle')}
      >
        <View style={styles.sheetSection}>
          <AppText variant="label">{t('activity.filterStatus')}</AppText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            accessibilityRole="radiogroup"
          >
            {statusOptions.map((option) => (
              <StatusFilterChip
                key={option.value}
                value={option.value}
                selected={filters.status === option.value}
                label={option.label}
                onSelect={(value) => updateFilter('status', value)}
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.filterFields}>
          <AppInput
            label={t('activity.filterPerson')}
            placeholder={t('activity.filterPersonPlaceholder')}
            value={filters.person}
            onChangeText={(value) => updateFilter('person', value)}
            autoCorrect={false}
          />
          <AppInput
            label={t('activity.filterMerchant')}
            placeholder={t('activity.filterMerchantPlaceholder')}
            value={filters.merchant}
            onChangeText={(value) => updateFilter('merchant', value)}
            autoCorrect={false}
          />
          <AppInput
            label={t('activity.filterGroup')}
            placeholder={t('activity.filterGroupPlaceholder')}
            value={filters.group}
            onChangeText={(value) => updateFilter('group', value)}
            autoCorrect={false}
          />
          <AppInput
            label={t('activity.filterProduct')}
            placeholder={t('activity.filterProductPlaceholder')}
            value={filters.product}
            onChangeText={(value) => updateFilter('product', value)}
            autoCorrect={false}
          />
          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <AppInput
                label={t('activity.filterDateFrom')}
                placeholder={t('activity.filterDateHint')}
                hint={t('activity.filterDateHint')}
                error={
                  isValidActivityFilterDate(filters.dateFrom)
                    ? undefined
                    : t('activity.invalidDate')
                }
                value={filters.dateFrom}
                onChangeText={(value) => updateFilter('dateFrom', value)}
                inputMode="numeric"
                autoCorrect={false}
                style={styles.compactInput}
              />
            </View>
            <View style={styles.column}>
              <AppInput
                label={t('activity.filterDateTo')}
                placeholder={t('activity.filterDateHint')}
                hint={t('activity.filterDateHint')}
                error={
                  isValidActivityFilterDate(filters.dateTo) ? undefined : t('activity.invalidDate')
                }
                value={filters.dateTo}
                onChangeText={(value) => updateFilter('dateTo', value)}
                inputMode="numeric"
                autoCorrect={false}
                style={styles.compactInput}
              />
            </View>
          </View>
          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <AppInput
                label={t('activity.filterMinAmount')}
                hint={t('activity.filterAmountHint')}
                error={
                  isValidActivityFilterAmount(filters.amountMin)
                    ? undefined
                    : t('activity.invalidAmount')
                }
                value={filters.amountMin}
                onChangeText={(value) => updateFilter('amountMin', value)}
                keyboardType="decimal-pad"
                style={styles.compactInput}
              />
            </View>
            <View style={styles.column}>
              <AppInput
                label={t('activity.filterMaxAmount')}
                hint={t('activity.filterAmountHint')}
                error={
                  isValidActivityFilterAmount(filters.amountMax)
                    ? undefined
                    : t('activity.invalidAmount')
                }
                value={filters.amountMax}
                onChangeText={(value) => updateFilter('amountMax', value)}
                keyboardType="decimal-pad"
                style={styles.compactInput}
              />
            </View>
          </View>
        </View>
        <View style={styles.sheetActions}>
          <AppButton
            title={t('activity.filterReset')}
            variant="ghost"
            style={styles.actionButton}
            onPress={() => setFilters(emptyActivityFilters)}
          />
          <AppButton
            title={t('activity.filterDone')}
            style={styles.actionButton}
            disabled={
              !isValidActivityFilterDate(filters.dateFrom) ||
              !isValidActivityFilterDate(filters.dateTo) ||
              !isValidActivityFilterAmount(filters.amountMin) ||
              !isValidActivityFilterAmount(filters.amountMax)
            }
            onPress={() => setFiltersVisible(false)}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={exportVisible}
        onClose={() => setExportVisible(false)}
        title={t('activity.exportTitle')}
      >
        <AppText color={palette.textSecondary}>{t('activity.exportDescription')}</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('activity.exportCsv')}
          disabled={exporting}
          onPress={() => void handleCsvExport()}
          style={({ pressed }) => [
            styles.exportOption,
            { borderColor: palette.border, backgroundColor: palette.background },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.optionIcon, { backgroundColor: palette.successLight }]}>
            <FileSpreadsheet color={palette.successInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="label">{t('activity.exportCsv')}</AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              {t('activity.exportCsvHint')} ·{' '}
              {t('activity.resultsCount', { count: filteredRecords.length })}
            </AppText>
          </View>
          <Download color={palette.primary} size={20} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={exportCopy.pdfAction}
          disabled={exporting}
          onPress={() => void handlePdfExport()}
          style={({ pressed }) => [
            styles.exportOption,
            { borderColor: palette.border, backgroundColor: palette.background },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.optionIcon, { backgroundColor: palette.dangerLight }]}>
            <FileText color={palette.dangerInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="label">{exportCopy.pdfAction}</AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              {exportCopy.pdfHint} · {t('activity.resultsCount', { count: filteredRecords.length })}
            </AppText>
          </View>
          <Download color={palette.primary} size={20} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={exportCopy.excelAction}
          disabled={exporting}
          onPress={() => void handleExcelExport()}
          style={({ pressed }) => [
            styles.exportOption,
            { borderColor: palette.border, backgroundColor: palette.background },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.optionIcon, { backgroundColor: palette.successLight }]}>
            <FileSpreadsheet color={palette.successInk} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="label">{exportCopy.excelAction}</AppText>
            <AppText variant="caption" color={palette.textSecondary}>
              {exportCopy.excelHint}
            </AppText>
          </View>
          <Download color={palette.primary} size={20} />
        </Pressable>

        {counterparties.length ? (
          <View style={styles.sheetSection}>
            <AppText variant="sectionTitle">{t('activity.exportPeople')}</AppText>
            <AppText variant="bodySmall" color={palette.textSecondary}>
              {exportCopy.visualSummaryHint}
            </AppText>
            <View style={[styles.peopleList, { borderColor: palette.border }]}>
              {counterparties.map((person, index) => (
                <View key={person.key}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={exportCopy.visualSummaryAction(person.name)}
                    accessibilityHint={exportCopy.visualSummaryHint}
                    onPress={() => void handleParticipantSummary(person.key)}
                    style={({ pressed }) => [
                      styles.personOption,
                      pressed && { backgroundColor: palette.primaryLight },
                    ]}
                  >
                    <Avatar name={person.name} size={38} />
                    <View style={styles.flex}>
                      <AppText variant="label">{person.name}</AppText>
                      <AppText variant="caption" color={palette.textSecondary}>
                        {t('activity.resultsCount', { count: person.recordCount })}
                      </AppText>
                    </View>
                    <ImageIcon color={palette.primary} size={19} />
                  </Pressable>
                  {index < counterparties.length - 1 ? <Divider inset={58} /> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </ScreenContainer>
  );
}

function ActivityRow({
  claim,
  index,
  isLast,
  currentUserId,
  paymentCheckPending,
  onRequestPaymentCheck,
}: {
  claim: ActivityHistoryRecord;
  index: number;
  isLast: boolean;
  currentUserId?: string;
  paymentCheckPending: boolean;
  onRequestPaymentCheck: () => void;
}) {
  const router = useRouter();
  const palette = useAppColors();
  const { t, formatMoney, formatDate } = useI18n();
  const { incoming, person } = activityCounterparty(claim, currentUserId);
  const name =
    person?.display_name ?? (incoming ? t('activity.unknownPerson') : t('activity.participant'));
  const merchantName = claim.expense?.merchant_name?.trim() || null;
  const presentation =
    claim.status === 'received'
      ? {
          label: t('activity.statusReceived'),
          message: incoming
            ? t('activity.msgIncomingReceived', { name })
            : t('activity.msgOutgoingReceived', { name }),
          color: palette.successInk,
          Icon: CheckCircle2,
        }
      : claim.status === 'disputed'
        ? {
            label: t('activity.statusDisputed'),
            message: incoming
              ? t('activity.msgIncomingDisputed', { name })
              : t('activity.msgOutgoingDisputed', { name }),
            color: palette.dangerInk,
            Icon: AlertCircle,
          }
        : claim.status === 'cancelled'
          ? {
              label: t('activity.statusCancelled'),
              message: t('activity.msgCancelled'),
              color: palette.textMuted,
              Icon: XCircle,
            }
          : claim.status === 'reminder_sent'
            ? {
                label: t('activity.statusReminder'),
                message: incoming
                  ? t('activity.msgIncomingReminder', { name })
                  : t('activity.msgOutgoingReminder', { name }),
                color: palette.primary,
                Icon: MailCheck,
              }
            : {
                label: t('activity.statusPending'),
                message: incoming
                  ? t('activity.msgIncomingPending', { name })
                  : t('activity.msgOutgoingPending', { name }),
                color: palette.warningInk,
                Icon: Clock3,
              };
  const detailParts = [
    presentation.message,
    merchantName,
    claim.expense?.group?.name,
    formatDate(claim.expense?.occurred_at ?? claim.created_at),
  ].filter(Boolean);
  const canRequestCheck = incoming && ['pending', 'reminder_sent'].includes(claim.status);
  const checkAvailability = paymentCheckAvailability(claim.sent_at, claim.events, t);

  return (
    <Animated.View entering={activityEnter(index)}>
      <Pressable
        accessibilityRole={incoming ? undefined : 'button'}
        accessibilityLabel={`${presentation.label}, ${name}, ${formatMoney(
          claim.amount_cents,
          claim.expense?.currency,
        )}`}
        disabled={incoming}
        onPress={incoming ? undefined : () => router.push(`/expense/${claim.expense_id}/status`)}
        style={({ pressed }) => [
          styles.activityRow,
          pressed && { backgroundColor: palette.primaryLight },
        ]}
      >
        <View style={styles.avatarWithMerchant}>
          <Avatar name={name} uri={person?.avatar_path} size={46} />
          {merchantName ? (
            <MerchantLogo
              merchantName={merchantName}
              fallbackLabel={claim.expense?.title || t('activity.csvMerchant')}
              size={22}
              style={[styles.merchantBadge, { borderColor: palette.surface }]}
            />
          ) : null}
        </View>
        <View style={styles.activityCopy}>
          <AppText numberOfLines={1} style={styles.personName}>
            {name}
          </AppText>
          <AppText numberOfLines={2} variant="bodySmall" color={palette.textSecondary}>
            {detailParts.join(' · ')}
          </AppText>
        </View>
        <View style={styles.activityMeta}>
          <AppText numberOfLines={1} tabular style={styles.amount}>
            {formatMoney(claim.amount_cents, claim.expense?.currency)}
          </AppText>
          <View style={styles.status}>
            <presentation.Icon color={presentation.color} size={15} strokeWidth={2} />
            <AppText numberOfLines={2} color={presentation.color} style={styles.statusText}>
              {presentation.label}
            </AppText>
          </View>
        </View>
        {!incoming ? <ChevronRight color={palette.textMuted} size={19} strokeWidth={1.8} /> : null}
      </Pressable>
      {canRequestCheck ? (
        <View
          style={[
            styles.paymentCheck,
            { borderTopColor: palette.divider, backgroundColor: palette.background },
          ]}
        >
          <View style={styles.paymentCheckCopy}>
            <SearchCheck color={palette.primary} size={18} />
            <AppText variant="caption" color={palette.textSecondary} style={styles.flex}>
              {t('activity.paymentCheckHint')}
            </AppText>
          </View>
          <AppButton
            title={checkAvailability.label}
            size="sm"
            variant="outline"
            disabled={!checkAvailability.enabled}
            loading={paymentCheckPending}
            onPress={onRequestPaymentCheck}
          />
        </View>
      ) : null}
      {!isLast ? <Divider inset={74} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: '100%',
    gap: spacing.xl,
  },
  header: {
    minHeight: 68,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.7,
  },
  searchCard: {
    gap: spacing.md,
  },
  groupedSection: {
    gap: spacing.md,
  },
  groupedHeader: {
    gap: spacing.xs,
  },
  groupedClaimRow: {
    minHeight: 78,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  groupedClaimCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  groupedClaimMeta: {
    maxWidth: 132,
    alignItems: 'flex-end',
    gap: 4,
  },
  groupedClaimAmount: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  groupedShareAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  resultSummary: {
    minHeight: 26,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyCard: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    gap: 0,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityRow: {
    minHeight: 88,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  activityCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  avatarWithMerchant: {
    width: 48,
    height: 48,
    justifyContent: 'center',
  },
  merchantBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    borderWidth: 2,
  },
  personName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  activityMeta: {
    maxWidth: 126,
    alignItems: 'flex-end',
    gap: 4,
  },
  amount: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  statusText: {
    maxWidth: 100,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  paymentCheck: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  paymentCheckCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sheetSection: {
    gap: spacing.md,
  },
  chips: {
    gap: spacing.sm,
    paddingRight: spacing.xl,
  },
  filterChip: {
    minHeight: 42,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterFields: {
    gap: spacing.lg,
  },
  twoColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  compactInput: {
    minWidth: 0,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  exportOption: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.control,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peopleList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.control,
    overflow: 'hidden',
  },
  personOption: {
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.82,
  },
});
