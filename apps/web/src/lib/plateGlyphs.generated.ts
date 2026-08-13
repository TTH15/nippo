// このファイルは自動生成。編集しないこと。
// 再生成: cd apps/web && npx tsx src/scripts/generate-plate-glyphs.ts
export const PLATE_GLYPH_CANVAS = 283.4646;
export type PlateGlyphMeta = { src: string; x: number; y: number; w: number; h: number };
export type PlateGlyphCategory = { glyphs: Record<string, PlateGlyphMeta>; refH: number; minY: number };
export const PLATE_GLYPHS: Record<"kanji" | "hiragana" | "classification" | "serial", PlateGlyphCategory> = {
  kanji: {
    glyphs: {
      "京": { src: "/number_plate/kanji/kanji_%E4%BA%AC.svg", x: 90.79, y: 91.73, w: 101.89, h: 100 },
      "大": { src: "/number_plate/kanji/kanji_%E5%A4%A7.svg", x: 92, y: 91.73, w: 99.44, h: 99.99 },
      "奈": { src: "/number_plate/kanji/kanji_%E5%A5%88.svg", x: 91.2, y: 91.74, w: 101.07, h: 99.98 },
      "滋": { src: "/number_plate/kanji/kanji_%E6%BB%8B.svg", x: 91, y: 91.74, w: 101.46, h: 99.99 },
      "練": { src: "/number_plate/kanji/kanji_%E7%B7%B4.svg", x: 89.67, y: 91.77, w: 104.12, h: 99.96 },
      "良": { src: "/number_plate/kanji/kanji_%E8%89%AF.svg", x: 91.8, y: 91.73, w: 99.85, h: 99.99 },
      "賀": { src: "/number_plate/kanji/kanji_%E8%B3%80.svg", x: 91.18, y: 91.73, w: 101.12, h: 100 },
      "都": { src: "/number_plate/kanji/kanji_%E9%83%BD.svg", x: 91.32, y: 91.73, w: 100.81, h: 100 },
      "阪": { src: "/number_plate/kanji/kanji_%E9%98%AA.svg", x: 92.35, y: 91.73, w: 98.77, h: 99.99 },
      "馬": { src: "/number_plate/kanji/kanji_%E9%A6%AC.svg", x: 90.29, y: 91.73, w: 102.89, h: 99.98 },
    },
    refH: 100,
    minY: 91.73,
  },
  hiragana: {
    glyphs: {
      "り": { src: "/number_plate/hiragana/%E3%82%8A.svg", x: 114.93, y: 91.73, w: 53.59, h: 100 },
      "れ": { src: "/number_plate/hiragana/%E3%82%8C.svg", x: 89.08, y: 91.73, w: 105.32, h: 100 },
    },
    refH: 100,
    minY: 91.73,
  },
  classification: {
    glyphs: {
      "0": { src: "/number_plate/classification_numbers/classification_0.svg", x: 113.13, y: 91.73, w: 57.2, h: 99.99 },
      "1": { src: "/number_plate/classification_numbers/classification_1.svg", x: 135.03, y: 91.73, w: 13.4, h: 99.99 },
      "3": { src: "/number_plate/classification_numbers/classification_3.svg", x: 112.59, y: 91.73, w: 58.26, h: 99.95 },
      "4": { src: "/number_plate/classification_numbers/classification_4.svg", x: 111.93, y: 91.73, w: 59.59, h: 100 },
      "5": { src: "/number_plate/classification_numbers/classification_5.svg", x: 113.07, y: 91.73, w: 57.31, h: 99.96 },
      "6": { src: "/number_plate/classification_numbers/classification_6.svg", x: 113.15, y: 91.74, w: 57.22, h: 99.97 },
      "8": { src: "/number_plate/classification_numbers/classification_8.svg", x: 112.14, y: 91.74, w: 59.15, h: 99.99 },
      "9": { src: "/number_plate/classification_numbers/classification_9.svg", x: 112.83, y: 91.74, w: 57.81, h: 99.99 },
    },
    refH: 100,
    minY: 91.73,
  },
  serial: {
    glyphs: {
      "-": { src: "/number_plate/serial_numbers/serial_numbers_-.svg", x: 123.04, y: 130.34, w: 37.38, h: 22.79 },
      "0": { src: "/number_plate/serial_numbers/serial_numbers_0.svg", x: 116.85, y: 91.73, w: 49.76, h: 99.98 },
      "1": { src: "/number_plate/serial_numbers/serial_numbers_1.svg", x: 133.58, y: 91.73, w: 16.3, h: 100 },
      "2": { src: "/number_plate/serial_numbers/serial_numbers_2.svg", x: 116.81, y: 91.73, w: 49.82, h: 100 },
      "3": { src: "/number_plate/serial_numbers/serial_numbers_3.svg", x: 116.44, y: 91.73, w: 50.58, h: 100 },
      "4": { src: "/number_plate/serial_numbers/serial_numbers_4.svg", x: 116.09, y: 91.73, w: 51.28, h: 100 },
      "5": { src: "/number_plate/serial_numbers/serial_numbers_5.svg", x: 116.8, y: 91.73, w: 49.86, h: 99.97 },
      "6": { src: "/number_plate/serial_numbers/serial_numbers_6.svg", x: 115.51, y: 91.74, w: 52.42, h: 99.98 },
      "7": { src: "/number_plate/serial_numbers/serial_numbers_7.svg", x: 116.49, y: 91.73, w: 50.49, h: 100 },
      "8": { src: "/number_plate/serial_numbers/serial_numbers_8.svg", x: 116.46, y: 91.73, w: 50.58, h: 100 },
      "9": { src: "/number_plate/serial_numbers/serial_numbers_9.svg", x: 116.51, y: 91.73, w: 50.44, h: 99.97 },
      "・": { src: "/number_plate/serial_numbers/serial_numbers_%E3%83%BB.svg", x: 127.4, y: 127.4, w: 28.66, h: 28.66 },
    },
    refH: 100,
    minY: 91.73,
  },
};
