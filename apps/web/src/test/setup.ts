import "@testing-library/jest-dom";

// Happy DOMは未参照のfinishedも即生成するため、イベント駆動の中止で拒否が未処理になる。
// 中止のAbortErrorだけ処理する。元のfinishedは拒否のまま保ち、他の失敗は再送出する。
if (typeof Animation !== "undefined") {
  const cancel = Animation.prototype.cancel;
  Animation.prototype.cancel = function () {
    void this.finished.catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    });
    cancel.call(this);
  };
}
