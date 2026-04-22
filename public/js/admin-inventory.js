import { db, doc, updateDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL

loadAdminSidebar();

// --- DOM ---
const tableBody = document.getElementById('products-table-body');
const searchInput = document.getElementById('inventory-search');
const searchForm = document.getElementById('search-form');
const noResultsMsg = document.getElementById('no-results');
const rangeSpan = document.getElementById('view-range');
const totalSpan = document.getElementById('total-count');
const btnNext = document.getElementById('btn-next-page');
const btnPrev = document.getElementById('btn-prev-page');

// --- MODAL DOM ---
const discountModal = document.getElementById('discount-modal');
const discountForm = document.getElementById('discount-form');
const dInputDays = document.getElementById('input-days-container');
const dInputDate = document.getElementById('input-date-container');
const btnTypeDays = document.getElementById('btn-type-days');
const btnTypeDate = document.getElementById('btn-type-date');
const dNewPriceInput = document.getElementById('d-new-price');

// --- ESTADO ---
const PAGE_SIZE = 20;
let currentPage = 1;
let totalDocs = 0;
let currentFilterType = 'all'; 
let currentEditingId = null;
let currentEditingProduct = null; 
let currentDurationType = 'days';
let adminProductsCache = []; // Aquí vivirá la copia de los datos

const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
const formatCurrency = (val) => (val === "" || val == null) ? "" : "$ " + Number(val).toLocaleString("es-CO");
const parseCurrency = (val) => Number(val.toString().replace(/[^0-9]/g, '')) || 0;
const formatDateForInput = (timestamp) => {
    if (!timestamp) return "";
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const tzOffset = d.getTimezoneOffset() * 60000; 
    return (new Date(d - tzOffset)).toISOString().slice(0, 16);
};

if (dNewPriceInput) {
    dNewPriceInput.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = val > 0 ? formatCurrency(val) : "";
    });
    dNewPriceInput.addEventListener('focus', (e) => e.target.select());
}

// =============================================================================
// 🔥 INICIALIZACIÓN CON EL STORE CENTRALIZADO
// =============================================================================

// Nos suscribimos al cerebro central. Cada vez que haya un cambio, nos enviará el array actualizado.
AdminStore.subscribeToProducts((productsArray) => {
    adminProductsCache = productsArray;
    renderViewFromMemory();
});

// =============================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN 100% EN RAM
// =============================================================================

function renderViewFromMemory() {
    if (!tableBody) return;
    
    let filtered = [];
    const rawSearch = searchInput.value.trim();

    if (rawSearch.length > 0) {
        const term = normalizeText(rawSearch);
        filtered = adminProductsCache.filter(p => p.searchStr && p.searchStr.includes(term));
    } else {
        if (currentFilterType === 'active') filtered = adminProductsCache.filter(p => p.status === 'active');
        else if (currentFilterType === 'draft') filtered = adminProductsCache.filter(p => p.status !== 'active');
        else if (currentFilterType === 'lowstock') {
            filtered = adminProductsCache.filter(p => (p.stock || 0) <= 5);
            filtered.sort((a,b) => (a.stock || 0) - (b.stock || 0));
        } 
        else filtered = [...adminProductsCache];
    }

    totalDocs = filtered.length;
    const totalPages = Math.ceil(totalDocs / PAGE_SIZE);
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;
    const pageProducts = filtered.slice(startIdx, endIdx);

    tableBody.innerHTML = "";

    if (pageProducts.length === 0) {
        tableBody.classList.add('hidden');
        if(noResultsMsg) noResultsMsg.classList.remove('hidden');
        updatePaginationUI(0, 0);
        return;
    }
    
    tableBody.classList.remove('hidden');
    if(noResultsMsg) noResultsMsg.classList.add('hidden');

    pageProducts.forEach((product, index) => renderRowHTML(product, index));
    updatePaginationUI(startIdx + 1, Math.min(endIdx, totalDocs));
}

function updatePaginationUI(start, end) {
    if(rangeSpan) rangeSpan.textContent = totalDocs > 0 ? `${start}-${end}` : "0-0";
    if(totalSpan) totalSpan.textContent = totalDocs;
    if(btnPrev) btnPrev.disabled = currentPage === 1;
    if(btnNext) btnNext.disabled = (currentPage * PAGE_SIZE) >= totalDocs;
}

window.changePage = (dir) => {
    currentPage += dir;
    renderViewFromMemory();
    document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterByTab = (status) => {
    currentFilterType = status;
    currentPage = 1;
    if(searchInput) searchInput.value = "";

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent', 'active');
        btn.classList.add('bg-white', 'text-gray-400', 'border-gray-100');
    });
    
    const activeBtn = document.getElementById(`tab-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-400', 'border-gray-100');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-lg', 'border-transparent', 'active');
    }
    
    renderViewFromMemory();
};

let debounceTimeout = null;
if(searchInput) {
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => { currentPage = 1; renderViewFromMemory(); }, 200);
    });
}
if(searchForm) {
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault(); clearTimeout(debounceTimeout); currentPage = 1; renderViewFromMemory();
    });
}

// =============================================================================
// 🔥 RENDERIZADO VISUAL
// =============================================================================

function renderRowHTML(product, index) {
    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition-colors group fade-in border-b border-gray-50 last:border-0";
    row.style.animationDelay = `${index * 15}ms`;

    const img = product.mainImage || product.image || (product.images ? product.images[0] : 'https://placehold.co/100?text=Sin+Foto');
    const isActive = product.status === 'active';
    
    let statusBadge = isActive 
        ? `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100"><div class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.4)]"></div> Activo</span>`
        : `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-100"><div class="w-2 h-2 rounded-full bg-amber-500"></div> Borrador</span>`;
    
    let priceDisplay = `<span class="text-base font-black text-gray-800">$${(product.price || 0).toLocaleString('es-CO')}</span>`;
    if (product.originalPrice && product.price < product.originalPrice) {
        const discountPercent = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
        statusBadge += `<span class="ml-2 px-2 py-1 rounded-md text-[9px] font-black uppercase bg-purple-50 text-purple-600 border border-purple-100" title="Oferta activa">-${discountPercent}%</span>`;
        priceDisplay = `<div class="flex flex-col"><span class="text-[10px] text-gray-300 line-through font-bold">$${product.originalPrice.toLocaleString('es-CO')}</span><span class="text-base font-black text-brand-red">$${product.price.toLocaleString('es-CO')}</span></div>`;
    }

    const toggleIcon = isActive ? 'fa-eye-slash' : 'fa-eye';
    const toggleColor = isActive ? 'hover:text-amber-500 hover:border-amber-500' : 'hover:text-emerald-500 hover:border-emerald-500';

    row.innerHTML = `
        <td class="p-6 pl-8 text-center align-middle">
            <div class="w-20 h-20 rounded-2xl bg-white border border-gray-100 p-2 shadow-sm mx-auto group-hover:scale-105 transition-transform duration-300 ${!isActive ? 'opacity-50 grayscale' : ''}">
                <img src="${img}" loading="lazy" class="w-full h-full object-contain rounded-lg">
            </div>
        </td>
        <td class="p-6 align-middle">
            <p class="font-black text-brand-black text-sm mb-1 leading-tight group-hover:text-brand-cyan transition-colors cursor-pointer" onclick="window.location.href='edit-product.html?id=${product.id}'">${product.name}</p>
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">SKU: ${product.sku || '---'}</p>
        </td>
        <td class="p-6 align-middle">
            <span class="text-[10px] font-bold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100 uppercase tracking-wide">${product.category || 'General'}</span>
        </td>
        <td class="p-6 align-middle">
            <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">${product.brand || '---'}</p>
        </td>
        <td class="p-6 align-middle">
            <div class="flex flex-col gap-1">
                ${priceDisplay}
                <p class="text-[10px] font-bold uppercase ${ (product.stock || 0) < 5 ? 'text-red-400' : 'text-emerald-500' } flex items-center gap-1">
                    <i class="fa-solid fa-layer-group"></i> ${product.stock || 0} unid.
                </p>
            </div>
        </td>
        <td class="p-6 text-center align-middle">
            <div class="flex flex-col items-center justify-center gap-2">${statusBadge}</div>
        </td>
        <td class="p-6 pr-8 text-right align-middle">
            <div class="flex items-center justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                <button onclick="openDiscountModal('${product.id}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-500 transition shadow-sm flex items-center justify-center hover:-translate-y-1"><i class="fa-solid fa-tags"></i></button>
                <button onclick="window.location.href='edit-product.html?id=${product.id}'" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm flex items-center justify-center hover:-translate-y-1"><i class="fa-solid fa-pen"></i></button>
                <button onclick="toggleProductStatus('${product.id}', '${product.status}')" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-400 ${toggleColor} transition shadow-sm flex items-center justify-center hover:-translate-y-1">
                    <i class="fa-solid ${toggleIcon}"></i>
                </button>
            </div>
        </td>
    `;
    tableBody.appendChild(row);
}

// =============================================================================
// 🔥 ACCIONES (OCULTAR Y DESCUENTOS)
// =============================================================================

window.toggleProductStatus = async (id, currentStatus) => {
    const isActivating = currentStatus !== 'active';
    const newStatus = isActivating ? 'active' : 'draft';
    
    if (confirm(`¿Deseas ${isActivating ? 'publicar' : 'ocultar'} este producto?`)) {
        try {
            await updateDoc(doc(db, "products", id), { status: newStatus, updatedAt: new Date() });
        } catch (error) { alert("Error al cambiar estado."); }
    }
};

window.openDiscountModal = async (id) => {
    try {
        const product = adminProductsCache.find(p => p.id === id);
        if(!product) return;
        
        currentEditingProduct = product; currentEditingId = id;
        document.getElementById('d-prod-name').textContent = product.name;
        document.getElementById('d-original-price').value = formatCurrency(product.originalPrice || product.price);
        
        const btnRemove = document.getElementById('btn-remove-discount');
        if (product.originalPrice && product.originalPrice > product.price) btnRemove.classList.remove('hidden');
        else btnRemove.classList.add('hidden');

        if (product.promoEndsAt) {
            document.getElementById('d-duration-date').value = formatDateForInput(product.promoEndsAt);
            document.getElementById('d-duration-days').value = "";
            toggleDurationType('date');
        } else {
            document.getElementById('d-duration-date').value = "";
            document.getElementById('d-duration-days').value = "";
            toggleDurationType('days');
        }

        const singlePriceContainer = document.getElementById('single-price-container');
        const variantsContainer = document.getElementById('variants-discount-container');
        
        if (product.combinations && product.combinations.length > 0) {
            singlePriceContainer.classList.add('hidden'); variantsContainer.classList.remove('hidden'); dNewPriceInput.required = false;

            let html = '<p class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-2 mb-2">Ajusta el precio por variante</p>';
            product.combinations.forEach((c, index) => {
                const label = `${c.color || ''} ${c.capacity ? '- ' + c.capacity : ''}`.trim();
                const cCurrent = (c.originalPrice && c.originalPrice > c.price) ? c.price : "";
                html += `
                    <div class="flex justify-between items-center gap-3 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <div class="w-1/2 overflow-hidden"><p class="text-[10px] font-black text-brand-black truncate" title="${label}">${label}</p><p class="text-[9px] text-gray-400 font-bold">Antes: <span class="line-through decoration-red-300">${formatCurrency(c.originalPrice || c.price)}</span></p></div>
                        <div class="w-1/2"><input type="text" class="var-discount-input w-full bg-slate-50 border border-gray-200 rounded-md p-2 text-xs font-bold text-brand-cyan outline-none focus:border-brand-cyan focus:bg-white transition" data-index="${index}" value="${formatCurrency(cCurrent)}" placeholder="$ 0"></div>
                    </div>`;
            });
            variantsContainer.innerHTML = html;

            variantsContainer.querySelectorAll('.var-discount-input').forEach(inp => {
                inp.addEventListener('input', (e) => { const val = parseCurrency(e.target.value); e.target.value = val > 0 ? formatCurrency(val) : ""; });
                inp.addEventListener('focus', (e) => e.target.select());
            });
        } else {
            singlePriceContainer.classList.remove('hidden'); variantsContainer.classList.add('hidden'); variantsContainer.innerHTML = ""; dNewPriceInput.required = true;
            dNewPriceInput.value = (product.originalPrice && product.originalPrice > product.price) ? formatCurrency(product.price) : "";
        }

        discountModal.classList.remove('hidden'); discountModal.classList.add('flex');
    } catch(e) { console.error(e); }
};

window.closeDiscountModal = () => {
    discountModal.classList.add('hidden'); discountModal.classList.remove('flex');
    currentEditingId = null; currentEditingProduct = null;
};

window.toggleDurationType = (type) => {
    currentDurationType = type;
    if (type === 'days') {
        dInputDays.classList.remove('hidden'); dInputDate.classList.add('hidden');
        btnTypeDays.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); btnTypeDays.classList.remove('text-gray-400');
        btnTypeDate.classList.add('text-gray-400'); btnTypeDate.classList.remove('bg-white', 'shadow-sm', 'text-brand-black');
    } else {
        dInputDays.classList.add('hidden'); dInputDate.classList.remove('hidden');
        btnTypeDate.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); btnTypeDate.classList.remove('text-gray-400');
        btnTypeDays.classList.add('text-gray-400'); btnTypeDays.classList.remove('bg-white', 'shadow-sm', 'text-brand-black');
    }
};

if(discountForm) {
    discountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = discountForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

        try {
            const product = currentEditingProduct;
            let minPrice = Infinity;
            let rootOriginalPrice = product.originalPrice || product.price;
            let updatedCombinations = product.combinations || [];
            let updatedCapacities = product.capacities || [];

            if (updatedCombinations.length > 0) {
                document.querySelectorAll('.var-discount-input').forEach(inp => {
                    const idx = inp.dataset.index; const newPriceRaw = parseCurrency(inp.value); const comb = updatedCombinations[idx];
                    if (!comb.originalPrice) comb.originalPrice = comb.price;
                    comb.price = (newPriceRaw > 0 && newPriceRaw < comb.originalPrice) ? newPriceRaw : comb.originalPrice;
                    if (comb.price < minPrice) minPrice = comb.price;
                });
                updatedCapacities = updatedCapacities.map(cap => {
                    const matchingComb = updatedCombinations.find(c => c.capacity === cap.label);
                    return (matchingComb && matchingComb.price < (cap.originalPrice || cap.price)) ? { ...cap, originalPrice: cap.originalPrice || cap.price, price: matchingComb.price } : cap;
                });
            } else {
                const newPriceRaw = parseCurrency(dNewPriceInput.value);
                if (newPriceRaw <= 0 || newPriceRaw >= rootOriginalPrice) throw new Error("Precio inválido.");
                minPrice = newPriceRaw;
            }

            let endDate = new Date();
            if (currentDurationType === 'days') {
                const days = parseInt(document.getElementById('d-duration-days').value);
                if (!days) throw new Error("Ingresa días."); endDate.setDate(endDate.getDate() + days);
            } else {
                const dateVal = document.getElementById('d-duration-date').value;
                if (!dateVal) throw new Error("Selecciona fecha."); endDate = new Date(dateVal);
            }

            await updateDoc(doc(db, "products", currentEditingId), { originalPrice: rootOriginalPrice, price: minPrice, promoEndsAt: endDate, updatedAt: new Date(), combinations: updatedCombinations, capacities: updatedCapacities });
            alert("✅ Oferta aplicada."); closeDiscountModal();
        } catch (e) { alert("Error: " + e.message); } finally { btn.disabled = false; btn.innerHTML = originalText; }
    });
}

window.removeDiscount = async () => {
    if (!confirm("¿Restaurar precios originales?")) return;
    try {
        const product = currentEditingProduct;
        if (!product.originalPrice) return;

        let updatedCombinations = (product.combinations || []).map(c => ({ ...c, price: c.originalPrice || c.price, originalPrice: 0 }));
        let updatedCapacities = (product.capacities || []).map(c => ({ ...c, price: c.originalPrice || c.price, originalPrice: 0 }));

        await updateDoc(doc(db, "products", currentEditingId), { price: product.originalPrice, originalPrice: 0, promoEndsAt: null, updatedAt: new Date(), combinations: updatedCombinations, capacities: updatedCapacities });
        alert("✅ Oferta removida."); closeDiscountModal();
    } catch (e) { console.error(e); }
};