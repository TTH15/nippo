// 印刷（PDF保存）の実行。ブラウザは保存ダイアログの初期ファイル名に document.title を使うため、
// 印刷直前に title を請求書名へ差し替え、印刷後に元へ戻す。

/** document.title を fileName に差し替えてから印刷し、終了後に元のタイトルへ戻す。 */
export function printInvoice(fileName: string): void {
  const prev = document.title;
  if (fileName) document.title = fileName;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = prev;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  // 保存ダイアログが閉じても afterprint が発火しない環境向けのフォールバック。
  window.setTimeout(restore, 60000);
  window.print();
}
