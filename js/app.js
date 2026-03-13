// --- Configuration ---
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxmkVkx7Ut-f0pnEs6PEAJIa6mXV70gLu03P1NnTay5xPMEIkkON4HvODg8-Bovvbkc/exec";

// --- State ---
let dataList = [];
let systemSettings = { companyName: 'E-Document', logoUrl: 'https://cdn-icons-png.flaticon.com/512/281/281760.png' };
let currentMode = 'dashboard';
let currentPage = 1;
const itemsPerPage = 20;

let mainSignaturePad = null;
let withdrawSignaturePad = null;
let capturedImage = null;
let currentWithdrawRow = null;

/**
 * Core Server Bridge
 */
async function callGAS(action, params = {}) {
    if (!GAS_WEB_APP_URL || !GAS_WEB_APP_URL.includes("exec")) {
        Swal.fire("Config Error", "กรุณาตั้งค่า URL Web App", "error");
        return null;
    }
    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: "POST",
            body: JSON.stringify({ action, ...params })
        });
        return await response.json();
    } catch (err) {
        console.error("GAS Error:", err);
        return null;
    }
}

/**
 * View Router - โหลด Template HTML มาแสดงผล
 */
async function switchView(view) {
    currentMode = view;
    loading(true, 'กำลังเปลี่ยนหน้า...');
    
    // UI: Active Nav
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

        // Initialize specific view logic after HTML injected
        if (viewPath.includes('dashboard')) initDashboardView(view);
        if (viewPath.includes('form')) initFormView(view.toUpperCase());
        if (viewPath.includes('settings')) initSettingsView();

        lucide.createIcons();
    } catch (err) {
        console.error("Router Error:", err);
        document.getElementById('main-content').innerHTML = '<p class="text-center p-20 text-red-400">ไม่สามารถโหลดหน้าเว็บได้ (ตรวจสอบการเชื่อมต่อ)</p>';
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
    
    if (mode === 'trash') document.getElementById('stats-bar')?.classList.add('hide');
    
    updateStatsDisplay();
    populateYearFilter();
    resetAndRender();
}

/**
 * Form Setup
 */
async function initFormView(type) {
    const fTitle = document.getElementById('form-title-text');
    const fIcon = document.getElementById('form-icon-box');
    const iDate = document.getElementById('inp-date');

    if (fTitle) fTitle.innerText = (type === 'IN' ? 'ลงทะเบียนรับเอกสารเข้า' : 'บันทึกการส่งออกเอกสาร');
    if (fIcon) fIcon.innerHTML = `<i data-lucide="${type === 'IN' ? 'download-cloud' : 'upload-cloud'}" class="w-8 h-8"></i>`;
    if (iDate) iDate.valueAsDate = new Date();

    const id = await callGAS("generateNextId", { prefix: type });
    if (id) document.getElementById('inp-id').value = id;

    const depts = await callGAS("getDepartments");
    const dList = document.getElementById('dept-list');
    if (depts && dList) dList.innerHTML = depts.map(d => `<option value="${d}">`).join('');
    
    lucide.createIcons();
}

/**
 * Settings Setup
 */
function initSettingsView() {
    document.getElementById('set-name').value = systemSettings.companyName || '';
    document.getElementById('set-logo').value = systemSettings.logoUrl || '';
}

/**
 * Data Management
 */
async function refreshData() {
    loading(true, 'กำลังดึงข้อมูลล่าสุด...');
    const res = await callGAS("getFullData");
    if (res) {
        dataList = res.list || [];
        systemSettings = res.settings || systemSettings;
        applySettings();
        switchView(currentMode);
    }
    loading(false);
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
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.style.display = 'flex';

    const canvas = (id === 'sig-modal') ? document.getElementById('sig-canvas-main') : document.getElementById('withdraw-canvas');
    if (!canvas) return;

    // Resize Canvas for High DPI
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
    if(mainSignaturePad.isEmpty()) { Swal.fire("คำเตือน", "กรุณาเซ็นชื่อก่อนกดยืนยัน", "warning"); return; }
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
        return currentMode === 'trash' ? status === 'deleted' : status === 'active';
    });

    if (year !== "all") filtered = filtered.filter(d => (d.date || "").includes(year));
    if (search) filtered = filtered.filter(d => [d.id, d.title, d.sender, d.receiver].some(v => (v||"").toString().toLowerCase().includes(search)));

    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    const items = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-16 text-center text-slate-300 italic">ไม่มีข้อมูลที่แสดงผล</td></tr>';
    } else {
        tbody.innerHTML = items.map(item => {
            const isWithdrawn = !!(item.withdrawStatus && item.withdrawStatus.includes("เบิกแล้ว"));
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
                            <button onclick="updateDocStatus(${item.rowNum}, '${item.status === 'deleted' ? 'active' : 'deleted'}')" class="p-2 bg-slate-50 text-slate-400 rounded-lg hover:bg-slate-700 hover:text-white transition-all"><i data-lucide="${item.status === 'deleted' ? 'refresh-cw' : 'trash-2'}" class="w-4 h-4"></i></button>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }
    
    renderPaginationUI(currentPage, totalPages);
    lucide.createIcons();
}

/**
 * Detail Modal Logic
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
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-bold text-[10px] uppercase tracking-wide">เรื่องเอกสาร</span><span class="font-bold text-right ml-4">${item.title}</span></div>
                <div class="flex justify-between border-b pb-2"><span class="text-slate-400 font-bold text-[10px] uppercase tracking-wide">ต้นทาง/ปลายทาง</span><span>${item.sender} &rarr; ${item.receiver}</span></div>
                <div class="flex justify-between"><span class="text-slate-400 font-bold text-[10px] uppercase tracking-wide">วันที่เอกสาร</span><span>${item.date}</span></div>
            </div>
            ${isWithdrawn ? `
                <div class="p-4 bg-orange-50 border border-orange-200 rounded-3xl">
                    <p class="text-[10px] font-bold text-orange-600 mb-2 uppercase tracking-widest flex items-center"><i data-lucide="info" class="w-3 h-3 mr-1"></i> ข้อมูลการเบิก</p>
                    <p class="font-bold text-orange-800">ผู้เบิก: ${item.withdrawName}</p>
                    <div class="bg-white mt-3 p-3 rounded-2xl border border-orange-100 shadow-inner flex justify-center">
                        ${getThumb(item.withdrawSig) ? `<img src="${getThumb(item.withdrawSig)}" class="h-16">` : '<span class="text-slate-300 italic text-xs">ไม่มีลายเซ็น</span>'}
                    </div>
                </div>
            ` : ''}
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <p class="text-[10px] font-bold text-slate-400 mb-1 uppercase text-center">รูปถ่าย</p>
                    ${getThumb(item.photoUrl) ? `<img src="${getThumb(item.photoUrl)}" class="h-32 w-full object-cover rounded-2xl border cursor-pointer" onclick="window.open('${item.photoUrl}')">` : '<div class="h-32 bg-slate-100 rounded-2xl flex items-center justify-center"><i data-lucide="image" class="text-slate-200"></i></div>'}
                </div>
                <div>
                    <p class="text-[10px] font-bold text-slate-400 mb-1 uppercase text-center">ลายเซ็นรับเข้า</p>
                    <div class="h-32 bg-white rounded-2xl border flex items-center justify-center p-2">
                        ${getThumb(item.sigUrl) ? `<img src="${getThumb(item.sigUrl)}" class="max-h-full max-w-full">` : '<span class="text-slate-200 italic text-[10px]">ไม่พบ</span>'}
                    </div>
                </div>
            </div>
            ${item.fileUrl && !item.fileUrl.includes('Error') ? `<a href="${item.fileUrl}" target="_blank" class="block py-4 bg-blue-50 text-blue-600 text-center rounded-2xl font-bold hover:bg-blue-100 transition-all">เปิดไฟล์ PDF ต้นฉบับ</a>` : ''}
            ${(!isWithdrawn && item.status === 'active' && item.id.includes('IN')) ? `<button onclick="openModal('withdraw-modal', ${item.rowNum})" class="w-full py-5 bg-orange-500 text-white rounded-2xl font-bold shadow-lg hover:bg-orange-600 transition-all flex items-center justify-center"><i data-lucide="hand-helping" class="w-5 h-5 mr-2"></i> ทำรายการเบิกเอกสาร</button>` : ''}
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
 * Form Submission Logic
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    const sig = document.getElementById('inp-sig-data')?.value;
    if(!sig) { Swal.fire("คำเตือน", "กรุณาลงลายมือชื่อยืนยันการทำรายการ", "warning"); return; }

    loading(true, 'กำลังบันทึกข้อมูลลง Google Sheets...');
    
    const selVal = document.getElementById('sel-subject')?.value;
    const otherSubject = document.getElementById('inp-subject-other')?.value;
    const finalTitle = selVal === 'OTHER' ? otherSubject : selVal;
    
    const dVal = document.getElementById('inp-date')?.value.split('-');
    const formattedDate = `${dVal[2]}/${dVal[1]}/${parseInt(dVal[0])+543}`;

    const fileEl = document.getElementById('inp-file');
    let fileData = null, fileName = "";
    if (fileEl?.files[0]) {
        fileData = await fileToBase64(fileEl.files[0]);
        fileName = fileEl.files[0].name;
    }

    const payload = {
        id: document.getElementById('inp-id')?.value,
        docDate: formattedDate,
        title: finalTitle,
        sender: document.getElementById('inp-sender')?.value,
        receiver: document.getElementById('inp-receiver')?.value,
        emailRecipient: document.getElementById('inp-email')?.value,
        fileData, fileName,
        photoData: capturedImage,
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

async function updateDocStatus(rowNum, status) {
    const confirm = await Swal.fire({
        title: status === 'deleted' ? 'ย้ายลงถังขยะ?' : 'กู้คืนเอกสาร?',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก'
    });
    if(!confirm.isConfirmed) return;

    loading(true, 'กำลังปรับปรุงสถานะ...');
    await callGAS("updateStatus", { rowNum, status });
    await refreshData();
    loading(false);
}

// --- บังคับให้ Function อยู่ใน Global Scope ---
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

// Utilities
function loading(show, text) {
    const el = document.getElementById('loading');
    if (el) el.style.display = show ? 'flex' : 'none';
    if (text) document.getElementById('loading-text').innerText = text;
}

function renderPaginationUI(curr, total) {
    const info = document.getElementById('pagination-info');
    if (info) info.innerText = `แสดงหน้าที่ ${curr} จากทั้งหมด ${total} หน้า`;
}

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
