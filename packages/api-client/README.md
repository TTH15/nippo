# @platform/api-client

認証付き fetch ラッパ(出自: hakotora)。fetch / Blob は Web・RN 双方にあるため本体を共有できる。

- トークン取得と 401 処理は `createApiClient({ getToken, onUnauthorized })` で注入(通常は `@platform/auth` のストアを渡す)。
- ベース URL は `configureApi({ baseUrl })` で注入(Web: 相対パス既定、RN: 絶対オリジン)。
- `text/csv` は Blob、それ以外は JSON を返す。
