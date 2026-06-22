import { bus, DailyReportSubmittedPayload } from "../bus";

// -------------------------------------------------------
// Stubs — implement later for LINE LIFF integration
// -------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function renderDailyReportImage(_payload: DailyReportSubmittedPayload): Promise<Buffer | null> {
  // TODO: Generate image (e.g., with canvas or sharp)
  console.log("[stub] renderDailyReportImage — not implemented");
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function postToLineGroup(_imageUrlOrBuffer: Buffer | string | null): Promise<void> {
  // TODO: POST to LINE Messaging API
  console.log("[stub] postToLineGroup — not implemented");
}

// -------------------------------------------------------
// Listener
// -------------------------------------------------------

bus.on("daily_report_submitted", (payload: DailyReportSubmittedPayload) => {
  // Non-blocking — run after API response is sent
  setImmediate(async () => {
    try {
      const image = await renderDailyReportImage(payload);
      await postToLineGroup(image);
      console.log(`[event] daily_report_submitted processed for ${payload.driverName} on ${payload.reportDate}`);
    } catch (err) {
      console.error("[event] daily_report_submitted handler error:", err);
    }
  });
});
