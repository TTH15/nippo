// 同時編集通信・サーバー処理は隔離プレビューでは行わない。
export const useCellCursors = () => ({ reportCell: () => {}, cellPeers: {}, peers: [] });
export const summarizeHistory = () => [];
