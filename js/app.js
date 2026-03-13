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
    document.getElementById('side-logo').src = systemSettings.logoUrl;
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
    }
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function clearSignature(type) {
    if (type === 'main' && mainSignaturePad) mainSignaturePad.clear();
    if (type === 'withdraw' && withdrawSignaturePad) withdrawSignaturePad.clear();
}

/**
 * Table Rendering
 */
function renderFilteredTable() {
    const tbody = document.getElementById('list-table');
    if (!tbody) return;

    const search = (document.getElementById('filter-search')?.value || "").toLowerCase();
    const year = document.getElementById('filter-year')?.value || "all";

    let filtered = dataList.filter(d => currentMode === 'trash' ? d.status === 'deleted' : d.status === 'active');
    if (year !== "all") filtered = filtered.filter(d => d.date?.includes(year));
    if (search) filtered = filtered.filter(d => [d.id, d.title, d.sender, d.receiver].some(v => v?.toLowerCase().includes(search)));

    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    const items = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    tbody.innerHTML = items.length ? items.map(item => `
        <tr class="hover:bg-blue-50/40 border-b">
            <td class="p-4"><div class="font-bold text-blue-600">${item.id}</div><div class="text-[10px] text-slate-400">${item.date}</div></td>
            <td class="p-4 font-medium truncate max-w-[200px]">${item.title}</td>
            <td class="p-4 text-[10px] text-slate-500">F: ${item.sender}<br>T: ${item.receiver}</td>
            <td class="p-4 text-center flex justify-center gap-2">
                <button onclick="showDetails(${item.rowNum})" class="p-2 bg-blue-50 text-blue-600 rounded-lg"><i data-lucide="eye" class="w-4 h-4"></i></button>
            </td>
        </tr>`).join('') : '<tr><td colspan="4" class="p-10 text-center text-slate-300 italic">ไม่มีข้อมูล</td></tr>';
    
    renderPaginationUI(currentPage, totalPages);
    lucide.createIcons();
}

// --- บังคับให้ Function อยู่ใน Global Scope เพื่อให้ HTML เรียกผ่าน onclick ได้ ---
window.switchView = switchView;
window.refreshData = refreshData;
window.handleNavClick = (v) => { if(window.innerWidth < 768) toggleSidebar(); switchView(v); };
window.openModal = openModal;
window.closeModal = closeModal;
window.clearSignature = clearSignature;
window.resetAndRender = () => { currentPage = 1; renderFilteredTable(); };
window.showDetails = (rowNum) => { /* โค้ด showDetails เดิมของคุณ */ console.log("Show details for row", rowNum); };
window.toggleSidebar = () => {
    document.getElementById('main-sidebar').classList.toggle('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.toggle('hidden');
};

// Utilities
function loading(show, text) {
    const el = document.getElementById('loading');
    if (el) el.style.display = show ? 'flex' : 'none';
    if (text) document.getElementById('loading-text').innerText = text;
}

function renderPaginationUI(curr, total) {
    const info = document.getElementById('pagination-info');
    if (info) info.innerText = `หน้าที่ ${curr} / ${total}`;
}

function updateStatsDisplay() { /* Logic นับเลข In/Out */ }
function populateYearFilter() { /* Logic สร้าง Option ปี */ }

// Initialize Application
window.onload = () => {
    refreshData(); 
    lucide.createIcons();
};
