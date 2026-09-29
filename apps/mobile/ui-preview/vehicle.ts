// 隔離プレビューの架空車両。車名表示・QR fixture・3Dプレートの共通入力。
export const previewVehicle = {
  id: "preview-vehicle", name: "エブリイ", brand: "エブリイ", number_prefix: "京都", number_class: "480",
  number_hiragana: "れ", number_numeric: "12-34",
};
export const previewVehicleLabel = `${previewVehicle.name}　${previewVehicle.number_numeric}`;
export const previewTrafficVehicle = { ...previewVehicle, id: "preview-traffic", number_numeric: "56-78" };
