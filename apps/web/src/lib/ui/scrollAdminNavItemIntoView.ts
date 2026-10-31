/** ページや横方向のスクロールを動かさず、メニュー内の縦位置だけを補正する。 */
export function scrollAdminNavItemIntoView(panel: HTMLElement | null) {
  const target = panel?.querySelector<HTMLElement>('[aria-current="page"]') ?? panel?.querySelector<HTMLElement>("a");
  const nav = target?.closest("nav");
  if (!target || !nav || !nav.getClientRects().length) return;
  const item = target.getBoundingClientRect();
  const viewport = nav.getBoundingClientRect();
  if (item.top < viewport.top) nav.scrollTop += item.top - viewport.top;
  else if (item.bottom > viewport.bottom) nav.scrollTop += item.bottom - viewport.bottom;
}
