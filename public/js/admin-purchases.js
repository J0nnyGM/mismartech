import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL

loadAdminSidebar();

// --- REFERENCIAS DOM ---
const tableBody = document.getElementById('purchases-table-body');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('search-input');

// --- ESTADO GLOBAL ---
const PAGE_SIZE = 50;
let currentPage = 1;
let adminPurchasesCache = []; // Recibirá los datos en RAM

const formatMoney = (amount) => `$${Math.round(amount || 0).toLocaleString('es-CO')}`;

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToPurchases((purchases) => {
    adminPurchasesCache = purchases;
    renderPurchasesFromMemory();
});

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================
function renderPurchasesFromMemory() {
    if (!tableBody) return;

    let filtered = adminPurchasesCache;
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // Búsqueda ultrarrápida en RAM
    if (term.length > 0) {
        filtered = filtered.filter(p => 
            p.id.toLowerCase().includes(term) || 
            (p.supplierName || "").toLowerCase().includes(term)
        );
    }

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontraron compras.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    const endIdx = currentPage * PAGE_SIZE;
    const pageData = filtered.slice(0, endIdx);

    pageData.forEach(p => renderRow(p));

    if (endIdx < filtered.length) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar Anteriores (${endIdx}/${filtered.length})`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }
}

window.loadMorePurchases = () => {
    currentPage++;
    renderPurchasesFromMemory();
};

if (searchInput) {
    searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderPurchasesFromMemory();
    });
}

// ==========================================================================
// RENDERIZADO DE FILAS Y MODAL
// ==========================================================================
function renderRow(p) {
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    const dateStr = !isNaN(dateObj) ? dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
    
    let totalItems = 0;
    if (p.items && Array.isArray(p.items)) {
        totalItems = p.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
    }

    const shortId = p.id.slice(0, 8).toUpperCase();
    const adminName = p.createdBy || "Sistema";

    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 transition border-b border-gray-50 fade-in";
    tr.innerHTML = `
        <td class="px-8 py-6">
            <div class="font-black text-brand-cyan uppercase tracking-tighter text-sm mb-1">#${shortId}</div>
            <div class="text-[9px] font-bold text-gray-500">${dateStr}</div>
        </td>
        <td class="px-8 py-6">
            <div class="font-black text-brand-black uppercase text-xs truncate max-w-[200px]">${p.supplierName || 'Desconocido'}</div>
        </td>
        <td class="px-8 py-6 text-center">
            <span class="bg-gray-100 text-gray-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase border border-gray-200">${totalItems} Unidades</span>
        </td>
        <td class="px-8 py-6 text-center text-[10px] font-bold text-gray-400 uppercase">${adminName}</td>
        <td class="px-8 py-6 text-right font-black text-brand-black text-base">${formatMoney(p.totalCost)}</td>
        <td class="px-8 py-6 text-center">
            <button onclick="window.viewPurchaseDetail('${p.id}')" title="Ver Factura" class="w-9 h-9 mx-auto rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan hover:shadow-md transition flex items-center justify-center">
                <i class="fa-solid fa-eye text-xs"></i>
            </button>
        </td>
    `;
    tableBody.appendChild(tr);
}

// Ver Detalle (0 Lecturas)
window.viewPurchaseDetail = (id) => {
    const p = adminPurchasesCache.find(x => x.id === id);
    if (!p) return;

    document.getElementById('modal-purchase-id').textContent = `#${p.id.slice(0, 8).toUpperCase()}`;
    const dateObj = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
    document.getElementById('modal-purchase-date').textContent = !isNaN(dateObj) ? dateObj.toLocaleString('es-CO') : '--';

    document.getElementById('modal-supplier-name').textContent = p.supplierName || 'No registrado';
    document.getElementById('modal-admin-name').textContent = p.createdBy || 'Sistema';
    
    const ivaBadge = document.getElementById('modal-iva-badge');
    if (p.hasIVA) {
        ivaBadge.textContent = "SÍ (Aplicado)";
        ivaBadge.className = "inline-block px-3 py-1 rounded bg-brand-cyan/10 text-brand-cyan text-[10px] font-black uppercase tracking-widest border border-brand-cyan/20";
    } else {
        ivaBadge.textContent = "NO APLICADO";
        ivaBadge.className = "inline-block px-3 py-1 rounded bg-gray-100 text-gray-500 text-[10px] font-black uppercase tracking-widest border border-gray-200";
    }

    const itemsTbody = document.getElementById('modal-items-list');
    itemsTbody.innerHTML = "";

    if (p.items && p.items.length > 0) {
        p.items.forEach(item => {
            let variantText = '';
            if (item.color || item.capacity) {
                variantText = `<br><span class="text-[9px] text-gray-400 uppercase font-bold tracking-widest">${item.capacity ? item.capacity + ' ' : ''}${item.color ? item.color : ''}</span>`;
            }

            itemsTbody.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-4">
                        <span class="font-black text-brand-black text-xs uppercase">${item.name}</span>
                        ${variantText}
                    </td>
                    <td class="p-4 text-center font-black text-brand-cyan">${item.quantity}</td>
                    <td class="p-4 text-right font-bold text-gray-600">${formatMoney(item.unitCostBase)}</td>
                    <td class="p-4 text-right font-black text-brand-black">${formatMoney(item.totalRow)}</td>
                </tr>
            `;
        });
    } else {
        itemsTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-xs font-bold text-gray-400">Sin detalles registrados.</td></tr>`;
    }

    document.getElementById('modal-purchase-total').textContent = formatMoney(p.totalCost);
    document.getElementById('purchase-modal').classList.remove('hidden');
};