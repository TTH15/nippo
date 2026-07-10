function buildIncomingInvoiceNo(driverId, month) {
  const ym = month.replace('-', '');
  const token = driverId.replace(/-/g, '').slice(0, 4).toUpperCase();
  return `IN-${ym}-${token}`;
}
console.log(buildIncomingInvoiceNo('b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5', '2026-05'));
// Expect IN-202605-B8EB (matches production convention IN-202605-B8EB-R02)
