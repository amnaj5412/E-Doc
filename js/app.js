/**
 * E-Document Enterprise Module System (V5.5 Modular Fix)
 * Core Logic & Server Bridge
 * กู้คืนฟังก์ชันการทำงานทั้งหมดจากต้นฉบับ V5.4
 */

// --- Configuration ---
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxvoSgm2Sn78wbCrxq84KIUMuLS8sbPADnVWd5MqIhVWoZuPkTT9oT8Lr85oij2H1rk/exec";

// --- State Management ---
let dataList = [];
let systemSettings = { companyName: 'E-Document', logoUrl: 'https://cdn-icons-png.flaticon.com/512/281/281760.png' };
let currentMode = 'dashboard';
let currentPage = 1;
const itemsPerPage = 20;

let mainSignaturePad = null;
let withdrawSignaturePad = null;
let capturedImage = null; // สำหรับเก็บรูปถ่ายหลักฐาน Base64
let currentWithdrawRow = null;

/**
 * Core Server Bridge (เรียกใช้ Google Apps Script)
 */
async function callGAS(action, params = {}) {
    if (!GAS_WEB_APP_URL || !GAS_WEB_APP_URL.includes("exec")) {
        Swal.fire("Configuration Error", "กรุณาตั้งค่า URL Web App ในโค้ดก่อนใช้งาน", "error");
        return null;
    }
    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: "POST",
            body: JSON.stringify({ action, ...params })
        });
        if (!response.ok) throw new Error("Server Response Error");
        return await response.json();
    } catch (err) {
        console.error("GAS Connection Error:", err);
        return null;
    }
}

/**
 * Loading Overlay
 */
function loading(show, text) {
    const el = document.getElementById('loading');
    if (el) el.style.display = show ? 'flex' : 'none';
    const txt = document.getElementById('loading-text');
    if (txt && text) txt.innerText = text;
}

/**
 * View Router - ควบคุมการเปลี่ยนหน้าและโหลด Template
 */
async function switchView(view) {
    currentMode = view;
    loading(true, 'กำลังเปลี่ยนหน้า...');
    
    // รีเซ็ตสถานะภายในเมื่อเปลี่ยนหน้า (ป้องกันข้อมูลค้างจากหน้าก่อน)
    capturedImage = null; 
    
    // UI: จัดการเมนู Active
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active-nav'));
    const activeBtn = document.querySelector(`.nav-btn[data-v="${view}"]`);
    if (activeBtn) activeBtn.classList.add('active-nav');

    try {
        let viewPath = 'views/dashboard.html';
        if (view === 'in' || view === 'out') viewPath = 'views/form.html';
        if (view === 'settings') viewPath = 'views/settings.html';

        const response = await fetch(viewPath);
        if (!response.ok) throw new Error("Load failed");
        const html = await response.text();
        
        const container = document.getElementById('main-content');
        container.innerHTML = html;

        // Initialize ฟังก์ชันเฉพาะหน้าหลังจากโหลด HTML สำเร็จ
        if (viewPath.includes('dashboard')) initDashboardView(view);
        if (viewPath.includes('form')) initFormView(view.toUpperCase());
        if (viewPath.includes('settings')) initSettingsView();

        lucide.createIcons();
    } catch (err) {
        console.error("Router Error:", err);
        document.getElementById('main-content').innerHTML = '<p class="text-center p-20 text-red-400">เกิดข้อผิดพลาดในการโหลดหน้าเว็บ (ตรวจสอบ Path ของไฟล์ HTML)</p>';
    } finally {
        loading(false);
    }
}

/**
 * Dashboard Setup
 */
function initDashboardView(mode) {
    const titles = { dashboard: 'รายการล่าสุด', list_all: 'คลังเอกสารทั้งหมด', trash: 'รายการจำหน่าย (ถังขยะ)' };
    const head = document.getElementById('list-head');
    if (head) head.innerText = titles[mode] || 'รายการเอกสาร';
    
    if (mode === 'trash') {
        const stats = document.getElementById('stats-bar');
        if(stats) stats.classList.add('hide');
    }
    
    updateStatsDisplay();
    populateYearFilter();
    resetAndRender();
}

/**
 * Form Setup (ถอดแบบมาจากต้นฉบับ V5.4)
 */
async function initFormView(type) {
    const fTitle = document.getElementById('form-title-text');
    const fIcon = document.getElementById('form-icon-box');
    const iDate = document.getElementById('inp-date');

    if (fTitle) fTitle.innerText = (type === 'IN' ? 'ลงทะเบียนรับเอกสารเข้า' : 'บันทึกการส่งออกเอกสาร');
    if (fIcon) fIcon.innerHTML = `<i data-lucide="${type === 'IN' ? 'download-cloud' : 'upload-cloud'}" class="w-8 h-8"></i>`;
    
    // 1. ตั้งค่าวันที่ปัจจุบัน
    if (iDate) iDate.valueAsDate = new Date();

    // 2. ดึงเลขที่เอกสารใหม่รันนิ่ง (generateNextId)
    const id = await callGAS("generateNextId", { prefix: type });
    if (id) document.getElementById('inp-id').value = id;

    // 3. ดึงรายชื่อหน่วยงานสำหรับ Datalist
    const depts = await callGAS("getDepartments");
    const dList = document.getElementById('dept-list');
    if (depts && dList) {
        dList.innerHTML = depts.map(d => `<option value="${d}">`).join('');
    }
    
    lucide.createIcons();
}

/**
 * Settings Setup
 */
function initSettingsView() {
    const nameInp = document.getElementById('set-name');
    const logoInp = document.getElementById('set-logo');
    if(nameInp) nameInp.value = systemSettings.companyName || '';
    if(logoInp) logoInp.value = systemSettings.logoUrl || '';
}

/**
 * Data Management
 */
async function refreshData() {
    loading(true, 'กำลังโหลดข้อมูลจาก Google Sheets...');
    try {
        const res = await callGAS("getFullData");
        if (res) {
            dataList = res.list || [];
            systemSettings = res.settings || systemSettings;
            applySettings();
            
            // อัปเดตตารางและสถิติหากอยู่ในหน้า Dashboard
            if (currentMode === 'dashboard' || currentMode === 'list_all' || currentMode === 'trash') {
                renderFilteredTable();
                updateStatsDisplay();
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        loading(false);
    }
}

function applySettings() {
    const logo = document.getElementById('side-logo');
    if(logo) logo.src = systemSettings.logoUrl;
    document.querySelectorAll('#side-title, #mob-title').forEach(el => el.innerText = systemSettings.companyName);
}

/**
 * Signature Pad Logic
 */
function openModal(id, rowNum = null) {
    Swal.close();
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';

    const canvas = (id === 'sig-modal') ? document.getElementById('sig-canvas-main') : document.getElementById('withdraw-canvas');
    if (!canvas) return;

    // รองรับความชัดเจนของเส้นบนหน้าจอ Retina/High-DPI
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);

    if (id === 'sig-modal') {
        if (!mainSignaturePad) mainSignaturePad = new SignaturePad(canvas);
        mainSignaturePad.clear();
    } else {
        currentWithdrawRow = rowNum;
        if (!withdrawSignaturePad) withdrawSignaturePad = new SignaturePad(canvas);
        withdrawSignaturePad.clear();
        const nameInp = document.getElementById('withdraw-name');
        if(nameInp) nameInp.value = '';
    }
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function clearSignature(type) {
    if (type === 'main' && mainSignaturePad) mainSignaturePad.clear();
    if (type === 'withdraw' && withdrawSignaturePad) withdrawSignaturePad.clear();
}

function saveSignatureFromModal() {
    if(mainSignaturePad.isEmpty()) { Swal.fire("คำเตือน", "กรุณาลงลายมือชื่อก่อนยืนยัน", "warning"); return; }
    const data = mainSignaturePad.toDataURL();
    const sigInp = document.getElementById('inp-sig-data');
    if(sigInp) sigInp.value = data;
    
    const pImg = document.getElementById('sig-preview-img');
    if(pImg) { pImg.src = data; pImg.classList.remove('hide'); }
    
    const pPlace = document.getElementById('sig-placeholder');
    if(pPlace) pPlace.classList.add('hide');
    
    closeModal('sig-modal');
}

/**
 * Table Rendering
 */
function renderFilteredTable() {
    const tbody = document.getElementById('list-table');
    if (!tbody) return;

    const search = (document.getElementById('filter-search')?.value || "").toLowerCase().trim();
    const year = document.getElementById('filter-year')?.value || "all";

    let filtered = dataList.filter(item => {
        const status = (item.status || "").toString().trim().toLowerCase();
        if (currentMode === 'trash') return status === 'deleted';
        return status === 'active';
    });

    if (year !== "all") filtered = filtered.filter(d => (d.date || "").includes(year));
    if (search) filtered = filtered.filter(d => [d.id, d.title, d.sender, d.receiver].some(v => (v||"").toString().toLowerCase().includes(search)));

    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    const items = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-16 text-center text-slate-300 italic">ไม่มีข้อมูลที่ตรงตามเงื่อนไข</td></tr>';
    } else {
        tbody.innerHTML = items.map(item => {
            const isWithdrawn = !!(item.withdrawStatus && item.withdrawStatus.includes("เบิกแล้ว"));
            const status = (item.status || "").toString().trim().toLowerCase();
            return `
                <tr class="hover:bg-blue-50/40 border-b border-slate-50 transition-all">
                    <td class="p-4"><div class="font-bold text-blue-600">${item.id}</div><div class="text-[10px] text-slate-400 font-medium">${item.date}</div></td>
                    <td class="p-4 font-medium truncate max-w-[240px]" title="${item.title}">${item.title}</td>
                    <td class="p-4 text-[10px] text-slate-500 leading-tight">
                        <span class="text-slate-300 font-bold uppercase">From:</span> ${item.sender}<br>
                        <span class="text-slate-300 font-bold uppercase">To:</span> ${item.receiver}
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex justify-center items-center gap-2">
                             ${isWithdrawn ? `<div class="w-8 h-8 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center shadow-sm" title="เบิกแล้วโดย: ${item.withdrawName}"><i data-lucide="package-check" class="w-4 h-4"></i></div>` : ''}
                            <button onclick="showDetails(${item.rowNum})" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all"><i data-lucide="eye" class="w-4 h-4"></i></button>
                            ${status === 'active' 
                               ? `<button onclick="updateDocStatus(${item.rowNum}, 'deleted')" class="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-all"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`
                               : `<div class="flex gap-1">
                                    <button onclick="updateDocStatus(${item.rowNum}, 'active')" class="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-600 hover:text-white transition-all"><i data-lucide="refresh-cw" class="w-4 h-4"></i></button>
                                    <button onclick="permanentlyDelete(${item.rowNum})" class="p-2 bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-700 hover:text-white transition-all"><i data-lucide="x-circle" class="w-4 h-4"></i></button>
                                  </div>`
                            }
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }
    
    renderPaginationUI(currentPage, totalPages);
    lucide.createIcons();
}

/**
 * Detail Modal Logic (ดึง Thumbnail จาก Google Drive เหมือนต้นฉบับ)
 */
function showDetails(rowNum) {
    const item = dataList.find(d => d.rowNum === rowNum);
    if(!item) return;

    const isWithdrawn = !!(item.withdrawName && item.withdrawName.trim());
    const getThumb = url => {
        if(!url || url.indexOf('Error') !== -1) return null;
        const match = url.match(/[-\w]{25,}/);
        return match ? `https://drive.google.com/thumbnail?id=${match[0]}&sz=w800` : null;
    }

    const detailHtml = `
        <div class="text-left text-sm space-y-4">
            <div class="bg-slate-50 p-6 rounded-3xl space-y-3 border">
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-bold text-[10px] uppercase">เรื่องเอกสาร</span><span class="font-bold text-right ml-4">${item.title}</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-bold text-[10px] uppercase">ต้นทาง</span><span>${item.sender}</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-bold text-[10px] uppercase">ผู้รับ</span><span>${item.receiver}</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-bold text-[10px] uppercase">วันที่เอกสาร</span><span>${item.date}</span></div>
                <div class="flex justify-between"><span class="text-slate-400 font-bold text-[10px] uppercase">เวลาบันทึก</span><span class="text-[10px] text-slate-400">${item.timestamp}</span></div>
            </div>
            ${isWithdrawn ? `
                <div class="p-4 bg-orange-50 border border-orange-200 rounded-3xl">
                    <p class="text-[10px] font-bold text-orange-600 mb-2 uppercase tracking-widest flex items-center"><i data-lucide="info" class="w-3 h-3 mr-1"></i> ข้อมูลการเบิก</p>
                    <p class="font-bold text-orange-800">ผู้เบิก: ${item.withdrawName}</p>
                    <p class="text-[10px] text-slate-400 font-medium">วันที่เบิก: ${item.withdrawStatus}</p>
                    <div class="bg-white mt-3 p-3 rounded-2xl border border-orange-100 shadow-inner flex justify-center">
                        ${getThumb(item.withdrawSig) ? `<img src="${getThumb(item.withdrawSig)}" class="h-16">` : '<span class="text-slate-300 italic text-xs">ไม่มีลายเซ็น</span>'}
                    </div>
                </div>
            ` : ''}
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <p class="text-[10px] font-bold text-slate-400 mb-1 uppercase text-center">รูปถ่ายหลักฐาน</p>
                    ${getThumb(item.photoUrl) ? `<img src="${getThumb(item.photoUrl)}" class="h-32 w-full object-cover rounded-2xl border cursor-pointer" onclick="window.open('${item.photoUrl}')">` : '<div class="h-32 bg-slate-100 rounded-2xl flex items-center justify-center"><i data-lucide="image" class="text-slate-200"></i></div>'}
                </div>
                <div>
                    <p class="text-[10px] font-bold text-slate-400 mb-1 uppercase text-center">ลายเซ็นรับเข้า</p>
                    <div class="h-32 bg-white rounded-2xl border flex items-center justify-center p-2">
                        ${getThumb(item.sigUrl) ? `<img src="${getThumb(item.sigUrl)}" class="max-h-full max-w-full">` : '<span class="text-slate-200 italic text-[10px]">ไม่พบ</span>'}
                    </div>
                </div>
            </div>
            ${item.fileUrl && !item.fileUrl.includes('Error') ? `<a href="${item.fileUrl}" target="_blank" class="block py-4 bg-blue-50 text-blue-600 text-center rounded-2xl font-bold hover:bg-blue-100 transition-all flex items-center justify-center"><i data-lucide="file-text" class="w-4 h-4 mr-2"></i> เปิดไฟล์ PDF ต้นฉบับ</a>` : ''}
            ${(!isWithdrawn && item.status === 'active' && item.id.includes('IN')) ? `<button onclick="openModal('withdraw-modal', ${item.rowNum})" class="w-full py-5 bg-orange-500 text-white rounded-2xl font-bold shadow-lg hover:bg-orange-600 transition-all flex items-center justify-center"><i data-lucide="hand-helping" class="w-5 h-5 mr-2"></i> ทำรายการเบิกเอกสารฉบับจริง</button>` : ''}
        </div>
    `;

    Swal.fire({
        title: `<span class="text-blue-600 font-bold">${item.id}</span>`,
        html: detailHtml,
        width: '600px',
        confirmButtonText: 'ปิดหน้าต่าง',
        confirmButtonColor: '#3b82f6',
        didOpen: () => lucide.createIcons()
    });
}

/**
 * Form Submission Logic (กู้คืนฟังก์ชันบันทึกข้อมูลแบบต้นฉบับ 100%)
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    
    // 1. ตรวจสอบลายเซ็นยืนยัน
    const sig = document.getElementById('inp-sig-data')?.value;
    if(!sig) { Swal.fire("คำเตือน", "กรุณาลงลายมือชื่อยืนยันการทำรายการ", "warning"); return; }

    loading(true, 'กำลังส่งข้อมูลบันทึกลง Google Sheets...');
    
    // 2. จัดการหัวข้อเรื่อง (Logic "OTHER")
    const selVal = document.getElementById('sel-subject')?.value;
    const otherSubject = document.getElementById('inp-subject-other')?.value;
    const finalTitle = selVal === 'OTHER' ? otherSubject : selVal;
    
    // 3. จัดการรูปแบบวันที่เป็น พ.ศ. (วว/ดด/ปปปป+543)
    const dVal = document.getElementById('inp-date')?.value.split('-');
    const formattedDate = `${dVal[2]}/${dVal[1]}/${parseInt(dVal[0])+543}`;

    // 4. จัดการไฟล์เอกสารหลัก (PDF)
    const fileEl = document.getElementById('inp-file');
    let fileData = null, fileName = "";
    if (fileEl?.files[0]) {
        fileData = await fileToBase64(fileEl.files[0]);
        fileName = fileEl.files[0].name;
    }

    // 5. เตรียม Payload ข้อมูลทั้งหมดเพื่อส่งไปที่ GAS
    const payload = {
        id: document.getElementById('inp-id')?.value,
        docDate: formattedDate,
        title: finalTitle,
        sender: document.getElementById('inp-sender')?.value,
        receiver: document.getElementById('inp-receiver')?.value,
        emailRecipient: document.getElementById('inp-email')?.value,
        fileData, 
        fileName,
        photoData: capturedImage, // ข้อมูลรูปภาพจากฟังก์ชัน processPhotoSelection
        sigData: sig
    };

    const res = await callGAS("processSubmission", { payload });
    loading(false);
    
    if(res && res.success) {
        Swal.fire("สำเร็จ", "บันทึกข้อมูลเอกสารเรียบร้อยแล้ว", "success").then(() => {
            switchView('dashboard');
            refreshData();
        });
    } else {
        Swal.fire("Error", res ? res.message : "การบันทึกล้มเหลว", "error");
    }
}

/**
 * Withdrawal Submission Logic
 */
async function submitWithdraw() {
    const name = document.getElementById('withdraw-name')?.value;
    if(!name || name.trim() === "") { Swal.fire("คำเตือน", "กรุณาระบุชื่อผู้เบิกเอกสาร", "warning"); return; }
    if(withdrawSignaturePad.isEmpty()) { Swal.fire("คำเตือน", "กรุณาลงลายมือชื่อผู้เบิก", "warning"); return; }

    loading(true, 'กำลังบันทึกข้อมูลการเบิก...');
    const payload = { rowNum: currentWithdrawRow, withdrawName: name, withdrawSig: withdrawSignaturePad.toDataURL() };
    const res = await callGAS("recordWithdrawal", { payload });
    loading(false);
    if(res && res.success) {
        closeModal('withdraw-modal');
        Swal.fire("สำเร็จ", "บันทึกการเบิกเรียบร้อยแล้ว", "success").then(refreshData);
    }
}

/**
 * Management Actions
 */
async function updateDocStatus(rowNum, status) {
    const confirm = await Swal.fire({
        title: status === 'deleted' ? 'ย้ายลงถังขยะ?' : 'กู้คืนเอกสาร?',
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonText: 'ยืนยัน', 
        cancelButtonText: 'ยกเลิก'
    });
    if(!confirm.isConfirmed) return;

    loading(true, 'กำลังปรับปรุงสถานะ...');
    await callGAS("updateStatus", { rowNum, status });
    await refreshData();
    loading(false);
}

/**
 * ฟังก์ชันลบข้อมูลถาวร (ลบแถวออกจาก Google Sheets)
 */
async function permanentlyDelete(rowNum) {
    // ค้นหาข้อมูลไอเทมนี้จาก dataList เพื่อเอา ID มาอ้างอิง
    const item = dataList.find(d => d.rowNum === rowNum);
    if (!item) return;

    Swal.close(); // ปิด Modal รายละเอียดก่อน
    const confirm = await Swal.fire({
        title: 'ยืนยันลบถาวร?',
        text: `คุณกำลังจะลบรายการ ${item.id} ออกจากชีตถาวร แถวข้อมูลจะถูกลบทิ้งทันที!`,
        icon: 'error', 
        showCancelButton: true, 
        confirmButtonColor: '#d33', 
        confirmButtonText: 'ใช่, ลบทิ้งเลย', 
        cancelButtonText: 'ยกเลิก'
    });

    if (!confirm.isConfirmed) return;

    loading(true, 'กำลังลบแถวข้อมูลออกจาก Google Sheets...');
    
    // ส่ง action "hardDelete" พร้อม ID ไปที่ GAS
    const res = await callGAS("hardDelete", { 
        rowNum: rowNum, 
        id: item.id 
    });

    if (res && res.success) {
        // สำคัญ: ต้องดึงข้อมูลใหม่ทันที เพราะ Index แถวในชีตมีการขยับหลังจากลบ
        await refreshData();
        Swal.fire("สำเร็จ", "ลบแถวข้อมูลออกจากระบบถาวรเรียบร้อยแล้ว", "success");
    } else {
        loading(false);
        Swal.fire("Error", res ? res.message : "ไม่สามารถติดต่อ Server ได้", "error");
    }
}

// ลงทะเบียนฟังก์ชันไว้ใน window เพื่อให้หน้าตารางเรียกใช้ได้
window.permanentlyDelete = permanentlyDelete;

async function saveAppSettings() {
    const settings = { 
        companyName: document.getElementById('set-name')?.value, 
        logoUrl: document.getElementById('set-logo')?.value 
    };
    loading(true, 'กำลังบันทึกตั้งค่า...');
    const res = await callGAS("saveSettings", { settings });
    loading(false);
    if(res && res.success) {
        Swal.fire("สำเร็จ", "บันทึกการตั้งค่าระบบเรียบร้อย", "success").then(refreshData);
    }
}

// --- Global Scope Exports (เพื่อให้ไฟล์ HTML Template เรียกใช้ผ่าน onclick/onchange ได้) ---
window.switchView = switchView;
window.refreshData = refreshData;
window.handleNavClick = (v) => { if(window.innerWidth < 768) toggleSidebar(); switchView(v); };
window.openModal = openModal;
window.closeModal = closeModal;
window.clearSignature = clearSignature;
window.saveSignatureFromModal = saveSignatureFromModal;
window.resetAndRender = () => { currentPage = 1; renderFilteredTable(); };
window.showDetails = showDetails;
window.submitWithdraw = submitWithdraw;
window.updateDocStatus = updateDocStatus;
window.permanentlyDelete = permanentlyDelete;
window.saveAppSettings = saveAppSettings;
window.handleFormSubmit = handleFormSubmit;
window.toggleSidebar = () => {
    document.getElementById('main-sidebar').classList.toggle('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.toggle('hidden');
};
window.toggleOtherSubject = (val) => {
    const otherInp = document.getElementById('inp-subject-other');
    if(otherInp) {
        if(val === 'OTHER') { otherInp.classList.remove('hide'); otherInp.required = true; }
        else { otherInp.classList.add('hide'); otherInp.required = false; otherInp.value = ''; }
    }
};

/**
 * ฟังก์ชันจัดการการเลือกรูปภาพ ( Preview และเก็บ Base64 )
 */
window.processPhotoSelection = async (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            capturedImage = e.target.result; // บันทึกลงตัวแปร Global เพื่อใช้ตอน Submit
            const preview = document.getElementById('photo-preview-box');
            if(preview) {
                preview.innerHTML = `<img src="${capturedImage}" class="h-full w-full object-cover">`;
                preview.classList.remove('hide');
            }
        };
        reader.readAsDataURL(input.files[0]);
    }
};

/**
 * ฟังก์ชันล้างลายเซ็นหน้าฟอร์ม
 */
window.clearMainSignature = () => {
    const sigInp = document.getElementById('inp-sig-data');
    if(sigInp) sigInp.value = '';
    const pImg = document.getElementById('sig-preview-img');
    if(pImg) pImg.classList.add('hide');
    const pPlace = document.getElementById('sig-placeholder');
    if(pPlace) pPlace.classList.remove('hide');
    if(mainSignaturePad) mainSignaturePad.clear();
};

// Utilities & Pagination Logic
function renderPaginationUI(curr, total) {
    const info = document.getElementById('pagination-info');
    if (info) info.innerText = `แสดงหน้าที่ ${curr} จากทั้งหมด ${total} หน้า`;
    const nums = document.getElementById('page-numbers');
    if(!nums) return;
    let html = '';
    for(let i=1; i<=total; i++) {
        const activeClass = (i === curr) ? 'active' : '';
        html += `<button onclick="goToPage(${i})" class="page-btn ${activeClass}">${i}</button>`;
    }
    nums.innerHTML = html;
}
window.goToPage = (p) => { currentPage = p; renderFilteredTable(); };

function updateStatsDisplay() { 
    const counts = {
        in: dataList.filter(d => (d.status || "").toLowerCase() === 'active' && (d.id || "").startsWith('IN')).length,
        out: dataList.filter(d => (d.status || "").toLowerCase() === 'active' && (d.id || "").startsWith('OUT')).length,
        del: dataList.filter(d => (d.status || "").toLowerCase() === 'deleted').length
    };
    const sIn = document.getElementById('stat-in'), sOut = document.getElementById('stat-out'), sDel = document.getElementById('stat-del');
    if(sIn) sIn.innerText = counts.in;
    if(sOut) sOut.innerText = counts.out;
    if(sDel) sDel.innerText = counts.del;
}

function populateYearFilter() { 
    const filterYear = document.getElementById('filter-year');
    if(!filterYear) return;
    const years = [...new Set(dataList.map(d => (d.date || "").split('/')[2]))].filter(Boolean).sort((a,b)=>b-a);
    filterYear.innerHTML = '<option value="all">ปี พ.ศ. ทั้งหมด</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
}

function fileToBase64(f) { 
    return new Promise((r, j) => { 
        const rd = new FileReader(); 
        rd.readAsDataURL(f); 
        rd.onload = () => r(rd.result); 
        rd.onerror = e => j(e); 
    }); 
}

// Initialize Application
window.onload = () => {
    refreshData(); 
    lucide.createIcons();
};
