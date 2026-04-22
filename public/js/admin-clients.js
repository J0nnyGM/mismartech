import { db, collection, addDoc, Timestamp, doc, updateDoc } from "./firebase-init.js";
import { AdminStore } from "./admin-store.js"; // 🔥 IMPORTAMOS EL CEREBRO

// --- REFERENCIAS DOM ---
const modal = document.getElementById('client-modal');
const btnOpen = document.getElementById('btn-add-client');
const btnCloseList = document.querySelectorAll('.close-modal');
const btnSave = document.getElementById('save-client');
const searchInput = document.getElementById('search-client');
const filterType = document.getElementById('filter-client-type');
const listContainer = document.getElementById('clients-table-body');
const loadMoreBtn = document.getElementById('load-more-container');

const inpDept = document.getElementById('new-client-dept');
const inpCity = document.getElementById('new-client-city');

// --- ESTADO GLOBAL ---
const PAGE_SIZE = 50;
let currentPage = 1;
let currentFilter = 'ALL';
let editingClientId = null;
let adminClientsCache = []; // Recibirá los datos del Store

const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToClients((clientsArray) => {
    adminClientsCache = clientsArray;
    renderClientsFromMemory();
});

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================
function renderClientsFromMemory() {
    if (!listContainer) return;
    
    let filtered = [];
    const term = normalizeText(searchInput.value.trim());

    // A. APLICAR FILTROS
    filtered = adminClientsCache.filter(c => {
        let matchesSearch = true;
        if (term.length > 1) {
            matchesSearch = c.searchStr && c.searchStr.includes(term);
        }

        let matchesType = true;
        const rawSource = (c.source || 'WEB').toUpperCase();
        if (currentFilter === 'WEB') matchesType = (rawSource !== 'MANUAL' && rawSource !== 'MAYORISTA' && rawSource !== 'EXCEL_IMPORT');
        else if (currentFilter === 'MANUAL') matchesType = (rawSource === 'MANUAL' || rawSource === 'EXCEL_IMPORT');
        else if (currentFilter === 'MAYORISTA') matchesType = (rawSource === 'MAYORISTA');

        return matchesSearch && matchesType;
    });

    listContainer.innerHTML = "";

    if (filtered.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontraron clientes.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    // B. PAGINACIÓN
    const startIdx = 0;
    const endIdx = currentPage * PAGE_SIZE;
    const pageClients = filtered.slice(startIdx, endIdx);

    pageClients.forEach(c => renderClientRow(c));

    // C. BOTÓN CARGAR MÁS
    if (endIdx < filtered.length) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Mostrar más resultados (${endIdx}/${filtered.length})`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }
}

window.loadMoreClients = () => { currentPage++; renderClientsFromMemory(); };

if (searchInput) {
    searchInput.addEventListener('input', () => { currentPage = 1; renderClientsFromMemory(); });
}
if (filterType) {
    filterType.addEventListener('change', (e) => { currentFilter = e.target.value; currentPage = 1; renderClientsFromMemory(); });
}

function renderClientRow(c) {
    let dateStr = '---';
    if (c.createdAt) {
        const d = c.createdAt.seconds ? new Date(c.createdAt.seconds * 1000) : new Date(c.createdAt);
        dateStr = d.toLocaleDateString('es-CO');
    }
    
    let sourceTag = '';
    const rawSource = (c.source || 'WEB').toUpperCase();

    if (rawSource === 'MAYORISTA') sourceTag = `<span class="bg-purple-100 text-purple-600 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-purple-200">Mayorista</span>`;
    else if (rawSource === 'MANUAL' || rawSource === 'EXCEL_IMPORT') sourceTag = `<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-slate-200">Manual</span>`;
    else sourceTag = `<span class="bg-brand-cyan/10 text-brand-cyan px-3 py-1 rounded-full text-[9px] font-black uppercase border border-brand-cyan/20">Web</span>`;

    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50/80 transition border-b border-gray-50 group fade-in";
    row.innerHTML = `
        <td class="px-4 md:px-8 py-4">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 font-black text-brand-cyan text-xs group-hover:bg-brand-cyan group-hover:text-white transition uppercase">
                    ${(c.name || c.userName || 'U').substring(0,1)}
                </div>
                <div class="min-w-0"> <div class="font-black text-brand-black text-sm uppercase truncate max-w-[200px]">${c.name || c.userName || 'Sin nombre'}</div>
                    ${c.document ? `<span class="text-[9px] text-gray-400 font-bold uppercase truncate block">DOC: ${c.document}</span>` : ''}
                </div>
            </div>
        </td>
        <td class="px-4 md:px-8 py-4">
            <div class="text-xs font-bold text-gray-600 truncate max-w-[150px]">${c.phone || '---'}</div>
            <div class="text-[10px] text-gray-400 font-medium truncate max-w-[150px]">${c.email || ''}</div>
        </td>
        <td class="px-4 md:px-8 py-4">${sourceTag}</td>
        <td class="px-4 md:px-8 py-4 text-xs text-gray-400 font-bold whitespace-nowrap">${dateStr}</td>
        <td class="px-4 md:px-8 py-4">
            <div class="flex items-center justify-center gap-2">
                <button onclick="window.editClient('${c.id}')" class="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 hover:bg-emerald-500 hover:text-white transition shadow-sm shrink-0"><i class="fa-solid fa-pen text-[10px]"></i></button>
                <a href="client-details.html?id=${c.id}" class="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-brand-black hover:text-white transition shadow-sm shrink-0"><i class="fa-solid fa-eye text-[10px]"></i></a>
            </div>
        </td>
    `;
    listContainer.appendChild(row);
}

// --- 3. API COLOMBIA ---
let deptsLoaded = false;
let globalDeptsData = [];

async function loadDepartments() {
    if (deptsLoaded) return; 
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        globalDeptsData = await res.json();
        globalDeptsData.sort((a, b) => a.name.localeCompare(b.name));
        inpDept.innerHTML = '<option value="">Seleccione...</option>';
        globalDeptsData.forEach(d => {
            const opt = document.createElement('option'); opt.value = d.id; opt.textContent = d.name; opt.dataset.name = d.name; inpDept.appendChild(opt);
        });
        deptsLoaded = true;
    } catch (e) { console.error("Error API:", e); }
}

async function loadCitiesForDept(deptId) {
    if (!inpCity) return;
    inpCity.innerHTML = '<option value="">Cargando...</option>'; inpCity.disabled = true;
    if (!deptId) { inpCity.innerHTML = '<option value="">Seleccione Depto...</option>'; return; }
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        const cities = await res.json(); cities.sort((a, b) => a.name.localeCompare(b.name));
        inpCity.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            const opt = document.createElement('option'); opt.value = c.name; opt.textContent = c.name; inpCity.appendChild(opt);
        });
        inpCity.disabled = false;
    } catch (e) { console.error(e); }
}
if(inpDept) inpDept.addEventListener('change', (e) => loadCitiesForDept(e.target.value));

// --- 4. MODAL CREAR / EDITAR ---
if (btnOpen) {
    btnOpen.onclick = () => {
        editingClientId = null; 
        document.getElementById('modal-title').innerHTML = `Registrar <span class="text-brand-cyan">Cliente</span>`;
        document.getElementById('new-client-type').disabled = false;
        document.getElementById('new-client-type').value = 'MANUAL';
        document.getElementById('web-client-warning').classList.add('hidden');
        document.querySelectorAll('#new-client-name, #new-client-phone, #new-client-doc, #new-client-email, #new-client-address, #new-client-notes').forEach(el => el.value = '');
        if(inpDept) inpDept.value = "";
        if(inpCity) { inpCity.innerHTML = '<option value="">Seleccione Depto...</option>'; inpCity.disabled = true; }
        
        btnSave.innerHTML = "Guardar Cliente"; loadDepartments(); modal.classList.remove('hidden');
    };
}

const closeModal = () => { modal.classList.add('hidden'); document.getElementById('import-modal').classList.add('hidden'); };
btnCloseList.forEach(btn => btn.onclick = closeModal);

window.editClient = async (id) => {
    const c = adminClientsCache.find(x => x.id === id);
    if(!c) return;

    editingClientId = id;
    document.getElementById('modal-title').innerHTML = `Editar <span class="text-emerald-500">Cliente</span>`;
    
    const typeSelect = document.getElementById('new-client-type');
    const rawSource = (c.source || 'WEB').toUpperCase();
    
    if (rawSource !== 'MANUAL' && rawSource !== 'MAYORISTA' && rawSource !== 'EXCEL_IMPORT') {
        typeSelect.querySelector('option[value="WEB"]').classList.remove('hidden');
        typeSelect.value = "WEB"; typeSelect.disabled = true; 
        document.getElementById('web-client-warning').classList.remove('hidden');
    } else {
        typeSelect.querySelector('option[value="WEB"]').classList.add('hidden');
        typeSelect.value = rawSource === 'MAYORISTA' ? 'MAYORISTA' : 'MANUAL';
        typeSelect.disabled = false; 
        document.getElementById('web-client-warning').classList.add('hidden');
    }
    
    document.getElementById('new-client-name').value = c.name || c.userName || '';
    document.getElementById('new-client-phone').value = c.phone || '';
    document.getElementById('new-client-doc').value = c.document || '';
    document.getElementById('new-client-email').value = c.email || '';
    document.getElementById('new-client-address').value = c.address || '';
    document.getElementById('new-client-notes').value = c.adminNotes || '';

    btnSave.innerHTML = "Actualizar Cliente";
    await loadDepartments();
    
    if (c.dept) {
        const option = [...inpDept.options].find(o => o.dataset.name === c.dept);
        if (option) { inpDept.value = option.value; await loadCitiesForDept(option.value); inpCity.value = c.city || ""; }
    } else {
        inpDept.value = ""; inpCity.innerHTML = '<option value="">Seleccione Depto...</option>'; inpCity.disabled = true;
    }
    modal.classList.remove('hidden');
}

// --- 5. GUARDAR ---
if (btnSave) {
    btnSave.onclick = async () => {
        const btnOriginalText = btnSave.innerHTML;
        btnSave.disabled = true; btnSave.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const typeSelect = document.getElementById('new-client-type');
        const name = document.getElementById('new-client-name').value.trim();
        const phone = document.getElementById('new-client-phone').value.trim();
        const documentVal = document.getElementById('new-client-doc').value.trim();
        const email = document.getElementById('new-client-email').value.trim();
        const address = document.getElementById('new-client-address').value.trim();
        const notes = document.getElementById('new-client-notes').value.trim();
        const deptSelect = document.getElementById('new-client-dept');
        const deptName = deptSelect.options[deptSelect.selectedIndex]?.dataset.name || "";
        const city = document.getElementById('new-client-city').value;

        if(!name) { alert("El nombre es obligatorio."); btnSave.disabled = false; btnSave.innerHTML = btnOriginalText; return; }

        try {
            if (editingClientId) {
                let updateData = { name, phone, email, document: documentVal, adminNotes: notes, address, dept: deptName, city, updatedAt: Timestamp.now() };
                if (!typeSelect.disabled) updateData.source = typeSelect.value;
                await updateDoc(doc(db, "users", editingClientId), updateData);
                alert("✅ Actualizado");
            } else {
                const newClientData = {
                    name, phone, email, document: documentVal, adminNotes: notes, source: typeSelect.value, role: 'client',
                    createdAt: Timestamp.now(), updatedAt: Timestamp.now(), address, dept: deptName, city,
                    addresses: address ? [{ alias: "Principal", address, dept: deptName, city, isDefault: true }] : []
                };
                await addDoc(collection(db, "users"), newClientData);
                alert("✅ Registrado");
            }
            closeModal();
        } catch (e) { alert("Error: " + e.message); } 
        finally { btnSave.disabled = false; btnSave.innerHTML = btnOriginalText; }
    };
}

// ==========================================================================
// 📥 IMPORTACIÓN EXCEL
// ==========================================================================
const btnOpenImport = document.getElementById('btn-import-clients');
const fileInput = document.getElementById('excel-file-input');
const btnProcessImport = document.getElementById('btn-process-import');
let parsedExcelData = [];

if (btnOpenImport) {
    btnOpenImport.onclick = () => {
        fileInput.value = ""; document.getElementById('file-name-display').textContent = "Ningún archivo seleccionado";
        btnProcessImport.disabled = true; document.getElementById('import-status').classList.add('hidden');
        document.getElementById('import-modal').classList.remove('hidden');
    };
}

if (document.getElementById('btn-download-template')) {
    document.getElementById('btn-download-template').onclick = async (e) => {
        const btn = e.target; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Generando...';
        await loadDepartments();
        const ws_data = [['Tipo_Cliente (Solo: MANUAL o MAYORISTA)', 'Nombre_Completo', 'Telefono', 'Cedula_NIT', 'Email', 'Departamento', 'Ciudad', 'Direccion_Entrega', 'Notas'], ['MAYORISTA', 'Empresa Tech SAS', '3001234567', '900123456-7', 'ventas@tech.com', 'Bogotá D.C.', 'Bogotá, D.C.', 'Calle', 'Nota']];
        const ws1 = XLSX.utils.aoa_to_sheet(ws_data);
        const dict_data = [['Tipos_de_Cliente_Validos', 'Departamentos_Validos'], ['MANUAL', '']];
        globalDeptsData.forEach((d, idx) => { if(idx===0) dict_data[1][1]=d.name; else if(idx===1) dict_data.push(['MAYORISTA',d.name]); else dict_data.push(['',d.name]); });
        const ws2 = XLSX.utils.aoa_to_sheet(dict_data);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws1, "Registros"); XLSX.utils.book_append_sheet(wb, ws2, "Valores");
        XLSX.writeFile(wb, "Plantilla.xlsx");
        btn.innerHTML = '<i class="fa-solid fa-download mr-2"></i> Descargar Plantilla';
    };
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        document.getElementById('file-name-display').textContent = file.name;
        btnProcessImport.disabled = true; btnProcessImport.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Leyendo...';
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const workbook = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
                parsedExcelData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
                if (parsedExcelData.length > 0) { btnProcessImport.disabled = false; btnProcessImport.innerHTML = `Procesar ${parsedExcelData.length} Clientes`; }
            } catch (err) { alert("Error al leer Excel"); btnProcessImport.innerHTML = 'Procesar'; }
        };
        reader.readAsArrayBuffer(file);
    });
}

if (btnProcessImport) {
    btnProcessImport.onclick = async () => {
        if (parsedExcelData.length === 0) return;
        btnProcessImport.disabled = true; btnProcessImport.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Subiendo a BD...';
        document.getElementById('import-status').classList.remove('hidden');

        let added = 0; let skipped = 0; let errors = 0;
        const elAdded = document.getElementById('res-added'); const elSkipped = document.getElementById('res-skipped'); const elErrors = document.getElementById('res-errors');

        for (const row of parsedExcelData) {
            const rawType = String(row[Object.keys(row).find(k => k.includes('Tipo_Cliente'))] || '').trim().toUpperCase();
            const name = String(row['Nombre_Completo'] || '').trim(); const phone = String(row['Telefono'] || '').trim(); const docVal = String(row['Cedula_NIT'] || '').trim();
            if (!name) { skipped++; elSkipped.textContent = skipped; continue; }
            if (rawType !== 'MAYORISTA' && rawType !== 'MANUAL') { errors++; elErrors.textContent = errors; continue; }

            const isDuplicate = docVal ? adminClientsCache.some(c => c.document === docVal) : false;

            if (isDuplicate) { skipped++; elSkipped.textContent = skipped; } 
            else {
                try {
                    await addDoc(collection(db, "users"), { name, phone, email: String(row['Email'] || '').trim(), document: docVal, adminNotes: String(row['Notas'] || '').trim(), source: rawType, role: 'client', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), dept: String(row['Departamento'] || '').trim(), city: String(row['Ciudad'] || '').trim(), address: String(row['Direccion_Entrega'] || '').trim() });
                    added++; elAdded.textContent = added;
                } catch (err) { errors++; elErrors.textContent = errors; }
            }
        } 
        btnProcessImport.innerHTML = '<i class="fa-solid fa-check-double"></i> Importación Finalizada';
        setTimeout(() => { alert(`✅ ${added} Nuevos\n⏭️ ${skipped} Omitidos\n❌ ${errors} Errores`); closeModal(); }, 500);
    };
}