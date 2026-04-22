import { db, storage, doc, updateDoc, ref, uploadBytes, getDownloadURL, getDoc } from './firebase-init.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO

// DOM Elements
const listContainer = document.getElementById('invoices-list');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('invoice-search');

// Modal Upload
const uploadModal = document.getElementById('upload-modal');
const uploadForm = document.getElementById('upload-form');
const fileInput = document.getElementById('invoice-file');
const fileNameDisplay = document.getElementById('file-name-display');
const targetOrderIdInput = document.getElementById('target-order-id');
const modalOrderIdDisplay = document.getElementById('modal-order-id');
const invoiceNumberInput = document.getElementById('invoice-number');

// Modal Detalles
const detailsModal = document.getElementById('details-modal');
const dtEls = {
    id: document.getElementById('dt-order-id'),
    cName: document.getElementById('dt-client-name'),
    cPhone: document.getElementById('dt-client-phone'),
    cEmail: document.getElementById('dt-client-email'),
    bName: document.getElementById('dt-bill-name'),
    bNit: document.getElementById('dt-bill-nit'),
    bPhone: document.getElementById('dt-bill-phone'),
    bAddress: document.getElementById('dt-bill-address'),
    bEmail: document.getElementById('dt-bill-email'),
    table: document.getElementById('dt-items-table'),
    base: document.getElementById('dt-calc-base'),
    iva: document.getElementById('dt-calc-iva'),
    total: document.getElementById('dt-calc-total')
};

// --- ESTADO GLOBAL ---
const PAGE_SIZE = 50;
let currentPage = 1;
let currentFilter = 'PENDING';
let adminInvoicesCache = []; // Caché en memoria sincronizado con el Store

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToInvoices((invoices) => {
    adminInvoicesCache = invoices;
    renderInvoicesFromMemory();
});

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================
function renderInvoicesFromMemory() {
    if (!listContainer) return;

    let filtered = adminInvoicesCache;
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // A. Filtrar por Pestaña
    if (currentFilter === 'PENDING') {
        filtered = filtered.filter(inv => inv.billingStatus !== 'COMPLETED');
    } else if (currentFilter === 'COMPLETED') {
        filtered = filtered.filter(inv => inv.billingStatus === 'COMPLETED');
    }

    // B. Filtrar por Búsqueda (RAM)
    if (term.length > 0) {
        filtered = filtered.filter(inv => 
            inv.id.toLowerCase().includes(term) ||
            (inv.billingInfo?.name || inv.userName || "").toLowerCase().includes(term) ||
            (inv.billingInfo?.taxId || inv.clientDoc || "").toLowerCase().includes(term)
        );
    }

    listContainer.innerHTML = "";

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div class="text-center py-16 opacity-50"><i class="fa-solid fa-folder-open text-4xl mb-4 text-gray-300"></i><p class="text-xs font-bold text-gray-400 uppercase">No hay facturas en esta vista</p></div>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    // C. Paginación
    const endIdx = currentPage * PAGE_SIZE;
    const pageData = filtered.slice(0, endIdx);

    pageData.forEach(inv => renderInvoiceCard(inv));

    if (endIdx < filtered.length) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Mostrar más (${endIdx}/${filtered.length})`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }
}

window.loadMoreInvoices = () => {
    currentPage++;
    renderInvoicesFromMemory();
};

window.filterTab = (status) => {
    currentFilter = status;
    currentPage = 1;
    if(searchInput) searchInput.value = ""; 
    
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.classList.remove('border-b-2', 'border-brand-cyan', 'text-brand-black', 'bg-white');
        btn.classList.add('border-transparent', 'text-gray-400');
    });
    const activeBtn = document.getElementById(status === 'PENDING' ? 'tab-pending' : status === 'COMPLETED' ? 'tab-completed' : 'tab-all');
    if(activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-gray-400');
        activeBtn.classList.add('border-b-2', 'border-brand-cyan', 'text-brand-black', 'bg-white');
    }
    
    renderInvoicesFromMemory();
};

if (searchInput) {
    searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderInvoicesFromMemory();
    });
}

// --- 2. RENDER CARD ---
function renderInvoiceCard(order) {
    const billing = order.billingInfo || order.billingData || {};
    const isCompleted = order.invoiceUrl || order.billingStatus === 'COMPLETED';
    const date = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString('es-CO') : '---';
    const rowClass = isCompleted ? 'border-l-4 border-l-green-400' : 'border-l-4 border-l-yellow-400';
    
    const invoiceLabel = isCompleted && order.invoiceNumber 
        ? `<span class="block text-[9px] font-mono text-gray-500 mt-1">Ref: ${order.invoiceNumber}</span>` : '';

    const badgeHTML = isCompleted 
        ? `<div class="text-center"><span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-50 text-green-700 text-[9px] font-black uppercase border border-green-100"><i class="fa-solid fa-check"></i> Facturado</span>${invoiceLabel}</div>`
        : `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-[9px] font-black uppercase border border-yellow-100"><i class="fa-regular fa-clock"></i> Pendiente</span>`;

    const div = document.createElement('div');
    div.className = `bg-white p-4 md:px-6 md:py-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col md:grid md:grid-cols-12 gap-4 items-center fade-in ${rowClass}`;
    
    div.innerHTML = `
        <div class="w-full md:col-span-2 flex flex-row md:flex-col justify-between md:justify-center">
            <span class="text-[10px] font-black text-brand-black uppercase tracking-wider font-mono">#${order.id.slice(0, 8)}</span>
            <span class="text-[9px] text-gray-400 font-bold">${date}</span>
        </div>
        <div class="w-full md:col-span-4">
            <h4 class="text-xs font-black text-brand-black uppercase truncate" title="${billing.name}">${billing.name || order.userName || 'Sin Nombre'}</h4>
            <div class="flex gap-3 mt-1">
                <span class="text-[9px] font-bold text-gray-400 font-mono bg-gray-50 px-1 rounded">NIT: ${billing.taxId || order.clientDoc || '---'}</span>
            </div>
        </div>
        <div class="w-full md:col-span-2 md:text-right flex justify-between md:block">
            <span class="md:hidden text-[9px] font-bold text-gray-400 uppercase">Monto:</span>
            <span class="text-sm font-black text-brand-cyan">$${(order.total || 0).toLocaleString('es-CO')}</span>
        </div>
        <div class="w-full md:col-span-2 flex justify-center">${badgeHTML}</div>
        
        <div class="w-full md:col-span-2 flex justify-end gap-2">
            <button onclick="window.openDetailsModal('${order.id}')" class="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 text-blue-500 hover:bg-blue-100 hover:text-blue-700 flex items-center justify-center transition" title="Ver Datos para Facturar">
                <i class="fa-solid fa-magnifying-glass-plus"></i>
            </button>

            ${isCompleted && order.invoiceUrl ? `
                <a href="${order.invoiceUrl}" target="_blank" class="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 hover:text-brand-cyan hover:border-brand-cyan flex items-center justify-center transition" title="Ver PDF">
                    <i class="fa-solid fa-eye"></i>
                </a>
                <button onclick="window.openUploadModal('${order.id}', '${order.invoiceNumber || ''}')" class="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 text-gray-400 hover:text-brand-black hover:border-gray-300 flex items-center justify-center transition" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
            ` : `
                <button onclick="window.openUploadModal('${order.id}')" class="w-8 h-8 rounded-lg bg-brand-black text-white hover:bg-brand-cyan hover:text-brand-black transition flex items-center justify-center" title="Subir Factura">
                    <i class="fa-solid fa-cloud-arrow-up"></i>
                </button>
            `}
        </div>
    `;
    listContainer.appendChild(div);
}

// --- 3. MODALES (DETALLES Y UPLOAD) - Lógica de Negocio ---

// A. Abrir Detalles (Leemos 1 doc de Firebase para traer los items pesados que no están en caché)
window.openDetailsModal = async (orderId) => {
    const docSnap = await getDoc(doc(db, "orders", orderId));
    if (!docSnap.exists()) return;
    
    const order = docSnap.data();
    const billing = order.billingInfo || order.billingData || {};
    const shipping = order.shippingData || {};

    dtEls.id.textContent = orderId.slice(0, 8).toUpperCase();
    dtEls.cName.textContent = order.userName || "---";
    dtEls.cPhone.textContent = order.phone || "---";
    dtEls.cEmail.textContent = order.userEmail || "---";
    dtEls.bName.textContent = billing.name || order.userName || "---";
    dtEls.bNit.textContent = billing.taxId || order.clientDoc || "---";
    dtEls.bPhone.textContent = billing.phone || order.phone || "---";
    dtEls.bAddress.textContent = billing.address || shipping.address || "---";
    dtEls.bEmail.textContent = billing.email || order.userEmail || "---";

    dtEls.table.innerHTML = (order.items || []).map(item => {
        const unitGross = item.price || item.unit_price || 0; 
        const quantity = item.quantity || 1;
        const unitBase = Math.round(unitGross / 1.19);
        const totalLine = unitGross * quantity;

        return `
        <tr class="hover:bg-slate-50 border-b border-gray-50 last:border-0 group">
            <td class="p-3"><p class="uppercase leading-tight font-bold text-xs">${item.name || item.title}</p></td>
            <td class="p-3 text-center font-bold">${quantity}</td>
            <td class="p-3 text-right bg-blue-50/30"><p class="font-black text-blue-600">$${unitBase.toLocaleString('es-CO')}</p></td>
            <td class="p-3 text-right"><p class="font-black text-brand-black">$${totalLine.toLocaleString('es-CO')}</p></td>
        </tr>`;
    }).join('');

    const total = order.total || 0;
    const base = Math.round(total / 1.19);
    const iva = total - base;

    dtEls.base.textContent = `$${base.toLocaleString('es-CO')}`;
    dtEls.iva.textContent = `$${iva.toLocaleString('es-CO')}`;
    dtEls.total.textContent = `$${total.toLocaleString('es-CO')}`;

    detailsModal.classList.remove('hidden');
    detailsModal.classList.add('flex');
};

window.closeDetailsModal = () => {
    detailsModal.classList.add('hidden');
    detailsModal.classList.remove('flex');
};

// B. Upload Logic
window.openUploadModal = (orderId, currentInvoiceNum = "") => {
    targetOrderIdInput.value = orderId;
    modalOrderIdDisplay.textContent = `Orden #${orderId.slice(0, 8).toUpperCase()}`;
    fileInput.value = ""; 
    fileNameDisplay.textContent = "";
    invoiceNumberInput.value = currentInvoiceNum; 
    uploadModal.classList.remove('hidden');
    uploadModal.classList.add('flex');
};

window.closeUploadModal = () => {
    uploadModal.classList.add('hidden');
    uploadModal.classList.remove('flex');
};

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) fileNameDisplay.textContent = fileInput.files[0].name;
});

uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderId = targetOrderIdInput.value;
    const file = fileInput.files[0];
    const invoiceNum = invoiceNumberInput.value.trim().toUpperCase(); 
    const btn = uploadForm.querySelector('button');
    const originalText = btn.innerHTML;

    if (!file && !invoiceNumberInput.value) return alert("Selecciona un PDF o ingresa un número"); 
    if (!invoiceNum) return alert("Ingresa el número de factura");

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

        let downloadURL = null;

        if (file) {
            const storageRef = ref(storage, `invoices/${orderId}_${Date.now()}.pdf`);
            await uploadBytes(storageRef, file);
            downloadURL = await getDownloadURL(storageRef);
        }

        const updateData = {
            invoiceNumber: invoiceNum,
            billingStatus: 'COMPLETED',
            updatedAt: new Date(), // 🔥 Dispara el onSnapshot del Store
            invoicedAt: new Date()
        };
        if (downloadURL) updateData.invoiceUrl = downloadURL;

        await updateDoc(doc(db, "orders", orderId), updateData);

        alert("✅ Factura guardada correctamente.");
        closeUploadModal();

    } catch (error) {
        console.error("Error:", error);
        alert("Error al subir: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});