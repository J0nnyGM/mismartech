import { db, storage, collection, doc, updateDoc, getDoc, runTransaction, ref, uploadBytes, getDownloadURL } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO

loadAdminSidebar();

// Elementos del DOM
const table = document.getElementById('warranties-table');
const manageModal = document.getElementById('manage-modal');
const resolutionModal = document.getElementById('resolution-modal');
const loadMoreBtn = document.getElementById('load-more-container');
const searchInput = document.getElementById('search-input');

// Estado Global
const PAGE_SIZE = 50;
let currentPage = 1;
let currentFilter = 'PENDING';
let currentWarranty = null; 
let adminWarrantiesCache = []; // RAM Cache recibido del Store

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToWarranties((warranties) => {
    adminWarrantiesCache = warranties;
    renderWarrantiesFromMemory();
});

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================
function renderWarrantiesFromMemory() {
    if (!table) return;

    let filtered = adminWarrantiesCache;
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // A. Filtrar por Estado (Tab)
    if (currentFilter === 'PENDING') {
        filtered = filtered.filter(w => w.status === 'PENDIENTE' || w.status === 'PENDIENTE_REVISION');
    } else if (currentFilter === 'APPROVED') {
        filtered = filtered.filter(w => w.status === 'APROBADO');
    } else if (currentFilter === 'REJECTED') {
        filtered = filtered.filter(w => w.status === 'RECHAZADO');
    }

    // B. Filtrar por Búsqueda (RAM)
    if (term.length > 0) {
        filtered = filtered.filter(w => 
            w.id.toLowerCase().includes(term) ||
            (w.orderId || "").toLowerCase().includes(term) ||
            (w.snProvided || "").toLowerCase().includes(term) ||
            (w.userName || "").toLowerCase().includes(term)
        );
    }

    table.innerHTML = "";

    if (filtered.length === 0) {
        table.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No hay solicitudes en esta vista.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    // C. Paginación
    const endIdx = currentPage * PAGE_SIZE;
    const pageData = filtered.slice(0, endIdx);

    pageData.forEach(w => renderWarrantyRow(w));

    if (endIdx < filtered.length) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Mostrar más (${endIdx}/${filtered.length})`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }
}

window.loadMoreWarranties = () => {
    currentPage++;
    renderWarrantiesFromMemory();
};

window.filterTab = (status) => {
    currentFilter = status;
    currentPage = 1;
    if(searchInput) searchInput.value = ""; 

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.className = "tab-btn px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest bg-white text-gray-400 border border-gray-200 hover:text-brand-black hover:border-gray-300 transition-all whitespace-nowrap cursor-pointer";
    });
    
    const activeId = status === 'PENDING' ? 'tab-pending' : 
                     status === 'APPROVED' ? 'tab-approved' : 
                     status === 'REJECTED' ? 'tab-rejected' : 'tab-all';
    
    const activeBtn = document.getElementById(activeId);
    if(activeBtn) {
        let colorClass = "bg-brand-black text-white shadow-lg"; 
        if(status === 'PENDING') colorClass = "bg-brand-cyan text-white shadow-lg shadow-cyan-500/30 border-transparent";
        if(status === 'APPROVED') colorClass = "bg-green-500 text-white shadow-lg shadow-green-500/30 border-transparent";
        if(status === 'REJECTED') colorClass = "bg-red-500 text-white shadow-lg shadow-red-500/30 border-transparent";
        
        activeBtn.className = `tab-btn px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap cursor-default ${colorClass}`;
    }

    renderWarrantiesFromMemory();
};

if (searchInput) {
    searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderWarrantiesFromMemory();
    });
}

function renderWarrantyRow(w) {
    let statusBadge = `<span class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-yellow-200">Pendiente</span>`;
    if (w.status === 'APROBADO') statusBadge = `<span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-green-200">Aprobado</span>`;
    if (w.status === 'RECHAZADO') statusBadge = `<span class="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-red-200">Rechazado</span>`;
    if (w.status === 'FINALIZADO') statusBadge = `<span class="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-gray-200">Finalizado</span>`;

    let actionBtn = `<button onclick="window.openManageModal('${w.id}')" class="bg-brand-black text-white px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-brand-cyan hover:text-brand-black transition shadow-md">Gestionar</button>`;
    if (w.status !== 'PENDIENTE_REVISION' && w.status !== 'PENDIENTE') {
        actionBtn = `<button onclick="window.openManageModal('${w.id}')" class="bg-slate-100 text-gray-400 px-4 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-slate-200 transition">Ver Detalle</button>`;
    }

    const dateStr = w.createdAt?.toDate ? w.createdAt.toDate().toLocaleDateString() : '---';

    table.innerHTML += `
        <tr class="hover:bg-slate-50 transition border-b border-gray-50 last:border-0 fade-in group">
            <td class="px-8 py-6">
                <p class="text-xs font-bold text-brand-black">${dateStr}</p>
                <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">#${w.orderId ? w.orderId.slice(0,6) : '---'}</p>
            </td>
            <td class="px-8 py-6">
                <p class="text-xs font-black uppercase text-brand-black">${w.userName || 'Cliente'}</p>
                <p class="text-[9px] text-gray-400 font-bold">${w.userEmail || ''}</p>
            </td>
            <td class="px-8 py-6">
                <div class="flex items-center gap-2">
                    <img src="${w.productImage || 'https://placehold.co/50'}" class="w-8 h-8 rounded-md object-contain bg-white border border-gray-100">
                    <div>
                        <p class="text-xs font-bold text-brand-black uppercase truncate max-w-[120px]" title="${w.productName}">${w.productName}</p>
                        <p class="text-[9px] font-mono text-brand-cyan font-bold">${w.snProvided}</p>
                    </div>
                </div>
            </td>
            <td class="px-8 py-6 max-w-xs">
                <p class="text-xs text-gray-600 italic line-clamp-1" title="${w.reason}">${w.reason}</p>
            </td>
            <td class="px-8 py-6 text-center">${statusBadge}</td>
            <td class="px-8 py-6 text-center">${actionBtn}</td>
        </tr>
    `;
}

// --- 2. FUNCIONES AUXILIARES (PDF y WhatsApp) ---
async function uploadPDF(warrantyId) {
    const fileInput = document.getElementById('m-tech-report');
    if (!fileInput || fileInput.files.length === 0) return null;

    const file = fileInput.files[0];
    const storageRef = ref(storage, `warranty_reports/${warrantyId}_${Date.now()}.pdf`);
    
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
}

// --- 3. ABRIR MODAL DE GESTIÓN ---
window.openManageModal = async (id) => {
    // ⚠️ CRÍTICO: Aunque la lista viene de RAM, para aprobar/rechazar pedimos el doc fresco a Firebase
    // para asegurar que no chocamos con otro admin aprobando la misma garantía al tiempo.
    const snap = await getDoc(doc(db, "warranties", id));
    if(!snap.exists()) return;
    
    currentWarranty = { id: snap.id, ...snap.data() };
    const w = currentWarranty;

    document.getElementById('m-id').textContent = w.id;
    document.getElementById('m-prod-img').src = w.productImage || 'https://placehold.co/100';
    document.getElementById('m-prod-name').textContent = w.productName;
    document.getElementById('m-sn').textContent = w.snProvided;
    
    document.getElementById('m-user-name').textContent = w.userName || 'Cliente';
    document.getElementById('m-user-email').textContent = w.userEmail || '';
    document.getElementById('m-order-id').textContent = `ORDEN: #${w.orderId ? w.orderId.slice(0,8) : 'NA'}`;
    document.getElementById('m-reason').textContent = `"${w.reason}"`;

    // WhatsApp
    const phoneEl = document.getElementById('m-user-phone');
    const waLink = document.getElementById('m-whatsapp-link');
    phoneEl.textContent = "Buscando...";
    waLink.classList.add('hidden');

    try {
        if (w.userId) {
            const userSnap = await getDoc(doc(db, "users", w.userId));
            if (userSnap.exists()) {
                const phone = userSnap.data().phone || "";
                if (phone) {
                    phoneEl.textContent = phone;
                    let cleanPhone = phone.replace(/\D/g, '');
                    if(cleanPhone.length === 10) cleanPhone = '57' + cleanPhone; 
                    waLink.href = `https://wa.me/${cleanPhone}?text=Hola ${w.userName ? w.userName.split(' ')[0] : 'Cliente'}, te contactamos de PixelTech respecto a tu garantía #${w.id.slice(0,6)}`;
                    waLink.classList.remove('hidden');
                } else {
                    phoneEl.textContent = "Sin teléfono registrado";
                }
            } else {
                phoneEl.textContent = "Perfil no encontrado";
            }
        }
    } catch (err) { console.error(err); }

    document.getElementById('m-received').value = w.receivedItems || "";
    document.getElementById('m-admin-notes').value = w.adminResponse || "";
    document.getElementById('m-tech-report').value = ""; 

    const evidenceContainer = document.getElementById('m-evidence-container');
    evidenceContainer.innerHTML = "";
    if (w.evidenceImages && w.evidenceImages.length > 0) {
        w.evidenceImages.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = "w-full h-24 object-cover rounded-xl border border-gray-200 cursor-zoom-in hover:scale-105 transition";
            img.onclick = () => window.open(url, '_blank');
            evidenceContainer.appendChild(img);
        });
    } else {
        evidenceContainer.innerHTML = `<p class="text-xs text-gray-400 col-span-3 text-center py-4 italic">El usuario no adjuntó imágenes.</p>`;
    }

    const btnApprove = document.querySelector('button[onclick="approveWarranty()"]');
    const btnReject = document.querySelector('button[onclick="rejectWarranty()"]');
    
    const inputs = [
        document.getElementById('m-received'), 
        document.getElementById('m-admin-notes'),
        document.getElementById('m-tech-report') 
    ];

    if (w.status !== 'PENDIENTE_REVISION' && w.status !== 'PENDIENTE') {
        btnApprove.classList.add('hidden');
        btnReject.classList.add('hidden');
        inputs.forEach(i => { i.disabled = true; i.classList.add('bg-gray-100', 'cursor-not-allowed'); });

        let linkLabel = document.getElementById('admin-pdf-link-preview');
        if(w.technicalReportUrl) {
            if(!linkLabel) {
                linkLabel = document.createElement('a');
                linkLabel.id = 'admin-pdf-link-preview';
                linkLabel.target = '_blank';
                linkLabel.className = "text-[10px] font-bold text-brand-cyan hover:underline mt-1 block";
                document.getElementById('m-tech-report').parentNode.appendChild(linkLabel);
            }
            linkLabel.href = w.technicalReportUrl;
            linkLabel.textContent = "Ver informe adjunto actual";
            linkLabel.classList.remove('hidden');
        } else if (linkLabel) {
            linkLabel.classList.add('hidden');
        }
    } else {
        btnApprove.classList.remove('hidden');
        btnReject.classList.remove('hidden');
        inputs.forEach(i => { i.disabled = false; i.classList.remove('bg-gray-100', 'cursor-not-allowed'); });
        const linkLabel = document.getElementById('admin-pdf-link-preview');
        if(linkLabel) linkLabel.classList.add('hidden');
    }

    manageModal.classList.remove('hidden');
};

window.closeManageModal = () => {
    manageModal.classList.add('hidden');
    currentWarranty = null;
};

// --- 4. APROBAR Y RECHAZAR (Lógica Transaccional) ---

window.approveWarranty = () => {
    const received = document.getElementById('m-received').value.trim();
    if(!received) return alert("⚠️ Debes listar los componentes físicos recibidos antes de aprobar.");
    currentWarranty._tempReceived = received;
    currentWarranty._tempNotes = document.getElementById('m-admin-notes').value.trim();
    resolutionModal.classList.remove('hidden');
};

window.confirmResolution = async () => {
    const btn = document.querySelector('button[onclick="confirmResolution()"]');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    const resolutionType = document.querySelector('input[name="res-type"]:checked').value;
    const received = currentWarranty._tempReceived;
    const notes = currentWarranty._tempNotes;

    try {
        const pdfUrl = await uploadPDF(currentWarranty.id);

        await runTransaction(db, async (transaction) => {
            if (resolutionType === 'REPLACEMENT') {
                if (!currentWarranty.productId) throw "Error: No hay ID de producto.";
                const prodRef = doc(db, "products", currentWarranty.productId);
                const prodSnap = await transaction.get(prodRef);
                if (!prodSnap.exists()) throw "Producto no existe.";
                const currentStock = prodSnap.data().stock || 0;
                if (currentStock < 1) throw "⛔ No hay stock disponible para reemplazo.";
                transaction.update(prodRef, { stock: currentStock - 1, updatedAt: new Date() }); // 🔥 updatedAt para el Store
            }

            const warrantyRef = doc(db, "warranties", currentWarranty.id);
            transaction.update(warrantyRef, {
                status: 'APROBADO',
                resolutionType: resolutionType,
                receivedItems: received,
                adminResponse: notes || "Garantía aprobada.",
                technicalReportUrl: pdfUrl || null,
                resolvedAt: new Date(),
                updatedAt: new Date() // 🔥 updatedAt para el Store
            });

            const rmaRef = doc(collection(db, "warranty_inventory"));
            transaction.set(rmaRef, {
                warrantyId: currentWarranty.id,
                productId: currentWarranty.productId || 'unknown',
                productName: currentWarranty.productName,
                sn: currentWarranty.snProvided,
                componentsReceived: received,
                notes: `Resolución: ${resolutionType}. ${notes}`,
                status: 'EN_REVISION_TECNICA',
                entryDate: new Date()
            });
        });

        alert("✅ Garantía procesada.");
        resolutionModal.classList.add('hidden');
        closeManageModal();
        
    } catch (e) {
        console.error(e);
        alert("Error: " + e);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
};

window.rejectWarranty = async () => {
    const notes = document.getElementById('m-admin-notes').value.trim();
    if(!notes) return alert("⚠️ Escribe la razón del rechazo.");

    if(!confirm("¿Rechazar garantía?")) return;

    const btn = document.querySelector('button[onclick="rejectWarranty()"]');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Subiendo...';

    try {
        const pdfUrl = await uploadPDF(currentWarranty.id);
        await updateDoc(doc(db, "warranties", currentWarranty.id), {
            status: 'RECHAZADO',
            adminResponse: notes,
            technicalReportUrl: pdfUrl || null,
            resolvedAt: new Date(),
            updatedAt: new Date() // 🔥 updatedAt para el Store
        });

        alert("⛔ Garantía Rechazada.");
        closeManageModal();
        
    } catch (e) { 
        console.error(e); 
        alert("Error: " + e.message); 
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
};