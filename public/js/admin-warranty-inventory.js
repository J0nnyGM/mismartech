import { db, collection, addDoc, doc, updateDoc, getDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO

loadAdminSidebar();

const container = document.getElementById('rma-container');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('rma-search');
const statusModal = document.getElementById('status-modal');
const tabActive = document.getElementById('tab-active');
const tabHistory = document.getElementById('tab-history');

// Estado Local
const PAGE_SIZE = 50;
let currentPage = 1;
let currentView = 'active'; // 'active' | 'history'
let currentItem = null;
let adminRmaCache = []; // RAM Cache recibido del Store

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToRma((rmaItems) => {
    adminRmaCache = rmaItems;
    renderInventoryFromMemory();
});

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================
function renderInventoryFromMemory() {
    if (!container) return;

    let filtered = adminRmaCache;
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // A. Filtrar por Vista (Activos vs Historial)
    if (currentView === 'active') {
        filtered = filtered.filter(item => item.status !== 'ENTREGADO' && item.status !== 'FINALIZADO');
    } else {
        filtered = filtered.filter(item => item.status === 'ENTREGADO' || item.status === 'FINALIZADO');
    }

    // B. Filtrar por Búsqueda (RAM)
    if (term.length > 0) {
        filtered = filtered.filter(item => 
            (item.productName || "").toLowerCase().includes(term) ||
            (item.sn || "").toLowerCase().includes(term) ||
            (item.notes || "").toLowerCase().includes(term)
        );
    }

    container.innerHTML = "";

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center py-10 text-gray-400 text-xs font-bold uppercase">No hay registros en esta vista.</div>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    // C. Paginación y Agrupación
    const endIdx = currentPage * PAGE_SIZE;
    const pageData = filtered.slice(0, endIdx);

    renderGroupedInventory(pageData);

    if (endIdx < filtered.length) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Mostrar más (${endIdx}/${filtered.length})`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }
}

window.loadMoreInventory = () => {
    currentPage++;
    renderInventoryFromMemory();
};

window.setView = (mode) => {
    currentView = mode;
    currentPage = 1;
    if(searchInput) searchInput.value = ""; 

    if(mode === 'active') {
        tabActive.classList.add('active', 'text-brand-cyan', 'border-brand-cyan');
        tabActive.classList.remove('text-gray-400', 'border-transparent');
        tabHistory.classList.add('text-gray-400', 'border-transparent');
        tabHistory.classList.remove('active', 'text-brand-cyan', 'border-brand-cyan');
    } else {
        tabHistory.classList.add('active', 'text-brand-cyan', 'border-brand-cyan');
        tabHistory.classList.remove('text-gray-400', 'border-transparent');
        tabActive.classList.add('text-gray-400', 'border-transparent');
        tabActive.classList.remove('active', 'text-brand-cyan', 'border-brand-cyan');
    }
    
    renderInventoryFromMemory();
};

if (searchInput) {
    searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderInventoryFromMemory();
    });
}

function renderGroupedInventory(items) {
    const groups = {};
    
    items.forEach(item => {
        const key = item.productName || "Desconocido";
        if (!groups[key]) { groups[key] = { name: key, count: 0, units: [] }; }
        groups[key].units.push(item);
        groups[key].count++;
    });

    const htmlBuffer = Object.values(groups).map(group => {
        const unitsHTML = group.units.map(unit => {
            let badgeColor = "bg-gray-100 text-gray-600";
            if(unit.status === 'EN_REVISION_TECNICA') badgeColor = "bg-yellow-100 text-yellow-700";
            if(unit.status === 'REPARADO') badgeColor = "bg-green-100 text-green-700";
            if(unit.status === 'IRREPARABLE') badgeColor = "bg-red-100 text-red-700";
            if(unit.status === 'EN_STOCK_REPUESTOS') badgeColor = "bg-indigo-100 text-indigo-700 border border-indigo-200";
            if(unit.status === 'ENTREGADO' || unit.status === 'FINALIZADO') badgeColor = "bg-brand-cyan/20 text-brand-cyan";

            const actionBtn = currentView === 'active' 
                ? `<button onclick="window.openStatusModal('${unit.id}')" class="bg-brand-black text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase hover:bg-brand-cyan hover:text-brand-black transition shadow-sm">Gestionar</button>`
                : `<span class="text-[9px] font-bold text-gray-400">Archivado</span>`;

            let historyInfo = "";
            if (currentView === 'history' && unit.exitDestination) {
                historyInfo = `<br><span class="text-[8px] font-bold text-brand-red uppercase">Salida: ${unit.exitDestination.replace(/_/g, ' ')}</span>`;
            }

            const dateStr = unit.entryDate?.toDate ? unit.entryDate.toDate().toLocaleDateString() : '---';

            return `
            <tr class="border-b border-gray-50 last:border-0 hover:bg-slate-50 transition item-row-searchable">
                <td class="p-4 w-48">
                    <p class="font-mono text-[10px] font-bold text-brand-cyan bg-brand-cyan/5 px-2 py-1 rounded w-fit select-all searchable-sn">${unit.sn}</p>
                    <p class="text-[9px] text-gray-400 mt-1">${dateStr}</p>
                </td>
                <td class="p-4">
                    <p class="text-[10px] font-bold text-gray-600 uppercase mb-1">Estado Físico:</p>
                    <span class="inline-block px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${badgeColor}">
                        ${unit.status.replace(/_/g, ' ')}
                    </span>
                    ${historyInfo}
                </td>
                <td class="p-4 max-w-xs">
                    <p class="text-[10px] font-bold text-gray-600 uppercase mb-1">Notas:</p>
                    <p class="text-xs text-gray-500 italic truncate" title="${unit.notes}">${unit.notes}</p>
                    ${unit.exitNotes ? `<p class="text-[9px] text-red-400 italic mt-1">Salida: ${unit.exitNotes}</p>` : ''}
                </td>
                <td class="p-4 text-right">
                    ${actionBtn}
                </td>
            </tr>`;
        }).join('');

        return `
            <div class="bg-white border border-gray-100 rounded-[2rem] shadow-sm overflow-hidden fade-in mb-6 group-card-searchable">
                <div class="bg-slate-50 p-6 flex justify-between items-center border-b border-gray-100">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-gray-400 shadow-sm">
                            <i class="fa-solid fa-box text-xl"></i>
                        </div>
                        <div>
                            <h3 class="text-lg font-black uppercase text-brand-black searchable-name">${group.name}</h3>
                            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                ${currentView === 'active' ? 'Stock Activo' : 'Historial'}: <span class="text-brand-cyan text-sm">${group.count}</span>
                            </p>
                        </div>
                    </div>
                </div>
                <div class="overflow-x-auto"><table class="w-full text-left"><tbody class="divide-y divide-gray-50">${unitsHTML}</tbody></table></div>
            </div>
        `;
    }).join('');

    container.innerHTML = htmlBuffer;
}

// --- 5. MODAL GESTIÓN Y LÓGICA DE NEGOCIO ---
window.openStatusModal = async (id) => {
    try {
        // Pedimos datos frescos por si otro admin modificó el RMA al mismo tiempo
        const snap = await getDoc(doc(db, "warranty_inventory", id));
        if (!snap.exists()) return alert("Item no encontrado");
        
        currentItem = { id: snap.id, ...snap.data() };

        document.getElementById('m-prod-name').textContent = currentItem.productName;
        document.getElementById('m-sn').textContent = `SN: ${currentItem.sn}`;
        document.getElementById('m-new-status').value = currentItem.status;
        
        // Reset inputs
        document.getElementById('m-exit-destination').value = "";
        document.getElementById('m-exit-notes').value = "";
        document.getElementById('m-keep-parts').checked = false;
        document.getElementById('parts-input-container').classList.add('hidden');
        document.getElementById('m-part-name').value = "";
        document.getElementById('m-part-notes').value = "";

        statusModal.classList.remove('hidden');
    } catch(e) { console.error(e); }
};

window.closeStatusModal = () => {
    statusModal.classList.add('hidden');
    currentItem = null;
};

window.togglePartsInput = () => {
    const isChecked = document.getElementById('m-keep-parts').checked;
    const div = document.getElementById('parts-input-container');
    if (isChecked) div.classList.remove('hidden');
    else div.classList.add('hidden');
};

window.updateStatus = async () => {
    const newStatus = document.getElementById('m-new-status').value;
    try {
        await updateDoc(doc(db, "warranty_inventory", currentItem.id), { 
            status: newStatus,
            updatedAt: new Date() // 🔥 Trigger al Store Central
        });
        alert("✅ Estado actualizado.");
        closeStatusModal();
    } catch (e) { alert("Error: " + e.message); }
};

window.finalizeExit = async () => {
    const destination = document.getElementById('m-exit-destination').value;
    const notes = document.getElementById('m-exit-notes').value;
    const keepParts = document.getElementById('m-keep-parts').checked;

    if (!destination) return alert("Selecciona un destino final.");
    if (!confirm("¿Confirmas la salida? Se moverá al historial.")) return;

    try {
        await updateDoc(doc(db, "warranty_inventory", currentItem.id), {
            status: 'ENTREGADO',
            exitDestination: destination,
            exitNotes: notes,
            exitDate: new Date(),
            updatedAt: new Date() // 🔥 Trigger
        });

        if (keepParts) {
            const partName = document.getElementById('m-part-name').value.trim() || "Repuesto Genérico";
            const partNotes = document.getElementById('m-part-notes').value.trim();
            
            await addDoc(collection(db, "warranty_inventory"), {
                warrantyId: currentItem.warrantyId, 
                productId: currentItem.productId,
                productName: `REPUESTO: ${partName} (de ${currentItem.productName})`,
                sn: `${currentItem.sn}-PART`, 
                componentsReceived: "Extraído de unidad entregada/desguazada",
                notes: partNotes || "Pieza rescatada.",
                status: 'EN_STOCK_REPUESTOS', 
                entryDate: new Date(),
                updatedAt: new Date() // 🔥 Trigger
            });
            alert("✅ Salida registrada Y repuesto guardado.");
        } else {
            alert("✅ Salida registrada.");
        }

        // Intentar cerrar garantía padre
        if (currentItem.warrantyId) {
            try {
                const wRef = doc(db, "warranties", currentItem.warrantyId);
                await updateDoc(wRef, { status: 'FINALIZADO', resolvedAt: new Date(), updatedAt: new Date() });
            } catch(e) { console.warn("No se pudo cerrar garantía padre", e); }
        }

        closeStatusModal();
    } catch (e) { alert("Error: " + e.message); }
};