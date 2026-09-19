from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.pagesizes import A4
from pathlib import Path
import subprocess
out=Path(__file__).parent
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
c=canvas.Canvas(str(out/'table.pdf'),pagesize=A4)
c.setFont('HeiseiKakuGo-W5',19)
c.drawString(34,794,'自動車検査証記録事項（架空データ）')
rows=[('車両番号','大阪 480 り 5678'),('車台番号','DA17V-000000'),('車名','スズキ'),('型式','HBD-DA17V'),('原動機の型式','R06A'),('有効期間の満了する日','令和8年11月20日'),('検査時の走行距離','65,000km')]
y=748
for label,value in rows:
    c.rect(34,y-48,525,48);c.line(238,y,238,y-48)
    c.setFont('HeiseiKakuGo-W5',15);c.drawString(43,y-31,label)
    c.setFont('HeiseiKakuGo-W5',19);c.drawString(249,y-31,value)
    y-=48
c.setFont('HeiseiKakuGo-W5',12);c.drawString(34,y-40,'読取確認用。登録・提出には使用できません。')
c.save()
subprocess.run(['pdftoppm','-scale-to','2400','-png','-singlefile',str(out/'table.pdf'),str(out/'table')],check=True)
(out/'broken.pdf').write_bytes(b'%PDF-1.7\ninvalid preview fixture\n')
