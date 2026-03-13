const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxmkVkx7Ut-f0pnEs6PEAJIa6mXV70gLu03P1NnTay5xPMEIkkON4HvODg8-Bovvbkc/exec";

let dataList = [];
let systemSettings = { companyName: 'E-Document', logoUrl: 'https://cdn-icons-png.flaticon.com/512/281/281760.png' };
let currentMode = 'dashboard';
let currentPage = 1;
const itemsPerPage = 20;

let mainSignaturePad = null, withdrawSignaturePad = null;
let capturedImage = null, currentWithdrawRow = null;

// --- API Bridge ---
async function callGAS(action, params = {}) {
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

// --- Router ---
async function switchView(view) {
    currentMode = view;
    loading(true, 'กำลังโหลดหน้า...');
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active-nav'));
    const activeBtn = document.querySelector(`.nav-btn[data-v="${view}"]`);
    if (activeBtn) activeBtn.classList.add('active-nav');

    try {
        const path = (view === 'in' || view === 'out') ? 'views/form.html' : 
                     (view === 'settings' ? 'views/settings.html' : 'views/dashboard.html');
        
        const response = await fetch(path);
        const html = await response.text();
        document.getElementById('main-content').innerHTML = html;

        if (path === 'views/dashboard.html') initDashboard(view);
        if (path === 'views/form.html') initEntryForm(view.toUpperCase());
        if (path === 'views/settings.html') initSettingsUI();
        
        lucide.createIcons();
    } catch (e) { console.error(e); }
    loading(false);
}

// --- Logic Functions ---
async function refreshData() {
    loading(true, 'กำลังซิงค์ข้อมูล...');
    const res = await callGAS("getFullData");
    if (res) {
        dataList = res.list || [];
        systemSettings = res.settings || systemSettings;
        document.getElementById('side-logo').src = systemSettings.logoUrl;
        document.querySelectorAll('#side-title, #mob-title').forEach(el => el.innerText = systemSettings.companyName);
        switchView(currentMode);
    }
    loading(false);
}

function initDashboard(mode) {
    const titles = { dashboard: 'รายการล่าสุด', list_all: 'คลังเอกสารทั้งหมด', trash: 'รายการจำหน่าย' };
    document.getElementById('list-head').innerText = titles[mode] || 'รายการเอกสาร';
    updateStats();
    populateYearFilter();
    resetAndRender();
}

function updateStats() {
    const counts = {
        in: dataList.filter(d => d.status?.toLowerCase() === 'active' && d.id?.startsWith('IN')).length,
        out: dataList.filter(d => d.status?.toLowerCase() === 'active' && d.id?.startsWith('OUT')).length,
        del: dataList.filter(d => d.status?.toLowerCase() === 'deleted').length
    };
    if (document.getElementById('stat-in')) {
        document.getElementById('stat-in').innerText = counts.in;
        document.getElementById('stat-out').innerText = counts.out;
        document.getElementById('stat-del').innerText = counts.del;
    }
}

function resetAndRender() { currentPage = 1; renderFilteredTable(); }

function renderFilteredTable() {
    const tbody = document.getElementById('list-table');
    if (!tbody) return;
    const search = document.getElementById('filter-search')?.value.toLowerCase() || "";
    const year = document.getElementById('filter-year')?.value || "all";

    let filtered = dataList.filter(d => currentMode === 'trash' ? d.status === 'deleted' : d.status === 'active');
    if (year !== "all") filtered = filtered.filter(d => d.date?.includes(year));
    if (search) filtered = filtered.filter(d => [d.id, d.title, d.sender, d.receiver].some(v => v?.toLowerCase().includes(search)));

    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    const paged = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

    tbody.innerHTML = paged.map(item => `
        <tr class="hover:bg-blue-50/40 border-b">
            <td class="p-4"><div class="font-bold text-blue-600">${item.id}</div><div class="text-[10px] text-slate-400">${item.date}</div></td>
            <td class="p-4 font-medium truncate max-w-[200px]">${item.title}</td>
            <td class="p-4 text-[10px] text-slate-500">F: ${item.sender}<br>T: ${item.receiver}</td>
            <td class="p-4 text-center flex justify-center gap-2">
                <button onclick="showDetails(${item.rowNum})" class="p-2 bg-blue-50 text-blue-600 rounded-lg"><i data-lucide="eye" class="w-4 h-4"></i></button>
            </td>
        </tr>`).join('');
    lucide.createIcons();
}

function loading(show, text) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
    if(text) document.getElementById('loading-text').innerText = text;
}

function toggleSidebar() {
    document.getElementById('main-sidebar').classList.toggle('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.toggle('hidden');
}

function handleNavClick(v) { if(window.innerWidth < 768) toggleSidebar(); switchView(v); }

// Start
window.onload = () => { refreshData(); lucide.createIcons(); };
