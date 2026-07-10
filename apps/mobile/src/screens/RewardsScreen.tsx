import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, Modal, Image } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { apiFetch } from "@repo/core/api";
import type { RewardsSummary, MyInvoice, InvoiceRow } from "@repo/core/types";
import { nowYearMonth1, formatYearMonth, formatMonthDayJP } from "@repo/core/logic/calendar";
import {
  mergedDetails,
  logLabel,
  formatYen,
  isUploadedDocument,
  pendingInvoices,
  invoiceLines,
  resolveRowPrice,
  roundedRowAmount,
  computeInvoiceTotals,
} from "@repo/core/logic/reward";
import { Skeleton } from "../components/Skeleton";

// ============================================================
// 報酬（me/rewards）＝月次サマリ＋明細＋請求書確認・承認＋自由経費の追加/削除。NativeWind。
// 計算・整形は Web と同じ @repo/core/logic/reward・calendar を再利用。
// カードの見た目は Web の PaymentSummary/FixedExpenseSection/ExpenseSection を踏襲。
// ただし合計金額は Web の PaymentSummary のローカル再計算（variableDeductions を
// 含めない）ではなく、サーバ算出の data.net をそのまま使う（金額表示の正確性を優先）。
// ============================================================

export function RewardsScreen() {
  const [ym, setYm] = useState(nowYearMonth1);
  const [data, setData] = useState<RewardsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [optionalName, setOptionalName] = useState("");
  const [optionalAmount, setOptionalAmount] = useState("");
  const [optionalSubmitting, setOptionalSubmitting] = useState(false);
  const [optionalError, setOptionalError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<MyInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [invoicePanelOpen, setInvoicePanelOpen] = useState(false);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);
  const [approvingInvoiceId, setApprovingInvoiceId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const monthStr = formatYearMonth(ym.year, ym.month);

  const loadRewards = async () => {
    setLoading(true);
    setError("");
    try {
      const d = await apiFetch<RewardsSummary>(`/api/me/rewards?month=${monthStr}`);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "報酬の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRewards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr]);

  const loadInvoices = async () => {
    setInvoicesLoading(true);
    try {
      const res = await apiFetch<{ invoices: MyInvoice[] }>("/api/me/invoices");
      setInvoices(pendingInvoices(res.invoices ?? []));
    } catch {
      // 一覧取得失敗はバッジ非表示のまま静かに諦める（本編の報酬表示を止めない）
    } finally {
      setInvoicesLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  const shiftMonth = (delta: number) =>
    setYm((prev) => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m < 1) {
        m = 12;
        y -= 1;
      } else if (m > 12) {
        m = 1;
        y += 1;
      }
      return { year: y, month: m };
    });

  const addOptionalExpense = async () => {
    setOptionalError(null);
    const amount = parseInt(optionalAmount.replace(/\D/g, ""), 10);
    if (!optionalName.trim() || Number.isNaN(amount) || amount <= 0) return;
    setOptionalSubmitting(true);
    try {
      await apiFetch("/api/me/optional-expenses", {
        method: "POST",
        body: JSON.stringify({ month: monthStr, name: optionalName.trim(), amount }),
      });
      setOptionalName("");
      setOptionalAmount("");
      await loadRewards();
    } catch (e) {
      setOptionalError(e instanceof Error ? e.message : "追加に失敗しました");
    } finally {
      setOptionalSubmitting(false);
    }
  };

  const deleteOptionalExpense = async (id: string) => {
    try {
      await apiFetch(`/api/me/optional-expenses/${id}`, { method: "DELETE" });
      await loadRewards();
    } catch {
      // web版と同じくエラーは静かに諦める（一覧は再読込されないため次回操作時に整合する）
    }
  };

  const approveInvoice = async (id: string) => {
    setApproveError(null);
    setApprovingInvoiceId(id);
    try {
      await apiFetch(`/api/me/invoices/${encodeURIComponent(id)}/approve`, { method: "POST" });
      const res = await apiFetch<{ invoices: MyInvoice[] }>("/api/me/invoices");
      const pendingOnly = pendingInvoices(res.invoices ?? []);
      setInvoices(pendingOnly);
      setPreviewInvoiceId(null);
      if (pendingOnly.length === 0) setInvoicePanelOpen(false);
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "承認に失敗しました");
    } finally {
      setApprovingInvoiceId(null);
    }
  };

  const details = data ? mergedDetails(data) : [];

  const now = new Date();
  const isCurrentMonth = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1;

  const grid: { label: string; value: number }[] = data
    ? [
        { label: "収入", value: data.incomeLog },
        { label: "固定控除", value: data.fixedDeductions },
        { label: "変動控除", value: data.variableDeductions },
        ...(data.optionalDeductions ? [{ label: "自由控除", value: data.optionalDeductions }] : []),
        ...(data.leaseDeductions ? [{ label: "リース", value: data.leaseDeductions }] : []),
      ]
    : [];

  const previewInvoice = previewInvoiceId ? invoices.find((x) => x.id === previewInvoiceId) ?? null : null;

  return (
    <ScrollView className="flex-1 bg-brand-50" contentContainerClassName="px-4 pt-16 pb-10 gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-bold text-brand-900">報酬</Text>
        <Pressable
          className="flex-row items-center gap-2 bg-white border border-brand-200 rounded-lg px-3 py-1.5"
          onPress={() => setInvoicePanelOpen(true)}
        >
          <FontAwesome6 name="file-invoice" size={13} color="#454c56" iconStyle="solid" />
          <Text className="text-sm text-brand-700">請求書</Text>
          {invoices.length > 0 && (
            <View className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 items-center justify-center">
              <Text className="text-white text-[10px] font-bold">{invoices.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <View className="flex-row items-center justify-center gap-5">
        <Pressable className="px-3.5 py-1 rounded-lg bg-white border border-brand-200 active:opacity-80" onPress={() => shiftMonth(-1)}>
          <Text className="text-xl text-brand-700 leading-6">‹</Text>
        </Pressable>
        <Text className="text-base font-semibold text-brand-900 min-w-[110px] text-center">{ym.year}年{ym.month}月</Text>
        <Pressable className="px-3.5 py-1 rounded-lg bg-white border border-brand-200 active:opacity-80" onPress={() => shiftMonth(1)}>
          <Text className="text-xl text-brand-700 leading-6">›</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="gap-4">
          <View className="bg-white rounded-lg border border-brand-200 shadow-sm p-5 gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-40" />
            <View className="flex-row flex-wrap gap-y-4 mt-2">
              {[0, 1, 2, 3].map((i) => (
                <View key={i} className="w-1/2 gap-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-5 w-20" />
                </View>
              ))}
            </View>
          </View>
          <Skeleton className="h-12 w-full rounded-lg" />
          <View className="bg-white rounded-lg border border-brand-200 p-5 gap-2.5">
            <Skeleton className="h-4 w-16 mb-1" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </View>
        </View>
      ) : error ? (
        <Text className="text-red-600 py-4">{error}</Text>
      ) : data ? (
        <>
          <View className="bg-white rounded-lg border border-brand-200 shadow-sm p-5">
            <Text className="text-[13px] text-brand-500 mb-1">
              今月の{isCurrentMonth ? "暫定" : ""}報酬
            </Text>
            <Text className="text-4xl font-bold text-brand-900">{formatYen(data.net)}</Text>

            <View className="flex-row flex-wrap gap-y-4 mt-5">
              {grid.map((b) => (
                <View key={b.label} className="w-1/2">
                  <Text className="text-[13px] text-brand-500 mb-0.5">{b.label}</Text>
                  <Text className={`text-lg font-semibold ${b.label === "収入" ? "text-brand-900" : "text-accent-600"}`}>
                    {b.label === "収入" ? formatYen(b.value) : `-${formatYen(b.value)}`}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View className="bg-white rounded-lg border border-brand-200 p-4">
            <Pressable className="flex-row items-center justify-between" onPress={() => setDetailsOpen((o) => !o)}>
              <Text className="text-sm font-semibold text-brand-800">詳細</Text>
              <Text className="text-brand-400">{detailsOpen ? "▲" : "▼"}</Text>
            </Pressable>
            {detailsOpen && (
              <View className="mt-3 pt-3 border-t border-brand-100 gap-2">
                {details.length === 0 ? (
                  <Text className="text-brand-500 text-[13px]">この月の明細はありません</Text>
                ) : (
                  details.map((d, i) => (
                    <View key={`${d.log_date}-${i}`} className="flex-row items-baseline flex-wrap gap-x-2">
                      <Text className="text-[13px] text-brand-600 font-medium">{formatMonthDayJP(d.log_date)}</Text>
                      <Text className="text-[13px] text-brand-800 flex-1" numberOfLines={1}>{logLabel(d)}</Text>
                      <Text className="text-[13px] text-brand-900 font-semibold">{formatYen(d.amount)}</Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>

          <View className="bg-white rounded-lg border border-brand-200 p-5">
            <Text className="text-base font-bold text-brand-900 mb-3">諸経費</Text>
            {data.fixedDetails.length > 0 ? (
              <View className="gap-2">
                {data.fixedDetails.map((e) => (
                  <View key={e.id} className="flex-row items-center justify-between p-3 bg-brand-50 rounded-lg">
                    <Text className="text-brand-800 text-[13px]">{e.name}</Text>
                    <Text className="text-accent-600 font-semibold text-[13px]">-{formatYen(e.amount)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-brand-400 text-[13px] text-center py-4">固定経費はありません</Text>
            )}
          </View>

          <View className="bg-white rounded-lg border border-brand-200 p-5">
            <View className="flex-row items-center gap-2 mb-3">
              <Text className="text-base font-bold text-brand-900">自由経費</Text>
              <Text className="text-[11px] text-brand-400">ⓘ 個人用</Text>
            </View>

            <View className="gap-2 mb-4">
              <TextInput
                className="bg-white border border-brand-200 rounded-lg py-2.5 px-4 text-brand-900"
                placeholder="経費名（例: ガソリン代）"
                value={optionalName}
                onChangeText={setOptionalName}
              />
              <View className="flex-row gap-2">
                <TextInput
                  className="flex-1 bg-white border border-brand-200 rounded-lg py-2.5 px-4 text-brand-900 text-right"
                  placeholder="金額（円）"
                  keyboardType="number-pad"
                  value={optionalAmount}
                  onChangeText={(t) => setOptionalAmount(t.replace(/[^0-9]/g, ""))}
                />
                <Pressable
                  className={`px-5 rounded-lg items-center justify-center bg-brand-800 active:opacity-80 ${optionalSubmitting || !optionalName.trim() || !optionalAmount ? "opacity-50" : ""}`}
                  onPress={addOptionalExpense}
                  disabled={optionalSubmitting || !optionalName.trim() || !optionalAmount}
                >
                  <Text className="text-white font-medium text-[13px]">{optionalSubmitting ? "追加中..." : "追加"}</Text>
                </Pressable>
              </View>
              {optionalError && <Text className="text-red-600 text-[13px]">{optionalError}</Text>}
            </View>

            {data.optionalDetails && data.optionalDetails.length > 0 ? (
              <View className="gap-2">
                {data.optionalDetails.map((e) => (
                  <View key={e.id} className="flex-row items-center justify-between p-3 bg-brand-50 rounded-lg">
                    <Text className="text-brand-800 text-[13px] flex-1" numberOfLines={1}>{e.name}</Text>
                    <View className="flex-row items-center gap-3">
                      <Text className="text-accent-600 font-semibold text-[13px]">-{formatYen(e.amount)}</Text>
                      <Pressable onPress={() => deleteOptionalExpense(e.id)} hitSlop={8}>
                        <FontAwesome6 name="trash" size={14} color="#dc2626" iconStyle="solid" />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-brand-400 text-[13px] text-center py-2">経費を追加してください</Text>
            )}
          </View>
        </>
      ) : null}

      {/* 請求書一覧 */}
      <Modal visible={invoicePanelOpen} transparent animationType="fade" onRequestClose={() => setInvoicePanelOpen(false)}>
        <Pressable className="flex-1 bg-black/40 justify-center p-4" onPress={() => setInvoicePanelOpen(false)}>
          <Pressable className="bg-white rounded-xl max-h-[80%] overflow-hidden" onPress={(e) => e.stopPropagation()}>
            <View className="p-3 border-b border-brand-100 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-brand-900">請求書確認</Text>
              <Pressable onPress={() => setInvoicePanelOpen(false)} hitSlop={8}>
                <FontAwesome6 name="xmark" size={16} color="#7c848f" iconStyle="solid" />
              </Pressable>
            </View>
            <ScrollView contentContainerClassName="p-4 gap-3">
              {invoicesLoading ? (
                <Text className="text-xs text-brand-500">読み込み中...</Text>
              ) : invoices.length === 0 ? (
                <Text className="text-xs text-brand-500">現在、承認待ちの請求書はありません。</Text>
              ) : (
                invoices.map((inv) => (
                  <View key={inv.id} className="rounded-lg border border-brand-200 p-3">
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="text-xs text-brand-600">{inv.invoiceNo || inv.id}</Text>
                      <View className="px-2 py-0.5 rounded bg-accent-50">
                        <Text className="text-[11px] text-accent-700">承認待ち</Text>
                      </View>
                    </View>
                    <Text className="mt-1 text-sm font-semibold text-brand-900">
                      {isUploadedDocument(inv) ? "確認文書" : `${inv.amount.toLocaleString("ja-JP")}円`}
                    </Text>
                    {isUploadedDocument(inv) && (
                      <Text className="mt-0.5 text-xs text-brand-500">
                        添付 {invoiceLines(inv).attachments.length} 件
                      </Text>
                    )}
                    <Pressable
                      className="mt-3 py-2 rounded-lg border border-brand-300 items-center"
                      onPress={() => setPreviewInvoiceId(inv.id)}
                    >
                      <Text className="text-sm text-brand-700">内容を確認する</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 請求書プレビュー */}
      <Modal visible={!!previewInvoice} transparent animationType="fade" onRequestClose={() => setPreviewInvoiceId(null)}>
        <Pressable className="flex-1 bg-black/40 justify-center p-4" onPress={() => setPreviewInvoiceId(null)}>
          <Pressable className="bg-white rounded-xl max-h-[85%] overflow-hidden" onPress={(e) => e.stopPropagation()}>
            <View className="p-3 border-b border-brand-100 flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-brand-900">請求書プレビュー</Text>
              <Pressable onPress={() => setPreviewInvoiceId(null)} hitSlop={8}>
                <FontAwesome6 name="xmark" size={16} color="#7c848f" iconStyle="solid" />
              </Pressable>
            </View>
            {previewInvoice && (() => {
              const inv = previewInvoice;
              const isDoc = isUploadedDocument(inv);
              const { main: mainLines, deduct: deductLines, attachments } = invoiceLines(inv);
              const displayBasis: "exclusive" | "inclusive" =
                inv.payload?.displayBasis === "inclusive" ? "inclusive" : "exclusive";
              const taxEnabled = inv.payload?.taxSettings?.enabled !== false;
              const totals = computeInvoiceTotals({
                main: mainLines,
                deduct: deductLines,
                taxEnabled,
                taxRatePercent: taxEnabled ? Number(inv.payload?.taxSettings?.rate ?? 10) || 0 : 0,
                loanRepay: Number(inv.payload?.loanRepay) || 0,
                extraOutsourcing:
                  Number(
                    displayBasis === "inclusive"
                      ? inv.payload?.extraOutsourcingInclusive
                      : inv.payload?.extraOutsourcingExclusive,
                  ) || 0,
                displayBasis,
              });

              const renderLine = (row: InvoiceRow, key: string) => {
                const qty = Number(row?.qty) || 0;
                const price = resolveRowPrice(row, displayBasis);
                const amount = roundedRowAmount(row, displayBasis);
                return (
                  <View key={key} className="py-2 border-b border-brand-100">
                    <Text className="text-sm text-brand-900" numberOfLines={1}>{row?.title || "明細"}</Text>
                    <View className="flex-row items-center justify-between mt-0.5">
                      <Text className="text-xs text-brand-500">{qty.toLocaleString("ja-JP")} × {price.toLocaleString("ja-JP")}円</Text>
                      <Text className="text-sm font-semibold text-brand-900">{amount.toLocaleString("ja-JP")}円</Text>
                    </View>
                  </View>
                );
              };

              return (
                <ScrollView contentContainerClassName="p-4 gap-4">
                  <View className="rounded-lg border border-brand-200 bg-brand-50 p-3">
                    <View className="flex-row items-start justify-between gap-2">
                      <View>
                        <Text className="text-sm font-semibold text-brand-900">{inv.invoiceNo || inv.id}</Text>
                        <Text className="text-xs text-brand-600 mt-0.5">請求日: {inv.payload?.issueDate || inv.issueDate || "-"}</Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-xs text-brand-500">{isDoc ? "文書種別" : "請求額"}</Text>
                        <Text className="text-lg font-bold text-brand-900">
                          {isDoc ? "確認文書" : `${Number(inv.amount || 0).toLocaleString("ja-JP")}円`}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {!isDoc && (
                    <View className="rounded-lg border border-brand-200 overflow-hidden">
                      <View className="px-3 py-2 bg-brand-100">
                        <Text className="text-xs font-semibold text-brand-700">売上明細</Text>
                      </View>
                      <View className="px-3">
                        {mainLines.length === 0 ? (
                          <Text className="text-xs text-brand-500 text-center py-3">売上明細はありません</Text>
                        ) : (
                          mainLines.map((row, idx) => renderLine(row, `main-${idx}`))
                        )}
                      </View>
                    </View>
                  )}

                  {attachments.length > 0 && (
                    <View className="rounded-lg border border-brand-200 overflow-hidden">
                      <View className="px-3 py-2 bg-brand-100">
                        <Text className="text-xs font-semibold text-brand-700">添付ファイル</Text>
                      </View>
                      <View className="p-3 gap-3">
                        {attachments.map((f, idx) => {
                          const url = f?.dataUrl || "";
                          if (!url) return null;
                          const isImage = (f?.type || "").startsWith("image/");
                          return (
                            <View key={idx} className="gap-1.5">
                              <Text className="text-xs text-brand-600">{f?.name || `添付ファイル ${idx + 1}`}</Text>
                              {isImage ? (
                                <Image source={{ uri: url }} style={{ width: "100%", height: 180, borderRadius: 8 }} resizeMode="contain" />
                              ) : (
                                <Text className="text-xs text-brand-400">このファイル形式はアプリ内でプレビューできません</Text>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {!isDoc && (
                    <>
                      <View className="rounded-lg border border-brand-200 overflow-hidden">
                        <View className="px-3 py-2 bg-brand-100">
                          <Text className="text-xs font-semibold text-brand-700">控除明細</Text>
                        </View>
                        <View className="px-3">
                          {deductLines.length === 0 ? (
                            <Text className="text-xs text-brand-500 text-center py-3">控除明細はありません</Text>
                          ) : (
                            deductLines.map((row, idx) => renderLine(row, `deduct-${idx}`))
                          )}
                        </View>
                      </View>

                      <View className="rounded-lg border border-brand-200 bg-brand-50 p-3 gap-1">
                        <View className="flex-row justify-between py-0.5">
                          <Text className="text-brand-600 text-[13px]">売上合計（税込）</Text>
                          <Text className="text-brand-900 text-[13px] font-medium">{totals.billGross.toLocaleString("ja-JP")}円</Text>
                        </View>
                        <View className="flex-row justify-between py-0.5">
                          <Text className="text-brand-600 text-[13px]">控除合計（税込）</Text>
                          <Text className="text-brand-900 text-[13px] font-medium">-{totals.deductGross.toLocaleString("ja-JP")}円</Text>
                        </View>
                        <View className="flex-row justify-between pt-2 mt-1 border-t border-brand-200">
                          <Text className="text-brand-900 font-semibold">合計請求額</Text>
                          <Text className="text-brand-900 font-bold">{totals.total.toLocaleString("ja-JP")}円</Text>
                        </View>
                      </View>
                    </>
                  )}

                  {approveError && <Text className="text-red-600 text-[13px]">{approveError}</Text>}

                  <Pressable
                    className={`py-3 rounded-lg items-center bg-brand-800 active:opacity-80 ${approvingInvoiceId === inv.id ? "opacity-50" : ""}`}
                    onPress={() => approveInvoice(inv.id)}
                    disabled={approvingInvoiceId === inv.id}
                  >
                    <Text className="text-white font-semibold">{approvingInvoiceId === inv.id ? "承認中..." : "承認する"}</Text>
                  </Pressable>
                </ScrollView>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
