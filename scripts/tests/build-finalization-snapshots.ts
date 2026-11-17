// 隔離DBテストから実際のアプリ計算を呼ぶ。DB・認証への接続は行わない。
import { buildFinalizationSnapshots } from "../../apps/web/src/server/aggregation/rateSnapshot";
void (async () => {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(JSON.stringify(buildFinalizationSnapshots(JSON.parse(input))));
})();
