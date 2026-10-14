import { expect, it } from "vitest";
import { bankHolderForTransfer, toHalfWidthBankHolder } from "./bankHolder";
it.each([
 ["ヤマダ　タロウ", "ﾔﾏﾀﾞ ﾀﾛｳ"], ["ﾔﾏﾀﾞ ﾀﾛｳ", "ﾔﾏﾀﾞ ﾀﾛｳ"],
 ["ミホン ｶﾞｸ", "ﾐﾎﾝ ｶﾞｸ"], ["ガギグゲゴ パピプペポ ヴ", "ｶﾞｷﾞｸﾞｹﾞｺﾞ ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ ｳﾞ"],
 ["カ\u3099キ\u3099 ハ\u309a", "ｶﾞｷﾞ ﾊﾟ"], ["カ）ミホン１２３ ＡＢＣ", "ｶ)ﾐﾎﾝ123 ABC"],
 ["ァィゥェォッャュョー・", "ｧｨｩｪｫｯｬｭｮｰ･"],
])("出力時だけ%sを半角へ揃える", (input, expected) => { expect(toHalfWidthBankHolder(input)).toBe(expected); expect(toHalfWidthBankHolder(expected)).toBe(expected); });
it("切詰めや略称置換、名義の推測をしない", () => { const name="ミホン".repeat(40); expect(bankHolderForTransfer(name)).toBe("ﾐﾎﾝ".repeat(40)); expect(toHalfWidthBankHolder("㈱ミホン")).toBe("㈱ﾐﾎﾝ"); });
it.each(["", "　", "山田 太郎", "やまだ", "ミホン😀", "㈱ミホン", "ヰヱ", "ミホン\nタロウ"])("%sを黙って壊した振込名義として出さない", value => { expect(()=>bankHolderForTransfer(value)).toThrow("口座名義"); });
