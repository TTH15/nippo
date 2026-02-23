const q = sel => document.querySelector(sel);
const fmt = (n, cur) => (cur || "¥") + Number(n || 0).toLocaleString();

// ACE CREATIONの固定情報
const ACE_CREATION = {
    name: '株式会社ACE CREATION',
    address: '〒615-0904<br />京都市右京区梅津堤上町21 KKハウスⅡ 101',
    tel: '080-9540-4451',
    regNo: 'T6130001080238',
    entityType: 'both' // 法人・個人どちらでも選択可能
};

// API経由でアドレスを取得（会社コードに紐づくDBから）
async function apiFetch(path) {
    const token = localStorage.getItem('nippo_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, { headers });
    if (!res.ok) throw new Error('API error: ' + res.status);
    return res.json();
}

// アドレス帳管理（DBから取得、編集はアドレス帳ページ・ドライバー管理で行う）
class AddressBook {
    constructor() {
        this.addresses = [];
        this.loaded = false;
    }

    async loadFromApi() {
        if (this.loaded) return;
        try {
            const [addrRes, usersRes] = await Promise.all([
                apiFetch('/api/admin/invoice-addresses'),
                apiFetch('/api/admin/users')
            ]);
            const corporate = (addrRes.addresses || []).map(a => ({
                id: 'corp-' + a.id,
                name: a.name,
                entityType: 'corporate',
                postalCode: a.postal_code || '',
                address: a.address || '',
                phone: a.phone || '',
                invoiceNo: a.invoice_no || ''
            }));
            const drivers = (usersRes.drivers || []).filter(d => d.role === 'DRIVER');
            const individual = drivers.map(d => ({
                id: 'drv-' + d.id,
                name: d.name,
                entityType: 'individual',
                postalCode: d.postal_code || '',
                address: d.address || '',
                phone: d.phone || '',
                bankName: d.bank_name || '',
                bankNo: d.bank_no || '',
                bankHolder: d.bank_holder || ''
            }));
            this.addresses = [...corporate, ...individual];
            this.loaded = true;
        } catch (err) {
            console.error('アドレス帳の読み込みエラー:', err);
            this.addresses = [];
        }
    }

    async refresh() {
        this.loaded = false;
        await this.loadFromApi();
    }

    getCorporateAddresses() {
        return this.addresses.filter(addr => addr.entityType === 'corporate');
    }

    getIndividualAddresses() {
        return this.addresses.filter(addr => addr.entityType === 'individual');
    }

    getAddress(id) {
        return this.addresses.find(addr => addr.id === id);
    }

    getAllAddresses() {
        return this.addresses;
    }
}

// グローバルアドレス帳インスタンス
const addressBook = new AddressBook();

// テーブルに行を追加する新しい関数
function addTableRow(kind) {
    const tbody = q('#p_' + kind);
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input class="editable-cell" placeholder="摘要" value="" /></td>
        <td class="right"><input class="editable-cell" type="number" step="1" placeholder="数量" value="" style="text-align:right" /></td>
        <td class="right"><input class="editable-cell" type="number" step="1" placeholder="単価" value="" style="text-align:right" /></td>
        <td class="right calculated-amount">¥0</td>
    `;

    // 削除ボタンを追加（印刷時は非表示）
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn small hide-print';
    deleteBtn.textContent = '×';
    deleteBtn.style.position = 'absolute';
    deleteBtn.style.right = '-30px';
    deleteBtn.style.top = '50%';
    deleteBtn.style.transform = 'translateY(-50%)';
    deleteBtn.onclick = () => {
        row.remove();
        calculateTotals();
        updateAddButtonPositions(); // ボタン位置を更新
        saveData();
    };

    row.style.position = 'relative';
    row.appendChild(deleteBtn);

    // 入力フィールドにイベントリスナーを追加
    const inputs = row.querySelectorAll('input');
    inputs.forEach((input, index) => {
        input.addEventListener('input', () => {
            updateRowAmount(row);
            calculateTotals();
            saveData();
        });

        // 単価フィールド（index 2）に¥マーク追加のイベントリスナー
        if (index === 2) {
            input.addEventListener('input', () => {
                addYenSymbolToInput(input, '単価');
            });
            input.addEventListener('blur', () => {
                addYenSymbolToInput(input, '単価');
            });
        }
    });

    tbody.appendChild(row);
    updateRowAmount(row);
    calculateTotals();
    updateAddButtonPositions(); // ボタン位置を更新
    saveData();
}

// 行の金額を更新
function updateRowAmount(row) {
    const inputs = row.querySelectorAll('input');
    const qty = parseFloat(inputs[1].value || 0); // 数量が1番目に戻る
    const price = parseFloat(inputs[2].value || 0); // 単価が2番目に戻る
    const amount = qty * price;
    const amountCell = row.querySelector('.calculated-amount');
    amountCell.textContent = `¥${Number(amount || 0).toLocaleString()}`; // 金額に¥マークを追加

    // 単価フィールドに¥マークを追加
    const priceInput = inputs[2];
    addYenSymbolToInput(priceInput, '単価');
}

// 入力フィールドに¥マークを追加する関数
function addYenSymbolToInput(input, type) {
    if (!input || !input.parentElement) return;

    const parentTd = input.parentElement;
    if (parentTd.style.position !== 'relative') {
        parentTd.style.position = 'relative';
    }

    // 既存の¥マークを削除
    const existingSymbol = parentTd.querySelector('.yen-symbol');
    if (existingSymbol) {
        existingSymbol.remove();
    }

    // 値がある場合のみ¥マークを表示
    if (input.value) {
        const yenSymbol = document.createElement('span');
        yenSymbol.textContent = '¥';
        yenSymbol.className = 'yen-symbol';
        yenSymbol.style.position = 'absolute';
        yenSymbol.style.left = '4px';
        yenSymbol.style.top = '50%';
        yenSymbol.style.transform = 'translateY(-50%)';
        yenSymbol.style.pointerEvents = 'none';
        yenSymbol.style.color = '#000';  // 黒色に変更
        yenSymbol.style.fontSize = '14px';
        parentTd.appendChild(yenSymbol);
        input.style.paddingLeft = '18px';
    } else {
        input.style.paddingLeft = '';
    }
}

// 合計を計算
function calculateTotals() {
    const getTableTotal = (tableId) => {
        const rows = q('#' + tableId).querySelectorAll('tr');
        let total = 0;
        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs.length >= 3) { // 3列に変更
                const qty = parseFloat(inputs[1].value || 0); // 数量が1番目に戻る
                const price = parseFloat(inputs[2].value || 0); // 単価が2番目に戻る
                total += qty * price;
            }
        });
        return total;
    };

    const mainTotal = getTableTotal('p_main');
    const deductTotal = getTableTotal('p_deduct');

    const subtotal = mainTotal;

    // 消費税設定を取得
    const taxEnabled = q('#taxEnabled')?.checked ?? true;
    const taxRateInput = q('#taxRate');
    const taxRatePercent = taxEnabled && taxRateInput ? parseFloat(taxRateInput.value) || 0 : 0;
    const taxRate = taxRatePercent / 100;
    const tax = taxEnabled ? Math.round(subtotal * taxRate) : 0;
    const total = subtotal + tax - deductTotal;

    q('#p_subtotal').textContent = `¥${Number(subtotal).toLocaleString()}`;

    // 消費税行の表示と値の設定
    const taxRow = q('#p_taxRow');
    const taxAmount = q('#p_tax');
    const taxLabel = q('#p_taxLabel');
    if (taxRow && taxAmount && taxLabel) {
        taxRow.style.display = 'flex';
        if (taxEnabled) {
            // 消費税ON: 外税として消費税を表示
            taxAmount.textContent = `¥${Number(tax).toLocaleString()}`;
            taxLabel.textContent = `消費税（${Math.round(taxRatePercent)}%）`;
        } else {
            // 消費税OFF: 内税として逆算した消費税を表示
            // 内消費税 = 合計 × 税率 / (1 + 税率)
            const taxRateForCalc = (q('#taxRate')?.value || 10) / 100;
            const innerTax = Math.round(total * taxRateForCalc / (1 + taxRateForCalc));
            taxAmount.textContent = `¥${Number(innerTax).toLocaleString()}`;
            taxLabel.textContent = `内消費税`;
        }
    }

    q('#p_deductTotal').textContent = `¥${Number(deductTotal).toLocaleString()}`;
    q('#p_total').textContent = `¥${Number(total).toLocaleString()}`;

    // ご請求金額に合計を表示
    q('#p_billAmountDisplay').textContent = `¥${Number(total).toLocaleString()}（税込）`;
}

// データを保存用に収集
function getDataFromTables() {
    const getTableData = (tableId) => {
        const rows = q('#' + tableId).querySelectorAll('tr');
        const data = [];
        rows.forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs.length >= 3) {
                data.push({
                    title: inputs[0].value || '',
                    qty: parseFloat(inputs[1].value || 0), // 数量が1番目に戻る
                    price: parseFloat(inputs[2].value || 0) // 単価が2番目に戻る
                });
            }
        });
        return data;
    };

    return {
        main: getTableData('p_main'),
        deduct: getTableData('p_deduct')
    };
}

// テーブルにデータを設定
function setDataToTables(data) {
    const setTableData = (tableId, items) => {
        const tbody = q('#' + tableId);
        tbody.innerHTML = '';
        items.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><input class="editable-cell" value="${item.title || ''}" /></td>
                <td class="right"><input class="editable-cell" type="number" step="1" value="${item.qty || ''}" style="text-align:right" /></td>
                <td class="right"><input class="editable-cell" type="number" step="1" value="${item.price || ''}" style="text-align:right" /></td>
                <td class="right calculated-amount">¥0</td>
            `;

            // 削除ボタンを追加
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn small hide-print';
            deleteBtn.textContent = '×';
            deleteBtn.style.position = 'absolute';
            deleteBtn.style.right = '-30px';
            deleteBtn.style.top = '50%';
            deleteBtn.style.transform = 'translateY(-50%)';
            deleteBtn.onclick = () => {
                row.remove();
                calculateTotals();
                updateAddButtonPositions(); // ボタン位置を更新
                saveData();
            };

            row.style.position = 'relative';
            row.appendChild(deleteBtn);

            // イベントリスナーを追加
            const inputs = row.querySelectorAll('input');
            inputs.forEach((input, index) => {
                input.addEventListener('input', () => {
                    updateRowAmount(row);
                    calculateTotals();
                    saveData();
                });

                // 単価フィールド（index 2）に¥マーク追加のイベントリスナー
                if (index === 2) {
                    input.addEventListener('input', () => {
                        addYenSymbolToInput(input, '単価');
                    });
                    input.addEventListener('blur', () => {
                        addYenSymbolToInput(input, '単価');
                    });
                }
            });

            tbody.appendChild(row);
            updateRowAmount(row);
        });
    };

    setTableData('p_main', data.main || []);
    setTableData('p_deduct', data.deduct || []);

    calculateTotals();
    updateAddButtonPositions(); // データ設定後にボタン位置を更新
}

// 追加ボタンの位置を更新する関数（もう使用しない - ボタンはセクションヘッダー内に固定）
function updateAddButtonPositions() {
    // ボタンは今やセクションヘッダー内に配置されているため、この関数は不要
    // 互換性のため空の関数として残す
}

// render関数
function render() {
    // 計算の更新のみ（初期値はsyncPartiesToInvoiceで設定される）
    calculateTotals();
}

// PDFファイル名を生成
function generatePDFFileName() {
    // p_subjectから年月を抽出（例: "2025年12月稼働分" → "202512", "12月分"）
    const subjectText = q('#p_subject')?.textContent?.trim() || '';
    let yearMonth = '';
    let monthLabel = '';

    // 年月を抽出する正規表現（例: 2025年12月）
    const match = subjectText.match(/(\d{4})年(\d{1,2})月/);
    if (match) {
        const year = match[1];
        const month = match[2].padStart(2, '0');
        yearMonth = `${year}${month}`;
        monthLabel = `${match[2]}月分`;
    } else {
        // マッチしない場合は現在の年月を使用
        const now = new Date();
        now.setMonth(now.getMonth() - 1); // 前月
        yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        monthLabel = `${now.getMonth() + 1}月分`;
    }

    // 請求元の名前を取得
    const fromName = q('#p_fromName')?.textContent?.trim() || '請求書';

    // ファイル名に使用できない文字を除去
    const safeName = fromName.replace(/[\\/:*?"<>|]/g, '');

    return `${yearMonth}_${monthLabel}御請求書_${safeName}.pdf`;
}

async function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const sheet = q('#sheet');

    // PDF生成クラスを追加
    sheet.classList.add('pdf-generating');

    // PDF生成時にボタンを一時的に非表示にする
    const buttons = sheet.querySelectorAll('button, .btn, .add-btn');
    const originalStyles = [];

    // ボタンを非表示にして元のスタイルを保存
    buttons.forEach((btn, index) => {
        originalStyles[index] = btn.style.display;
        btn.style.display = 'none';
        btn.style.visibility = 'hidden';
    });

    try {
        // レンダリング完了を十分に待つ
        await new Promise(resolve => setTimeout(resolve, 500));

        // html2canvasでキャプチャ
        const canvas = await html2canvas(sheet, {
            scale: 6,              // ファイルサイズ削減（2倍）
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            windowWidth: sheet.scrollWidth,
            windowHeight: sheet.scrollHeight,
            width: sheet.scrollWidth,
            height: sheet.scrollHeight,
            scrollX: 0,
            scrollY: 0,
            x: 0,
            y: 0,
            letterRendering: true,
            foreignObjectRendering: false,
            ignoreElements: (element) => {
                // ボタン要素を完全に無視
                return element.tagName === 'BUTTON' ||
                    element.classList.contains('btn') ||
                    element.classList.contains('add-btn') ||
                    element.classList.contains('add-row-btn');
            },
            onclone: (clonedDoc) => {
                // クローンされたドキュメントのスタイルを調整
                const clonedSheet = clonedDoc.querySelector('#sheet');
                if (clonedSheet) {
                    clonedSheet.style.width = '210mm';
                    clonedSheet.style.height = '297mm';
                    clonedSheet.style.transform = 'none';
                    clonedSheet.style.overflow = 'visible';
                }

                // すべてのボタンを非表示に
                const buttons = clonedDoc.querySelectorAll('button, .btn, .add-btn, .add-row-btn');
                buttons.forEach(btn => {
                    btn.style.display = 'none';
                    btn.style.visibility = 'hidden';
                });

                // セクション名の行の高さ（文字が切れないよう余裕を持たせる）
                const sectionRows = clonedDoc.querySelectorAll('.section-row');
                sectionRows.forEach(row => {
                    row.style.height = 'auto';
                    row.style.lineHeight = '1.6';
                    row.style.overflow = 'visible';
                });

                // セクション名セルのパディング（文字が切れないよう余裕を持たせる）
                const sectionCells = clonedDoc.querySelectorAll('.section-name-cell');
                sectionCells.forEach(cell => {
                    cell.style.paddingTop = '6px';
                    cell.style.paddingBottom = '6px';
                    cell.style.overflow = 'visible';
                });

                // セクションヘッダーのコンテンツの余白
                const sectionContents = clonedDoc.querySelectorAll('.section-header-content');
                sectionContents.forEach(content => {
                    content.style.paddingTop = '3px';
                    content.style.paddingBottom = '3px';
                });

                // すべてのテーブルセルに overflow: visible を設定
                const allTds = clonedDoc.querySelectorAll('.tbl tbody td');
                allTds.forEach(td => {
                    td.style.overflow = 'visible';
                });

                // 編集可能セルも同様に
                const editableCells = clonedDoc.querySelectorAll('.editable-cell');
                editableCells.forEach(cell => {
                    cell.style.overflow = 'visible';
                });
            }
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.7); // JPEG圧縮で軽量化
        const pdf = new jsPDF('p', 'mm', 'a4');

        // 画像をA4サイズに正確にフィット
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);

        // ファイル名を生成: 「202512_12月分御請求書_〇〇.pdf」
        const fileName = generatePDFFileName();
        pdf.save(fileName);
    } finally {
        // ボタンを元の状態に戻す
        buttons.forEach((btn, index) => {
            btn.style.display = originalStyles[index];
            btn.style.visibility = '';
        });

        // PDF生成クラスを削除
        sheet.classList.remove('pdf-generating');
    }
}

// 新しいsaveData関数（プレビューから直接データを取得）
function saveData() {
    const data = {
        // ヘッダー情報
        toName: q('#p_toCompany')?.textContent || '',
        toAddr: q('#p_toAddr').innerHTML,
        subject: q('#p_subject').textContent,
        issueDate: q('#p_issueDate').textContent,
        invoiceNo: q('#p_invoiceNo').textContent,
        billAmountDisplay: q('#p_billAmountDisplay').textContent,

        // 差出人情報
        fromName: q('#p_fromName').textContent,
        fromAddr: q('#p_fromAddr').innerHTML,
        fromTel: q('#p_fromTel').textContent,
        fromReg: q('#p_fromReg').textContent,

        // 銀行情報
        dueDate: q('#p_dueDate').textContent,
        bankName: q('#p_bankName').textContent,
        bankNo: q('#p_bankNo').textContent,
        bankHolder: q('#p_bankHolder').textContent,
        notes: q('#p_notes').innerHTML,

        // テーブルデータ
        tableData: getDataFromTables(),

        // セクション選択データ
        sectionSelections: {
            main: document.querySelector('.section-select[data-section="main"]')?.value || 'Amazon'
        },

        // 請求先・請求元データ
        parties: {
            fromParty: q('#fromParty')?.value || ACE_CREATION.name,
            toParty: q('#toParty')?.value || ''
        }
    };
    localStorage.setItem('invoice_direct_edit_v1', JSON.stringify(data));
}


// 請求先・請求元の同期関数（新しい選択機能対応）
function syncPartiesToInvoice() {
    const fromSelect = q('#fromPartySelect');
    const toSelect = q('#toPartySelect');

    if (!fromSelect || !toSelect) {
        console.warn('請求先・請求元の選択欄が見つかりません');
        return;
    }

    // 請求元の処理
    let fromParty = '';
    let fromData = null;

    if (fromSelect.value === 'ace_creation') {
        fromParty = ACE_CREATION.name;
        fromData = ACE_CREATION;
    } else if (fromSelect.value === 'new') {
        fromParty = '新規のアドレス';
        fromData = { name: fromParty };
    } else {
        const address = addressBook.getAddress(fromSelect.value);
        if (address) {
            fromParty = address.name;
            fromData = address;
        }
    }

    // 請求先の処理
    let toParty = '';
    let toData = null;

    if (toSelect.value === 'ace_creation') {
        toParty = ACE_CREATION.name;
        toData = ACE_CREATION;
    } else if (toSelect.value === 'new') {
        toParty = '新規のアドレス';
        toData = { name: toParty };
    } else {
        const address = addressBook.getAddress(toSelect.value);
        if (address) {
            toParty = address.name;
            toData = address;
        }
    }

    // 請求書の請求先（to）を更新
    const toCompanyElem = q('#p_toCompany');
    const toAddrElem = q('#p_toAddr');

    if (toCompanyElem && toAddrElem) {
        toCompanyElem.textContent = toParty || '株式会社';

        if (toData === ACE_CREATION) {
            // ACE CREATIONが請求先の場合、電話番号と登録番号も表示
            toAddrElem.innerHTML = ACE_CREATION.address;
            // 請求先の電話・登録番号（存在すれば）を表示
            const toTelContainer = q('#p_toTelContainer');
            const toRegContainer = q('#p_toRegContainer');
            const toTelElem = q('#p_toTel');
            const toRegElem = q('#p_toReg');
            if (toTelContainer && toTelElem) {
                toTelElem.textContent = ACE_CREATION.tel;
                toTelContainer.style.display = 'block';
            }
            if (toRegContainer && toRegElem) {
                toRegElem.textContent = ACE_CREATION.regNo;
                toRegContainer.style.display = 'block';
            }
        } else if (toData && toData.address) {
            // アドレス帳からの住所
            let addressHtml = '';
            if (toData.postalCode) {
                addressHtml += `〒${toData.postalCode}<br />`;
            }
            if (toData.address) {
                addressHtml += toData.address;
            }
            toAddrElem.innerHTML = addressHtml || '〒<br />（住所）';

            // 請求先の電話・登録番号は値がある時だけ表示
            const toTelContainer = q('#p_toTelContainer');
            const toRegContainer = q('#p_toRegContainer');
            const toTelElem = q('#p_toTel');
            const toRegElem = q('#p_toReg');
            if (toTelContainer && toTelElem) {
                if (toData.phone) {
                    toTelElem.textContent = toData.phone;
                    toTelContainer.style.display = 'block';
                } else {
                    toTelElem.textContent = '';
                    toTelContainer.style.display = 'none';
                }
            }
            if (toRegContainer && toRegElem) {
                if (toData.invoiceNo) {
                    toRegElem.textContent = toData.invoiceNo;
                    toRegContainer.style.display = 'block';
                } else {
                    toRegElem.textContent = '';
                    toRegContainer.style.display = 'none';
                }
            }
        } else {
            toAddrElem.innerHTML = '〒<br />（住所）';
            // 値がない場合は非表示
            const toTelContainer = q('#p_toTelContainer');
            const toRegContainer = q('#p_toRegContainer');
            const toTelElem = q('#p_toTel');
            const toRegElem = q('#p_toReg');
            if (toTelContainer && toTelElem) {
                toTelElem.textContent = '';
                toTelContainer.style.display = 'none';
            }
            if (toRegContainer && toRegElem) {
                toRegElem.textContent = '';
                toRegContainer.style.display = 'none';
            }
        }
    }

    // 請求書の請求元（from）を更新
    const fromNameElem = q('#p_fromName');
    const fromAddrElem = q('#p_fromAddr');
    const fromTelElem = q('#p_fromTel');
    const fromRegElem = q('#p_fromReg');

    if (fromNameElem && fromAddrElem && fromTelElem && fromRegElem) {
        fromNameElem.textContent = fromParty || '株式会社ACE CREATION';

        const fromTelContainer = q('#p_fromTelContainer');
        const fromRegContainer = q('#p_fromRegContainer');

        if (fromData === ACE_CREATION) {
            // ACE CREATIONが請求元の場合
            fromAddrElem.innerHTML = ACE_CREATION.address;
            fromTelElem.textContent = ACE_CREATION.tel;
            fromRegElem.textContent = ACE_CREATION.regNo;

            // ACE CREATIONの場合は電話・登録番号を表示
            if (fromTelContainer) fromTelContainer.style.display = 'block';
            if (fromRegContainer) fromRegContainer.style.display = 'block';

            // ACE CREATIONの印鑑を表示
            const aceStamp = q('#aceStamp');
            if (aceStamp) aceStamp.style.display = 'block';
        } else if (fromData && fromData.address) {
            // アドレス帳からの情報
            let addressHtml = '';
            if (fromData.postalCode) {
                addressHtml += `〒${fromData.postalCode}<br />`;
            }
            if (fromData.address) {
                addressHtml += fromData.address;
            }
            fromAddrElem.innerHTML = addressHtml || '';

            // 電話番号・登録番号は値がある場合のみ表示
            if (fromData.phone) {
                fromTelElem.textContent = fromData.phone;
                if (fromTelContainer) fromTelContainer.style.display = 'block';
            } else {
                fromTelElem.textContent = '';
                if (fromTelContainer) fromTelContainer.style.display = 'none';
            }

            if (fromData.invoiceNo) {
                fromRegElem.textContent = fromData.invoiceNo;
                if (fromRegContainer) fromRegContainer.style.display = 'block';
            } else {
                fromRegElem.textContent = '';
                if (fromRegContainer) fromRegContainer.style.display = 'none';
            }

            // ACE CREATION以外の場合は印鑑を非表示
            const aceStamp2 = q('#aceStamp');
            if (aceStamp2) aceStamp2.style.display = 'none';
        } else {
            fromAddrElem.innerHTML = '';
            fromTelElem.textContent = '';
            fromRegElem.textContent = '';

            // 空の場合は非表示
            if (fromTelContainer) fromTelContainer.style.display = 'none';
            if (fromRegContainer) fromRegContainer.style.display = 'none';

            // ACE CREATION以外の場合は印鑑を非表示
            const aceStamp = q('#aceStamp');
            if (aceStamp) aceStamp.style.display = 'none';
        }

        // 請求元に応じて振込先情報を更新
        if (fromData === ACE_CREATION) {
            // ACE CREATIONの場合、固定の振込先情報を表示
            const dueDateElem = q('#p_dueDate');
            const bankNameElem = q('#p_bankName');
            const bankNoElem = q('#p_bankNo');
            const bankHolderElem = q('#p_bankHolder');

            if (dueDateElem) dueDateElem.textContent = '2025年12月31日';
            if (bankNameElem) bankNameElem.textContent = '京都信用金庫 梅津支店';
            if (bankNoElem) bankNoElem.textContent = '普通 3058832';
            if (bankHolderElem) bankHolderElem.textContent = '口座名義：カ)ｴｰｽｸﾘｴｲｼｮﾝ';
        } else if (fromData && fromData.entityType === 'individual' && (fromData.bankName || fromData.bankNo || fromData.bankHolder)) {
            // 個人の場合は登録された振込先情報を使用
            const dueDateElem = q('#p_dueDate');
            const bankNameElem = q('#p_bankName');
            const bankNoElem = q('#p_bankNo');
            const bankHolderElem = q('#p_bankHolder');

            if (dueDateElem) dueDateElem.textContent = '2025年12月31日';
            if (bankNameElem) bankNameElem.textContent = fromData.bankName || '';
            if (bankNoElem) bankNoElem.textContent = fromData.bankNo || '';
            if (bankHolderElem) bankHolderElem.textContent = fromData.bankHolder || '';
        }
    }

    // ACE CREATIONが請求先の場合、電話番号と登録番号は表示しない（請求先には不要）

    saveData();
}


// 請求先と請求元を入れ替える関数（新しい選択機能対応）
function swapParties() {
    const fromSelect = q('#fromPartySelect');
    const toSelect = q('#toPartySelect');

    if (!fromSelect || !toSelect) return;

    // 現在の値を取得
    const fromValue = fromSelect.value;
    const toValue = toSelect.value;

    // 値を入れ替え
    fromSelect.value = toValue;
    toSelect.value = fromValue;

    // 請求書に反映
    syncPartiesToInvoice();
}

// 請求先・請求元選択のイベントリスナー
function setupPartiesListeners() {
    const fromSelect = q('#fromPartySelect');
    const toSelect = q('#toPartySelect');
    const swapBtn = q('#swapPartiesBtn');

    // 請求元選択の変更
    if (fromSelect) {
        fromSelect.addEventListener('change', syncPartiesToInvoice);
    }

    // 請求先選択の変更
    if (toSelect) {
        toSelect.addEventListener('change', syncPartiesToInvoice);
    }

    // 入れ替えボタン
    if (swapBtn) {
        swapBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            swapParties();
        });
    }
}

// アドレス帳UI関連の関数
async function openAddressBookModal() {
    const modal = q('#addressBookModal');
    modal.style.display = 'flex';
    try {
        await addressBook.loadFromApi();
    } catch (e) {
        console.error(e);
    }
    renderAddressLists();
    hideAddressForm();
    switchTab('corporate');
}

function closeAddressBookModal() {
    const modal = q('#addressBookModal');
    modal.style.display = 'none';
    hideAddressForm();
}

function showAddressForm(entityType = null) {
    const form = q('#addressForm');
    form.style.display = 'block';
    clearAddressForm();

    if (entityType) {
        // 隠しフィールドに種別を設定
        const hiddenInput = q('#entityTypeHidden');
        if (hiddenInput) hiddenInput.value = entityType;
        updateFormLabels(entityType);

        const label = entityType === 'individual' ? '個人' : '法人';
        q('#formTitle').textContent = `新しい${label}を追加`;
    } else {
        q('#formTitle').textContent = '新しいアドレスを追加';
    }
}

function hideAddressForm() {
    const form = q('#addressForm');
    form.style.display = 'none';
    clearAddressForm();
}

// タブ切り替え機能
function switchTab(tabType) {
    // タブボタンのアクティブ状態を更新
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabType);
    });

    // タブコンテンツの表示を更新
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabType}Tab`);
    });
}

function clearAddressForm() {
    q('#newCompanyName').value = '';
    q('#newPostalCode').value = '';
    q('#newAddress').value = '';
    q('#newPhone').value = '';
    q('#newInvoiceNo').value = '';
    q('#newBankName').value = '';
    q('#newBankNo').value = '';
    q('#newBankHolder').value = '';

    // 法人をデフォルトに設定
    const hiddenInput = q('#entityTypeHidden');
    if (hiddenInput) hiddenInput.value = 'corporate';
    updateFormLabels('corporate');
}

// フォームのラベルを更新（法人・個人に応じて）
function updateFormLabels(entityType = null) {
    if (!entityType) {
        const hiddenInput = q('#entityTypeHidden');
        entityType = hiddenInput ? hiddenInput.value : 'corporate';
    }

    const nameLabel = q('#nameLabel');
    const nameInput = q('#newCompanyName');
    const bankSection = q('#bankInfoSection');

    if (entityType === 'individual') {
        nameLabel.textContent = '氏名 *';
        nameInput.placeholder = '田中太郎';
        // 個人の場合は振込先情報を表示
        if (bankSection) bankSection.style.display = 'block';
    } else {
        nameLabel.textContent = '会社名 *';
        nameInput.placeholder = '株式会社○○';
        // 法人の場合は振込先情報を非表示
        if (bankSection) bankSection.style.display = 'none';
    }
}

function saveNewAddress() {
    const name = q('#newCompanyName').value.trim();
    const hiddenInput = q('#entityTypeHidden');
    const entityType = hiddenInput ? hiddenInput.value : 'corporate';
    const editingId = q('#addressForm').dataset.editingId;

    if (!name) {
        const label = entityType === 'individual' ? '氏名' : '会社名';
        alert(`${label}は必須です。`);
        return;
    }

    // 個人の場合は振込先情報が必須
    if (entityType === 'individual') {
        const bankName = q('#newBankName').value.trim();
        const bankNo = q('#newBankNo').value.trim();
        const bankHolder = q('#newBankHolder').value.trim();

        if (!bankName || !bankNo || !bankHolder) {
            alert('個人登録時は振込先情報（金融機関名、口座種別・番号、口座名義）がすべて必須です。');
            return;
        }
    }

    const address = {
        name: name,
        entityType: entityType || 'corporate',
        postalCode: q('#newPostalCode').value.trim(),
        address: q('#newAddress').value.trim(),
        phone: q('#newPhone').value.trim(),
        invoiceNo: q('#newInvoiceNo').value.trim()
    };

    // 個人の場合は振込先情報も保存
    if (entityType === 'individual') {
        address.bankName = q('#newBankName').value.trim();
        address.bankNo = q('#newBankNo').value.trim();
        address.bankHolder = q('#newBankHolder').value.trim();
    }

    // 編集中の場合はIDを保持
    if (editingId) {
        address.id = editingId;
        delete q('#addressForm').dataset.editingId;
    }

    addressBook.addAddress(address);
    renderAddressLists();
    updatePartySelects();
    hideAddressForm();

    const message = editingId ? 'アドレスを更新しました。' : 'アドレスを保存しました。';
    alert(message);
}

function deleteAddress(id) {
    if (confirm('このアドレスを削除しますか？')) {
        addressBook.deleteAddress(id);
        renderAddressLists();
        updatePartySelects();
    }
}

function editAddress(id) {
    const address = addressBook.getAddress(id);
    if (address) {
        showAddressForm();
        q('#formTitle').textContent = 'アドレスを編集';

        // 種別を隠しフィールドに設定
        const hiddenInput = q('#entityTypeHidden');
        if (hiddenInput) hiddenInput.value = address.entityType || 'corporate';
        updateFormLabels(address.entityType || 'corporate');

        // その他のフィールドを設定
        q('#newCompanyName').value = address.name;
        q('#newPostalCode').value = address.postalCode || '';
        q('#newAddress').value = address.address || '';
        q('#newPhone').value = address.phone || '';
        q('#newInvoiceNo').value = address.invoiceNo || '';

        // 振込先情報を設定（個人の場合）
        if (address.entityType === 'individual') {
            q('#newBankName').value = address.bankName || '';
            q('#newBankNo').value = address.bankNo || '';
            q('#newBankHolder').value = address.bankHolder || '';
        }

        // 編集中のIDを保存（保存時に使用）
        q('#addressForm').dataset.editingId = id;
    }
}

function renderAddressLists() {
    renderCorporateList();
    renderIndividualList();
}

function renderCorporateList() {
    const container = q('#corporateListContainer');
    const addresses = addressBook.getCorporateAddresses();

    if (addresses.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">法人アドレスがありません。<br><a href="/admin/invoices/addressbook" target="_top" style="color: #007bff;">アドレス帳</a>で登録してください。</p>';
        return;
    }

    container.innerHTML = addresses.map(addr => createAddressItemHtml(addr, false)).join('');
}

function renderIndividualList() {
    const container = q('#individualListContainer');
    const addresses = addressBook.getIndividualAddresses();

    if (addresses.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">個人アドレスがありません。<br><a href="/admin/users" target="_top" style="color: #007bff;">ドライバー管理</a>で住所・振込先を登録してください。</p>';
        return;
    }

    container.innerHTML = addresses.map(addr => createAddressItemHtml(addr, false)).join('');
}

function createAddressItemHtml(addr, showBadge = true) {
    const entityTypeLabel = addr.entityType === 'individual' ? '個人' : '法人';
    const badgeHtml = showBadge ? `<span class="entity-badge ${addr.entityType}">${entityTypeLabel}</span>` : '';

    // 振込先情報の表示（個人の場合）
    let bankInfoHtml = '';
    if (addr.entityType === 'individual' && (addr.bankName || addr.bankNo || addr.bankHolder)) {
        bankInfoHtml = '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee; color: #007bff;">【振込先】';
        if (addr.bankName) bankInfoHtml += `<div>${addr.bankName}</div>`;
        if (addr.bankNo) bankInfoHtml += `<div>${addr.bankNo}</div>`;
        if (addr.bankHolder) bankInfoHtml += `<div>${addr.bankHolder}</div>`;
        bankInfoHtml += '</div>';
    }

    return `
        <div class="address-item">
            <div class="address-item-header">
                <div class="address-item-name">
                    ${addr.name}
                    ${badgeHtml}
                </div>
            </div>
            <div class="address-item-details">
                ${addr.postalCode ? `<div>〒 ${addr.postalCode}</div>` : ''}
                ${addr.address ? `<div>${addr.address}</div>` : ''}
                ${addr.phone ? `<div>電話: ${addr.phone}</div>` : ''}
                ${addr.invoiceNo ? `<div>登録番号: ${addr.invoiceNo}</div>` : ''}
                ${bankInfoHtml}
            </div>
        </div>
    `;
}

function updatePartySelects() {
    const fromSelect = q('#fromPartySelect');
    const toSelect = q('#toPartySelect');

    // 法人・個人のアドレスを分けて取得
    const corporateAddresses = addressBook.getCorporateAddresses();
    const individualAddresses = addressBook.getIndividualAddresses();

    // 請求元のオプションを更新（個人のみ + ACE CREATION）
    const fromCurrentValue = fromSelect.value;
    fromSelect.innerHTML = `
        <option value="ace_creation">株式会社ACE CREATION</option>
        ${individualAddresses.map(addr => `<option value="${addr.id}">${addr.name}（個人）</option>`).join('')}
        <option value="new">新規のアドレスを入力</option>
    `;
    if (fromCurrentValue && fromSelect.querySelector(`option[value="${fromCurrentValue}"]`)) {
        fromSelect.value = fromCurrentValue;
    }

    // 請求先のオプションを更新（法人のみ + ACE CREATION）
    const toCurrentValue = toSelect.value;
    toSelect.innerHTML = `
        <option value="ace_creation">株式会社ACE CREATION</option>
        ${corporateAddresses.map(addr => `<option value="${addr.id}">${addr.name}（法人）</option>`).join('')}
        <option value="new">新規のアドレスを入力</option>
    `;
    if (toCurrentValue && toSelect.querySelector(`option[value="${toCurrentValue}"]`)) {
        toSelect.value = toCurrentValue;
    }
}

// イベントリスナー設定
q('#pdfBtn').onclick = downloadPDF;
q('#printBtn').onclick = () => window.print();
q('#addressBookBtn').onclick = openAddressBookModal;
q('#addressBookClose').onclick = closeAddressBookModal;

// モーダル外クリックで閉じる
document.addEventListener('click', (e) => {
    const modal = q('#addressBookModal');
    if (e.target === modal) {
        closeAddressBookModal();
    }
});

// 初期化関数
async function initializeApp() {
    // 固定値を設定
    q('#p_greeting').textContent = '下記の通りご請求申し上げます。';

    // 初期値を設定（件名：前月の稼働分）
    if (!q('#p_subject').textContent.trim()) {
        const prevMonthStr = (() => {
            const d = new Date();
            d.setMonth(d.getMonth() - 1); // 1ヶ月前
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            return `${y}年${m}月稼働分`;
        })();
        q('#p_subject').textContent = prevMonthStr;
    }

    // 日付の初期設定（空 or プレースホルダーなら本日の日付を設定）
    const issueDateEl = q('#p_issueDate');
    const dueDateEl = q('#p_dueDate');
    const todayStr = (() => {
        const d = new Date();
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const day = d.getDate();
        return `${y}年${m}月${day}日`;
    })();
    const isPlaceholderDate = (t) => {
        const s = (t || '').trim();
        if (s === '') return true;
        // 例: "2025年 月 日" のように月と日が空白
        if (/^\d{4}年\s*月\s*日$/.test(s)) return true;
        // 例: "----年--月--日" のようなプレースホルダー
        if (/^-{2,}年?-{0,}月?-{0,}日?$/.test(s)) return true;
        return false;
    };

    if (issueDateEl && isPlaceholderDate(issueDateEl.textContent)) {
        issueDateEl.textContent = todayStr;
    }
    if (dueDateEl && isPlaceholderDate(dueDateEl.textContent)) {
        dueDateEl.textContent = todayStr;
    }

    // イベントリスナーを設定
    setupEditListeners();
    setupSectionSelectors();
    setupPartiesListeners();
    setupAddressFormListeners();
    setupTaxControls();

    // 日付同期リスナー（請求日を変更したら振込期日も同時に更新）
    if (issueDateEl && dueDateEl) {
        const syncDueFromIssue = () => {
            dueDateEl.textContent = issueDateEl.textContent;
            saveData();
        };
        issueDateEl.addEventListener('input', syncDueFromIssue);
        issueDateEl.addEventListener('blur', syncDueFromIssue);
    }

    // アドレス帳をAPIから読み込み（DBに保存された法人・個人情報）
    try {
        await addressBook.loadFromApi();
    } catch (e) {
        console.warn('アドレス帳の読み込みに失敗しました（未ログインの可能性）:', e);
    }
    updatePartySelects();
    syncPartiesToInvoice();

    // 初期テーブル行を追加
    addTableRow('main');
    addTableRow('deduct');

    calculateTotals();
}

// 編集要素にイベントリスナーを設定
function setupEditListeners() {
    const editableElements = document.querySelectorAll('.editable');
    editableElements.forEach(el => {
        el.addEventListener('input', saveData);
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                el.blur();
            }
        });
    });
}

// セクション選択機能を設定
function setupSectionSelectors() {
    const sectionSelectors = document.querySelectorAll('.section-select');
    sectionSelectors.forEach(select => {
        select.addEventListener('change', saveData);
    });
}

// アドレスフォーム用のイベントリスナーを設定
function setupAddressFormListeners() {
    // タブクリックのイベントリスナー
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });
}

// 消費税設定のイベントリスナーを設定
function setupTaxControls() {
    const taxEnabled = q('#taxEnabled');
    const taxRate = q('#taxRate');

    if (taxEnabled) {
        taxEnabled.addEventListener('change', () => {
            // チェックボックスの状態に応じて税率入力欄を有効/無効化
            if (taxRate) {
                taxRate.disabled = !taxEnabled.checked;
            }
            calculateTotals();
            saveData();
        });
    }

    if (taxRate) {
        taxRate.addEventListener('input', () => {
            calculateTotals();
            saveData();
        });
        taxRate.addEventListener('change', () => {
            calculateTotals();
            saveData();
        });
    }
}

// 敬称選択機能（クリック切り替え式）
function setupHonorificSelector() {
    setTimeout(() => {
        const honorificClickable = document.getElementById('p_honorific_clickable');
        if (!honorificClickable) return;

        let currentHonorific = honorificClickable.textContent.trim() || '御中';

        honorificClickable.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            currentHonorific = currentHonorific === '御中' ? '様' : '御中';
            this.textContent = currentHonorific;
            saveData();
            return false;
        };

        honorificClickable.onmouseenter = function () {
            this.style.backgroundColor = '#f0f8ff';
        };

        honorificClickable.onmouseleave = function () {
            this.style.backgroundColor = 'transparent';
        };
    }, 100);
}


// 初期化
async function initialize() {
    await initializeApp();
    setupHonorificSelector();
    render();
}

// DOMロード時に初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
