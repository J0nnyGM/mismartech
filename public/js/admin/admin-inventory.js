// public/js/admin/admin-inventory.js
import { db, doc, updateDoc, writeBatch, collection, onSnapshot } from '../firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';

loadAdminSidebar();

// --- DOM PRINCIPAL ---
const tableBody = document.getElementById('products-table-body');
const searchInput = document.getElementById('inventory-search');
const searchForm = document.getElementById('search-form');
const btnClearSearch = document.getElementById('btn-clear-search');
const filterTypeSelect = document.getElementById('filter-type');
const sortBySelect = document.getElementById('sort-by');
const pageSizeSelect = document.getElementById('page-size-select');
const btnResetFilters = document.getElementById('btn-reset-filters');
const noResultsMsg = document.getElementById('no-results');
const rangeSpan = document.getElementById('view-range');
const totalSpan = document.getElementById('total-count');
const btnNext = document.getElementById('btn-next-page');
const btnPrev = document.getElementById('btn-prev-page');

// --- MODAL DESCUENTO DOM ---
const discountModal = document.getElementById('discount-modal');
const discountForm = document.getElementById('discount-form');
const dInputDays = document.getElementById('input-days-container');
const dInputDate = document.getElementById('input-date-container');
const btnTypeDays = document.getElementById('btn-type-days');
const btnTypeDate = document.getElementById('btn-type-date');
const dNewPriceInput = document.getElementById('d-new-price');

// --- ESTADO GENERAL ---
let PAGE_SIZE = 20;
let currentPage = 1;
let totalDocs = 0;
let currentFilterType = 'all'; // 'all', 'active', 'draft', 'lowstock', 'out_of_stock', 'discount'
let currentCategory = 'all';
let currentSubcategory = 'all';
let currentBrand = 'all';
let currentProductType = 'all'; // 'all', 'with_variants', 'simple', 'no_image'
let currentSort = 'recent'; // 'recent', 'name_asc', 'name_desc', 'stock_asc', 'stock_desc', 'price_desc', 'price_asc'

let currentEditingId = null;
let currentEditingProduct = null;
let currentDurationType = 'days';

let adminProductsCache = [];
let availableCategories = [];
let availableSubcategories = [];
let availableBrands = [];
let categorySubcategoryMap = {};

const CATEGORIES_STORAGE_KEY = 'mismartech_categories_smart_admin';

// --- UTILIDADES ---
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
const formatCurrency = (val) => (val === "" || val == null) ? "" : "$ " + Number(val).toLocaleString("es-CO");
const parseCurrency = (val) => Number(val.toString().replace(/[^0-9]/g, '')) || 0;

const formatDateForInput = (timestamp) => {
    if (!timestamp) return "";
    let d;
    if (typeof timestamp.toDate === 'function') {
        d = timestamp.toDate();
    } else if (timestamp && typeof timestamp.seconds === 'number') {
        d = new Date(timestamp.seconds * 1000);
    } else {
        d = new Date(timestamp);
    }
    if (isNaN(d.getTime())) return "";
    const tzOffset = d.getTimezoneOffset() * 60000;
    return (new Date(d - tzOffset)).toISOString().slice(0, 16);
};

const getRealStock = (product) => {
    if (product.combinations && product.combinations.length > 0) {
        return product.combinations.reduce((sum, c) => sum + (parseInt(c.stock) || 0), 0);
    }
    return parseInt(product.stock) || 0;
};

if (dNewPriceInput) {
    dNewPriceInput.addEventListener('input', (e) => {
        const val = parseCurrency(e.target.value);
        e.target.value = val > 0 ? formatCurrency(val) : "";
    });
    dNewPriceInput.addEventListener('focus', (e) => e.target.select());
}

// =============================================================================
// 🗂️ GESTIÓN REACTIVA DE CATEGORÍAS, SUBCATEGORÍAS Y MARCAS
// =============================================================================

function loadCategoriesFromLocal() {
    try {
        const raw = localStorage.getItem(CATEGORIES_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                processCategoriesData(parsed);
            }
        }
    } catch (e) {
        console.warn("Error leyendo categorías locales:", e);
    }
}

function processCategoriesData(categoriesList) {
    categorySubcategoryMap = {};
    const catSet = new Set();
    const subSet = new Set();
    const brandSet = new Set();

    categoriesList.forEach(c => {
        if (!c || !c.name) return;
        const cName = c.name.trim();
        catSet.add(cName);
        if (!categorySubcategoryMap[cName]) categorySubcategoryMap[cName] = new Set();

        if (Array.isArray(c.subcategories)) {
            c.subcategories.forEach(sub => {
                const sName = typeof sub === 'string' ? sub.trim() : (sub?.name ? sub.name.trim() : '');
                if (sName) {
                    categorySubcategoryMap[cName].add(sName);
                    subSet.add(sName);
                }
            });
        }
    });

    // Mapear también marcas, categorías y subcategorías presentes en el catálogo cargado
    adminProductsCache.forEach(p => {
        if (p.category && p.category.trim()) {
            const cName = p.category.trim();
            catSet.add(cName);
            if (!categorySubcategoryMap[cName]) categorySubcategoryMap[cName] = new Set();
            if (p.subcategory && p.subcategory.trim()) {
                const sName = p.subcategory.trim();
                categorySubcategoryMap[cName].add(sName);
                subSet.add(sName);
            }
        }
        if (p.brand && p.brand.trim()) {
            brandSet.add(p.brand.trim());
        }
    });

    availableCategories = Array.from(catSet).sort((a, b) => a.localeCompare(b));
    availableBrands = Array.from(brandSet).sort((a, b) => a.localeCompare(b));

    populateCategoryDropdown();
    populateSubcategoryDropdown();
    populateBrandDropdown();
}

function populateCategoryDropdown(filterText = '') {
    const container = document.getElementById('options-dropdown-category');
    if (!container) return;

    const normFilter = normalizeText(filterText);
    const filteredCats = availableCategories.filter(cat => normalizeText(cat).includes(normFilter));

    let html = `
        <button type="button" onclick="window.selectFilterOption('category', 'all')" 
            class="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-all ${currentCategory === 'all' ? 'bg-brand-orange text-white font-black' : 'hover:bg-slate-100 text-gray-700 font-bold'}">
            <span>Todas las categorías</span>
            ${currentCategory === 'all' ? '<i class="fa-solid fa-check text-xs"></i>' : ''}
        </button>
    `;

    filteredCats.forEach(cat => {
        const isSelected = currentCategory.toLowerCase() === cat.toLowerCase();
        const count = adminProductsCache.filter(p => normalizeText(p.category) === normalizeText(cat)).length;
        html += `
            <button type="button" onclick="window.selectFilterOption('category', '${cat.replace(/'/g, "\\'")}')" 
                class="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-all ${isSelected ? 'bg-brand-orange text-white font-black' : 'hover:bg-slate-100 text-gray-700 font-bold'}">
                <span class="truncate pr-2">${cat}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}">${count}</span>
            </button>
        `;
    });

    if (filteredCats.length === 0 && normFilter.length > 0) {
        html += `<p class="text-center py-4 text-xs text-gray-400 font-bold">Sin coincidencias</p>`;
    }

    container.innerHTML = html;
}

function populateSubcategoryDropdown(filterText = '') {
    const container = document.getElementById('options-dropdown-subcategory');
    if (!container) return;

    let subList = [];
    if (currentCategory !== 'all') {
        const catObjKey = Object.keys(categorySubcategoryMap).find(k => normalizeText(k) === normalizeText(currentCategory));
        if (catObjKey && categorySubcategoryMap[catObjKey]) {
            subList = Array.from(categorySubcategoryMap[catObjKey]);
        }
    } else {
        const allSubs = new Set();
        Object.values(categorySubcategoryMap).forEach(subSet => {
            subSet.forEach(s => allSubs.add(s));
        });
        subList = Array.from(allSubs);
    }
    subList.sort((a, b) => a.localeCompare(b));

    const normFilter = normalizeText(filterText);
    const filteredSubs = subList.filter(sub => normalizeText(sub).includes(normFilter));

    let html = `
        <button type="button" onclick="window.selectFilterOption('subcategory', 'all')" 
            class="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-all ${currentSubcategory === 'all' ? 'bg-brand-orange text-white font-black' : 'hover:bg-slate-100 text-gray-700 font-bold'}">
            <span>Todas las subcategorías</span>
            ${currentSubcategory === 'all' ? '<i class="fa-solid fa-check text-xs"></i>' : ''}
        </button>
    `;

    filteredSubs.forEach(sub => {
        const isSelected = currentSubcategory.toLowerCase() === sub.toLowerCase();
        html += `
            <button type="button" onclick="window.selectFilterOption('subcategory', '${sub.replace(/'/g, "\\'")}')" 
                class="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-all ${isSelected ? 'bg-brand-orange text-white font-black' : 'hover:bg-slate-100 text-gray-700 font-bold'}">
                <span class="truncate pr-2">${sub}</span>
                ${isSelected ? '<i class="fa-solid fa-check text-xs"></i>' : ''}
            </button>
        `;
    });

    if (filteredSubs.length === 0 && subList.length === 0) {
        html += `<p class="text-center py-4 text-xs text-gray-400 font-bold">No hay subcategorías</p>`;
    } else if (filteredSubs.length === 0 && normFilter.length > 0) {
        html += `<p class="text-center py-4 text-xs text-gray-400 font-bold">Sin coincidencias</p>`;
    }

    container.innerHTML = html;
}

function populateBrandDropdown(filterText = '') {
    const container = document.getElementById('options-dropdown-brand');
    if (!container) return;

    const normFilter = normalizeText(filterText);
    const filteredBrands = availableBrands.filter(b => normalizeText(b).includes(normFilter));

    let html = `
        <button type="button" onclick="window.selectFilterOption('brand', 'all')" 
            class="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-all ${currentBrand === 'all' ? 'bg-brand-orange text-white font-black' : 'hover:bg-slate-100 text-gray-700 font-bold'}">
            <span>Todas las marcas</span>
            ${currentBrand === 'all' ? '<i class="fa-solid fa-check text-xs"></i>' : ''}
        </button>
    `;

    filteredBrands.forEach(b => {
        const isSelected = currentBrand.toLowerCase() === b.toLowerCase();
        const count = adminProductsCache.filter(p => normalizeText(p.brand) === normalizeText(b)).length;
        html += `
            <button type="button" onclick="window.selectFilterOption('brand', '${b.replace(/'/g, "\\'")}')" 
                class="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-all ${isSelected ? 'bg-brand-orange text-white font-black' : 'hover:bg-slate-100 text-gray-700 font-bold'}">
                <span class="truncate pr-2">${b}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}">${count}</span>
            </button>
        `;
    });

    if (filteredBrands.length === 0 && normFilter.length > 0) {
        html += `<p class="text-center py-4 text-xs text-gray-400 font-bold">Sin coincidencias</p>`;
    }

    container.innerHTML = html;
}

// =============================================================================
// ⚡ MANIPULACIÓN DE MENÚS DESPLEGABLES INTERACTIVOS
// =============================================================================

window.toggleFilterDropdown = (type) => {
    const panel = document.getElementById(`panel-dropdown-${type}`);
    const arrow = document.getElementById(`arrow-dropdown-${type}`);
    const search = document.getElementById(`search-dropdown-${type}`);

    // Cerrar los otros
    ['category', 'subcategory', 'brand'].forEach(t => {
        if (t !== type) {
            const otherPanel = document.getElementById(`panel-dropdown-${t}`);
            const otherArrow = document.getElementById(`arrow-dropdown-${t}`);
            if (otherPanel) otherPanel.classList.add('hidden');
            if (otherArrow) otherArrow.classList.remove('rotate-180');
        }
    });

    if (panel) {
        const isClosed = panel.classList.contains('hidden');
        if (isClosed) {
            panel.classList.remove('hidden');
            if (arrow) arrow.classList.add('rotate-180');
            if (search) {
                search.value = '';
                setTimeout(() => search.focus(), 50);
            }
            if (type === 'category') populateCategoryDropdown();
            if (type === 'subcategory') populateSubcategoryDropdown();
            if (type === 'brand') populateBrandDropdown();
        } else {
            panel.classList.add('hidden');
            if (arrow) arrow.classList.remove('rotate-180');
        }
    }
};

window.filterDropdownList = (type, val) => {
    if (type === 'category') populateCategoryDropdown(val);
    else if (type === 'subcategory') populateSubcategoryDropdown(val);
    else if (type === 'brand') populateBrandDropdown(val);
};

window.selectFilterOption = (type, val) => {
    if (type === 'category') {
        currentCategory = val;
        currentSubcategory = 'all';
        const lbl = document.getElementById('selected-category-label');
        if (lbl) lbl.textContent = val === 'all' ? 'Todas' : val;
        const subLbl = document.getElementById('selected-subcategory-label');
        if (subLbl) subLbl.textContent = 'Todas';
        populateSubcategoryDropdown();
    } else if (type === 'subcategory') {
        currentSubcategory = val;
        const lbl = document.getElementById('selected-subcategory-label');
        if (lbl) lbl.textContent = val === 'all' ? 'Todas' : val;
    } else if (type === 'brand') {
        currentBrand = val;
        const lbl = document.getElementById('selected-brand-label');
        if (lbl) lbl.textContent = val === 'all' ? 'Todas' : val;
    }

    const panel = document.getElementById(`panel-dropdown-${type}`);
    const arrow = document.getElementById(`arrow-dropdown-${type}`);
    if (panel) panel.classList.add('hidden');
    if (arrow) arrow.classList.remove('rotate-180');

    currentPage = 1;
    renderViewFromMemory();
};

// Cerrar desplegables al hacer clic afuera
document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-container')) {
        ['category', 'subcategory', 'brand'].forEach(t => {
            const panel = document.getElementById(`panel-dropdown-${t}`);
            const arrow = document.getElementById(`arrow-dropdown-${t}`);
            if (panel) panel.classList.add('hidden');
            if (arrow) arrow.classList.remove('rotate-180');
        });
    }
});

// =============================================================================
// 🔥 FILTRADO, BÚSQUEDA Y PAGINACIÓN 100% EN MEMORIA RAM
// =============================================================================

function updateResetButtonVisibility() {
    const hasSearch = searchInput && searchInput.value.trim().length > 0;
    const hasFilter = currentFilterType !== 'all' || currentCategory !== 'all' || currentSubcategory !== 'all' || currentBrand !== 'all' || currentProductType !== 'all' || currentSort !== 'recent';

    if (btnResetFilters) {
        if (hasSearch || hasFilter) btnResetFilters.classList.remove('hidden');
        else btnResetFilters.classList.add('hidden');
    }

    if (btnClearSearch && searchInput) {
        if (searchInput.value.trim().length > 0) btnClearSearch.classList.remove('hidden');
        else btnClearSearch.classList.add('hidden');
    }
}

window.resetAllFilters = () => {
    if (searchInput) searchInput.value = '';
    currentFilterType = 'all';
    currentCategory = 'all';
    currentSubcategory = 'all';
    currentBrand = 'all';
    currentProductType = 'all';
    currentSort = 'recent';
    currentPage = 1;

    const catLbl = document.getElementById('selected-category-label');
    if (catLbl) catLbl.textContent = 'Todas';
    const subLbl = document.getElementById('selected-subcategory-label');
    if (subLbl) subLbl.textContent = 'Todas';
    const brandLbl = document.getElementById('selected-brand-label');
    if (brandLbl) brandLbl.textContent = 'Todas';

    if (filterTypeSelect) filterTypeSelect.value = 'all';
    if (sortBySelect) sortBySelect.value = 'recent';

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-sm', 'border-transparent', 'active');
        btn.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });
    const activeBtn = document.getElementById('tab-all');
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-sm', 'border-transparent', 'active');
    }

    populateCategoryDropdown();
    populateSubcategoryDropdown();
    populateBrandDropdown();
    renderViewFromMemory();
};

function renderViewFromMemory() {
    if (!tableBody) return;

    let filtered = [...adminProductsCache];

    // 1. Buscador multi-término insensible a acentos
    const rawSearch = searchInput ? searchInput.value.trim() : "";
    if (rawSearch.length > 0) {
        const terms = normalizeText(rawSearch).split(/\s+/).filter(Boolean);
        filtered = filtered.filter(p => {
            const target = p.searchStr || normalizeText(`${p.name || ''} ${p.sku || ''} ${p.brand || ''} ${p.category || ''} ${p.subcategory || ''}`);
            return terms.every(t => target.includes(t));
        });
    }

    // 2. Filtro por Pestaña Rápida (Estado)
    if (currentFilterType === 'active') {
        filtered = filtered.filter(p => p.status === 'active');
    } else if (currentFilterType === 'draft') {
        filtered = filtered.filter(p => p.status !== 'active');
    } else if (currentFilterType === 'lowstock') {
        filtered = filtered.filter(p => {
            const stock = getRealStock(p);
            return stock > 0 && stock <= 5;
        });
    } else if (currentFilterType === 'out_of_stock') {
        filtered = filtered.filter(p => getRealStock(p) === 0);
    } else if (currentFilterType === 'discount') {
        filtered = filtered.filter(p => {
            if (p.originalPrice && p.price < p.originalPrice) return true;
            if (p.combinations && p.combinations.some(c => c.originalPrice && c.price < c.originalPrice)) return true;
            return false;
        });
    }

    // 3. Filtro por Categoría
    if (currentCategory !== 'all') {
        const catNorm = normalizeText(currentCategory);
        filtered = filtered.filter(p => normalizeText(p.category) === catNorm);
    }

    // 4. Filtro por Subcategoría
    if (currentSubcategory !== 'all') {
        const subNorm = normalizeText(currentSubcategory);
        filtered = filtered.filter(p => normalizeText(p.subcategory) === subNorm);
    }

    // 5. Filtro por Marca
    if (currentBrand !== 'all') {
        const brandNorm = normalizeText(currentBrand);
        filtered = filtered.filter(p => normalizeText(p.brand) === brandNorm);
    }

    // 6. Filtro por Tipo de Producto
    if (currentProductType === 'with_variants') {
        filtered = filtered.filter(p => p.combinations && p.combinations.length > 0);
    } else if (currentProductType === 'simple') {
        filtered = filtered.filter(p => !p.combinations || p.combinations.length === 0);
    } else if (currentProductType === 'no_image') {
        filtered = filtered.filter(p => !p.mainImage && !p.image && (!p.images || p.images.length === 0));
    }

    // 7. Ordenamiento
    if (currentSort === 'name_asc') {
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (currentSort === 'name_desc') {
        filtered.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
    } else if (currentSort === 'stock_asc') {
        filtered.sort((a, b) => getRealStock(a) - getRealStock(b));
    } else if (currentSort === 'stock_desc') {
        filtered.sort((a, b) => getRealStock(b) - getRealStock(a));
    } else if (currentSort === 'price_desc') {
        filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else if (currentSort === 'price_asc') {
        filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else {
        // 'recent' -> orden por fecha más reciente
        filtered.sort((a, b) => {
            const timeA = a.updatedAt?.seconds || (a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0) || a.createdAt?.seconds || 0;
            const timeB = b.updatedAt?.seconds || (b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0) || b.createdAt?.seconds || 0;
            return timeB - timeA;
        });
    }

    updateResetButtonVisibility();

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
        if (noResultsMsg) {
            noResultsMsg.innerHTML = `
                <div class="flex flex-col items-center justify-center text-gray-400 py-12">
                    <div class="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mb-4 text-2xl text-gray-300">
                        <i class="fa-solid fa-magnifying-glass"></i>
                    </div>
                    <p class="font-black text-sm uppercase tracking-wider text-brand-black mb-1">No se encontraron productos</p>
                    <p class="text-xs text-gray-400 mb-4">Intenta ajustar los filtros de búsqueda o categoría.</p>
                    <button onclick="window.resetAllFilters()" class="text-xs font-black uppercase text-brand-orange hover:underline tracking-wider">
                        Limpiar todos los filtros
                    </button>
                </div>
            `;
            noResultsMsg.classList.remove('hidden');
        }
        updatePaginationUI(0, 0);
        return;
    }

    tableBody.classList.remove('hidden');
    if (noResultsMsg) noResultsMsg.classList.add('hidden');

    pageProducts.forEach((product, index) => renderRowHTML(product, index));
    updatePaginationUI(startIdx + 1, Math.min(endIdx, totalDocs));
}

function updatePaginationUI(start, end) {
    if (rangeSpan) rangeSpan.textContent = totalDocs > 0 ? `${start}-${end}` : "0-0";
    if (totalSpan) totalSpan.textContent = totalDocs;
    if (btnPrev) btnPrev.disabled = currentPage === 1;
    if (btnNext) btnNext.disabled = (currentPage * PAGE_SIZE) >= totalDocs;
}

window.changePage = (dir) => {
    currentPage += dir;
    renderViewFromMemory();
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterByTab = (status) => {
    currentFilterType = status;
    currentPage = 1;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-brand-black', 'text-white', 'shadow-sm', 'border-transparent', 'active');
        btn.classList.add('bg-white', 'text-gray-500', 'border-gray-200');
    });

    const activeBtn = document.getElementById(`tab-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-white', 'text-gray-500', 'border-gray-200');
        activeBtn.classList.add('bg-brand-black', 'text-white', 'shadow-sm', 'border-transparent', 'active');
    }

    renderViewFromMemory();
};

// Eventos de Filtros y Búsqueda
let debounceTimeout = null;
if (searchInput) {
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            currentPage = 1;
            renderViewFromMemory();
        }, 180);
    });
}

if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        currentPage = 1;
        renderViewFromMemory();
    });
}

if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        clearTimeout(debounceTimeout);
        currentPage = 1;
        renderViewFromMemory();
    });
}

if (filterTypeSelect) {
    filterTypeSelect.addEventListener('change', (e) => {
        currentProductType = e.target.value;
        currentPage = 1;
        renderViewFromMemory();
    });
}

if (sortBySelect) {
    sortBySelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        currentPage = 1;
        renderViewFromMemory();
    });
}

if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
        PAGE_SIZE = parseInt(e.target.value) || 20;
        currentPage = 1;
        renderViewFromMemory();
    });
}

// =============================================================================
// 🔥 RENDERIZADO VISUAL DE PRODUCTO
// =============================================================================

function renderRowHTML(product, index) {
    const userRole = sessionStorage.getItem('adminUserRole') || sessionStorage.getItem('pixeltech_user_role') || 'customer';
    const isVentas = userRole === 'ventas';

    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50 transition-colors group fade-in border-b border-gray-50 last:border-0";
    row.style.animationDelay = `${Math.min(index * 15, 300)}ms`;

    const img = product.mainImage || product.image || (product.images && product.images[0]) || 'https://placehold.co/100?text=Sin+Foto';
    const isActive = product.status === 'active';
    const realStock = getRealStock(product);
    const hasVariants = product.combinations && product.combinations.length > 0;

    let statusBadge = isActive
        ? `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-100"><div class="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.4)]"></div> Activo</span>`
        : `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-600 border border-amber-100"><div class="w-1.5 h-1.5 rounded-full bg-amber-500"></div> Borrador</span>`;

    let priceDisplay = `<span class="text-sm font-black text-brand-black">${formatCurrency(product.price || 0)}</span>`;
    if (product.originalPrice && product.price < product.originalPrice) {
        const discountPercent = Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100);
        statusBadge += `<span class="ml-1.5 px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-purple-50 text-purple-600 border border-purple-100" title="Oferta activa">-${discountPercent}%</span>`;
        priceDisplay = `
            <div class="flex flex-col">
                <span class="text-[9px] text-gray-400 line-through font-bold">${formatCurrency(product.originalPrice)}</span>
                <span class="text-sm font-black text-brand-red">${formatCurrency(product.price)}</span>
            </div>
        `;
    }

    const toggleIcon = isActive ? 'fa-eye-slash' : 'fa-eye';
    const toggleColor = isActive ? 'hover:text-amber-500 hover:border-amber-400' : 'hover:text-emerald-500 hover:border-emerald-400';

    const nameHTML = isVentas
        ? `<p class="font-black text-brand-black text-xs sm:text-sm mb-1 leading-tight">${product.name || 'Sin Nombre'}</p>`
        : `<p class="font-black text-brand-black text-xs sm:text-sm mb-1 leading-tight group-hover:text-brand-orange transition-colors cursor-pointer" onclick="window.location.href='edit-product.html?id=${product.id}'">${product.name || 'Sin Nombre'}</p>`;

    const editBtnHTML = isVentas
        ? ''
        : `<button onclick="window.location.href='edit-product.html?id=${product.id}'" title="Editar Producto" class="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-orange hover:border-brand-orange transition shadow-2xs flex items-center justify-center hover:-translate-y-0.5"><i class="fa-solid fa-pen text-xs"></i></button>`;

    const subcategoryBadge = product.subcategory
        ? `<span class="text-[9px] font-bold text-gray-400 block truncate mt-0.5" title="${product.subcategory}">${product.subcategory}</span>`
        : '';

    row.innerHTML = `
        <td class="p-4 pl-6 text-center align-middle">
            <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white border border-gray-100 p-1.5 shadow-2xs mx-auto group-hover:scale-105 transition-transform duration-300 ${!isActive ? 'opacity-50 grayscale' : ''}">
                <img src="${img}" alt="${product.name || ''}" loading="lazy" class="w-full h-full object-contain rounded-xl">
            </div>
        </td>
        <td class="p-4 align-middle">
            ${nameHTML}
            <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">SKU: ${product.sku || '---'}</span>
                ${hasVariants ? `<span class="text-[8px] font-black uppercase bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">Variantes (${product.combinations.length})</span>` : ''}
            </div>
        </td>
        <td class="p-4 align-middle">
            <span class="text-[9px] font-bold text-gray-600 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-100 uppercase tracking-wide inline-block">${product.category || 'General'}</span>
            ${subcategoryBadge}
        </td>
        <td class="p-4 align-middle">
            <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">${product.brand || '---'}</p>
        </td>
        <td class="p-4 align-middle">
            <div class="flex flex-col gap-0.5">
                ${priceDisplay}
                <p class="text-[9px] font-bold uppercase ${realStock === 0 ? 'text-gray-400' : (realStock <= 5 ? 'text-brand-red' : 'text-emerald-500')} flex items-center gap-1">
                    <i class="fa-solid fa-layer-group text-[8px]"></i> ${realStock} unid.
                </p>
            </div>
        </td>
        <td class="p-4 text-center align-middle">
            <div class="flex flex-col items-center justify-center gap-1">${statusBadge}</div>
        </td>
        <td class="p-4 pr-6 text-right align-middle">
            <div class="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                <a href="product-serials.html?productId=${product.id}" title="Control de Seriales (SN)" class="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-orange hover:border-brand-orange transition shadow-2xs flex items-center justify-center hover:-translate-y-0.5">
                    <i class="fa-solid fa-barcode text-xs"></i>
                </a>
                <button onclick="openDiscountModal('${product.id}')" title="Aplicar Descuento" class="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-300 transition shadow-2xs flex items-center justify-center hover:-translate-y-0.5">
                    <i class="fa-solid fa-tags text-xs"></i>
                </button>
                ${editBtnHTML}
                <button onclick="toggleProductStatus('${product.id}', '${product.status}')" title="${isActive ? 'Ocultar Producto' : 'Publicar Producto'}" class="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-400 ${toggleColor} transition shadow-2xs flex items-center justify-center hover:-translate-y-0.5">
                    <i class="fa-solid ${toggleIcon} text-xs"></i>
                </button>
            </div>
        </td>
    `;
    tableBody.appendChild(row);
}

// =============================================================================
// 🔥 ACCIONES (PUBLICAR / OCULTAR Y DESCUENTOS)
// =============================================================================

window.toggleProductStatus = async (id, currentStatus) => {
    const isActivating = currentStatus !== 'active';
    const newStatus = isActivating ? 'active' : 'draft';

    if (confirm(`¿Deseas ${isActivating ? 'publicar' : 'ocultar'} este producto en la tienda?`)) {
        try {
            await updateDoc(doc(db, "products", id), { status: newStatus, updatedAt: new Date() });
        } catch (error) {
            console.error("Error al cambiar estado:", error);
            alert("Error al actualizar el estado del producto.");
        }
    }
};

window.openDiscountModal = async (id) => {
    try {
        const product = adminProductsCache.find(p => p.id === id);
        if (!product) return;

        currentEditingProduct = product;
        currentEditingId = id;

        document.getElementById('d-prod-name').textContent = product.name || 'Producto';
        document.getElementById('d-original-price').value = formatCurrency(product.originalPrice || product.price);

        const btnRemove = document.getElementById('btn-remove-discount');
        if (product.originalPrice && product.originalPrice > product.price) {
            btnRemove.classList.remove('hidden');
        } else {
            btnRemove.classList.add('hidden');
        }

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
            singlePriceContainer.classList.add('hidden');
            variantsContainer.classList.remove('hidden');
            if (dNewPriceInput) dNewPriceInput.required = false;

            let html = '<p class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-200 pb-2 mb-2">Ajusta el precio por variante</p>';
            product.combinations.forEach((c, index) => {
                const label = `${c.color || ''} ${c.capacity ? '- ' + c.capacity : ''}`.trim() || `Variante #${index + 1}`;
                const cCurrent = (c.originalPrice && c.originalPrice > c.price) ? c.price : "";
                html += `
                    <div class="flex justify-between items-center gap-3 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <div class="w-1/2 overflow-hidden">
                            <p class="text-[10px] font-black text-brand-black truncate" title="${label}">${label}</p>
                            <p class="text-[9px] text-gray-400 font-bold">Antes: <span class="line-through decoration-red-300">${formatCurrency(c.originalPrice || c.price)}</span></p>
                        </div>
                        <div class="w-1/2">
                            <input type="text" class="var-discount-input w-full bg-slate-50 border border-gray-200 rounded-md p-2 text-xs font-bold text-brand-orange outline-none focus:border-brand-orange focus:bg-white transition" data-index="${index}" value="${formatCurrency(cCurrent)}" placeholder="$ 0">
                        </div>
                    </div>`;
            });
            variantsContainer.innerHTML = html;

            variantsContainer.querySelectorAll('.var-discount-input').forEach(inp => {
                inp.addEventListener('input', (e) => {
                    const val = parseCurrency(e.target.value);
                    e.target.value = val > 0 ? formatCurrency(val) : "";
                });
                inp.addEventListener('focus', (e) => e.target.select());
            });
        } else {
            singlePriceContainer.classList.remove('hidden');
            variantsContainer.classList.add('hidden');
            variantsContainer.innerHTML = "";
            if (dNewPriceInput) {
                dNewPriceInput.required = true;
                dNewPriceInput.value = (product.originalPrice && product.originalPrice > product.price) ? formatCurrency(product.price) : "";
            }
        }

        discountModal.classList.remove('hidden');
        discountModal.classList.add('flex');
    } catch (e) {
        console.error("Error abriendo modal de descuento:", e);
    }
};

window.closeDiscountModal = () => {
    discountModal.classList.add('hidden');
    discountModal.classList.remove('flex');
    currentEditingId = null;
    currentEditingProduct = null;
};

window.toggleDurationType = (type) => {
    currentDurationType = type;
    if (type === 'days') {
        dInputDays.classList.remove('hidden');
        dInputDate.classList.add('hidden');
        btnTypeDays.classList.add('bg-white', 'shadow-sm', 'text-brand-black');
        btnTypeDays.classList.remove('text-gray-400');
        btnTypeDate.classList.add('text-gray-400');
        btnTypeDate.classList.remove('bg-white', 'shadow-sm', 'text-brand-black');
    } else {
        dInputDays.classList.add('hidden');
        dInputDate.classList.remove('hidden');
        btnTypeDate.classList.add('bg-white', 'shadow-sm', 'text-brand-black');
        btnTypeDate.classList.remove('text-gray-400');
        btnTypeDays.classList.add('text-gray-400');
        btnTypeDays.classList.remove('bg-white', 'shadow-sm', 'text-brand-black');
    }
};

if (discountForm) {
    discountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = discountForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

        try {
            const product = currentEditingProduct;
            let minPrice = Infinity;
            let rootOriginalPrice = product.originalPrice || product.price;
            let updatedCombinations = product.combinations ? JSON.parse(JSON.stringify(product.combinations)) : [];
            let updatedCapacities = product.capacities ? JSON.parse(JSON.stringify(product.capacities)) : [];

            if (updatedCombinations.length > 0) {
                document.querySelectorAll('.var-discount-input').forEach(inp => {
                    const idx = inp.dataset.index;
                    const newPriceRaw = parseCurrency(inp.value);
                    const comb = updatedCombinations[idx];
                    if (!comb.originalPrice) comb.originalPrice = comb.price;
                    comb.price = (newPriceRaw > 0 && newPriceRaw < comb.originalPrice) ? newPriceRaw : comb.originalPrice;
                    if (comb.price < minPrice) minPrice = comb.price;
                });
                updatedCapacities = updatedCapacities.map(cap => {
                    const matchingComb = updatedCombinations.find(c => c.capacity === cap.label);
                    return (matchingComb && matchingComb.price < (cap.originalPrice || cap.price))
                        ? { ...cap, originalPrice: cap.originalPrice || cap.price, price: matchingComb.price }
                        : cap;
                });
            } else {
                const newPriceRaw = parseCurrency(dNewPriceInput.value);
                if (newPriceRaw <= 0 || newPriceRaw >= rootOriginalPrice) {
                    throw new Error("El precio de oferta debe ser menor al precio original.");
                }
                minPrice = newPriceRaw;
            }

            let endDate = new Date();
            if (currentDurationType === 'days') {
                const days = parseInt(document.getElementById('d-duration-days').value);
                if (!days) throw new Error("Por favor ingresa la cantidad de días.");
                endDate.setDate(endDate.getDate() + days);
            } else {
                const dateVal = document.getElementById('d-duration-date').value;
                if (!dateVal) throw new Error("Por favor selecciona una fecha límite.");
                endDate = new Date(dateVal);
            }

            await updateDoc(doc(db, "products", currentEditingId), {
                originalPrice: rootOriginalPrice,
                price: minPrice,
                promoEndsAt: endDate,
                updatedAt: new Date(),
                combinations: updatedCombinations,
                capacities: updatedCapacities
            });

            alert("✅ Descuento aplicado exitosamente.");
            closeDiscountModal();
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });
}

window.removeDiscount = async () => {
    if (!confirm("¿Deseas restaurar los precios originales de este producto?")) return;
    try {
        const product = currentEditingProduct;
        if (!product.originalPrice) return;

        let updatedCombinations = (product.combinations || []).map(c => ({
            ...c,
            price: c.originalPrice || c.price,
            originalPrice: 0
        }));
        let updatedCapacities = (product.capacities || []).map(c => ({
            ...c,
            price: c.originalPrice || c.price,
            originalPrice: 0
        }));

        await updateDoc(doc(db, "products", currentEditingId), {
            price: product.originalPrice,
            originalPrice: 0,
            promoEndsAt: null,
            updatedAt: new Date(),
            combinations: updatedCombinations,
            capacities: updatedCapacities
        });

        alert("✅ Descuento eliminado y precios originales restaurados.");
        closeDiscountModal();
    } catch (e) {
        console.error(e);
        alert("Error al remover descuento.");
    }
};

// =============================================================================
// 🔥 EXPORTAR E IMPORTAR INVENTARIO EN EXCEL
// =============================================================================

window.exportInventoryToExcel = function () {
    if (!adminProductsCache || adminProductsCache.length === 0) {
        alert("⚠️ No hay productos en memoria para exportar.");
        return;
    }

    const exportRows = [];

    adminProductsCache.forEach(p => {
        if (p.combinations && p.combinations.length > 0) {
            p.combinations.forEach(combo => {
                const bStock = combo.branchStock || {};
                const stockBodega = bStock['bodega'] !== undefined ? (parseInt(bStock['bodega']) || 0) : (parseInt(combo.stock) || 0);
                const stockCentro = bStock['centro'] !== undefined ? (parseInt(bStock['centro']) || 0) : 0;

                exportRows.push({
                    "ID_Producto": p.id,
                    "Categoría": p.category || '',
                    "Subcategoría": p.subcategory || '',
                    "Nombre_Producto": p.name || '',
                    "Marca": p.brand || '',
                    "SKU_Padre": p.sku || '',
                    "Variante_Color": combo.color || '',
                    "Variante_Capacidad": combo.capacity || '',
                    "SKU_Variante": combo.sku || '',
                    "Stock_Global": parseInt(combo.stock) || 0,
                    "Stock_Bodega": stockBodega,
                    "Stock_Centro": stockCentro,
                    "Precio_Venta": parseFloat(combo.price || p.price || 0) || 0,
                    "Costo_Ultima_Compra": parseFloat(p.lastPurchaseCost || 0) || 0,
                    "Estado": p.status === 'active' ? 'Activo' : 'Borrador'
                });
            });
        } else {
            const bStock = p.branchStock || {};
            const stockBodega = bStock['bodega'] !== undefined ? (parseInt(bStock['bodega']) || 0) : (parseInt(p.stock) || 0);
            const stockCentro = bStock['centro'] !== undefined ? (parseInt(bStock['centro']) || 0) : 0;

            exportRows.push({
                "ID_Producto": p.id,
                "Categoría": p.category || '',
                "Subcategoría": p.subcategory || '',
                "Nombre_Producto": p.name || '',
                "Marca": p.brand || '',
                "SKU_Padre": p.sku || '',
                "Variante_Color": '',
                "Variante_Capacidad": '',
                "SKU_Variante": '',
                "Stock_Global": parseInt(p.stock) || 0,
                "Stock_Bodega": stockBodega,
                "Stock_Centro": stockCentro,
                "Precio_Venta": parseFloat(p.price || 0) || 0,
                "Costo_Ultima_Compra": parseFloat(p.lastPurchaseCost || 0) || 0,
                "Estado": p.status === 'active' ? 'Activo' : 'Borrador'
            });
        }
    });

    const runSheetJS = () => {
        const worksheet = XLSX.utils.json_to_sheet(exportRows);

        const colWidths = [
            { wch: 22 }, // ID_Producto
            { wch: 18 }, // Categoría
            { wch: 18 }, // Subcategoría
            { wch: 40 }, // Nombre_Producto
            { wch: 16 }, // Marca
            { wch: 16 }, // SKU_Padre
            { wch: 16 }, // Variante_Color
            { wch: 16 }, // Variante_Capacidad
            { wch: 18 }, // SKU_Variante
            { wch: 14 }, // Stock_Global
            { wch: 14 }, // Stock_Bodega
            { wch: 14 }, // Stock_Centro
            { wch: 16 }, // Precio_Venta
            { wch: 18 }, // Costo_Ultima_Compra
            { wch: 12 }  // Estado
        ];
        worksheet['!cols'] = colWidths;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");

        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(workbook, `Inventario_MiSmartech_${dateStr}.xlsx`);
    };

    if (typeof XLSX === 'undefined') {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        script.onload = runSheetJS;
        document.head.appendChild(script);
    } else {
        runSheetJS();
    }
};

window.triggerImportExcel = function () {
    const input = document.getElementById('excel-file-input');
    if (input) {
        input.value = '';
        input.click();
    }
};

function showSyncNotification(totalItems) {
    let toast = document.getElementById('bg-sync-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bg-sync-toast';
        toast.className = "fixed bottom-6 right-6 z-50 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-800 flex flex-col gap-2 min-w-[300px] transition-all duration-300";
        document.body.appendChild(toast);
    }
    toast.style.display = 'flex';
    toast.style.opacity = '1';
    toast.innerHTML = `
        <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-xl bg-brand-orange/20 text-brand-orange flex items-center justify-center text-sm shrink-0">
                    <i class="fa-solid fa-arrows-rotate fa-spin"></i>
                </div>
                <div>
                    <h5 class="text-xs font-black uppercase tracking-tight text-white">Sincronizando Inventario</h5>
                    <p id="sync-progress-text" class="text-[10px] font-bold text-gray-400">Iniciando segundo plano (0/${totalItems})...</p>
                </div>
            </div>
        </div>
        <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
            <div id="sync-progress-bar" class="bg-brand-orange h-full w-0 transition-all duration-300"></div>
        </div>
    `;
}

function updateSyncProgress(current, total) {
    const textEl = document.getElementById('sync-progress-text');
    const barEl = document.getElementById('sync-progress-bar');
    const pct = Math.min(100, Math.round((current / total) * 100));
    if (textEl) textEl.textContent = `Procesando ${current} de ${total} productos (${pct}%)...`;
    if (barEl) barEl.style.width = `${pct}%`;
}

function finishSyncNotification(updatedCount, errorCount) {
    const toast = document.getElementById('bg-sync-toast');
    if (!toast) return;
    toast.className = "fixed bottom-6 right-6 z-50 bg-emerald-950 border border-emerald-800 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[300px] transition-all duration-300";
    toast.innerHTML = `
        <div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm shrink-0">
            <i class="fa-solid fa-circle-check text-lg"></i>
        </div>
        <div>
            <h5 class="text-xs font-black uppercase tracking-tight text-white">Sincronización Completada</h5>
            <p class="text-[10px] font-bold text-emerald-200/90">${updatedCount} productos actualizados exitosamente ${errorCount > 0 ? `(${errorCount} omitidos)` : ''}</p>
        </div>
    `;
    setTimeout(() => {
        if (toast) {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 500);
        }
    }, 4500);
}

window.importInventoryFromExcel = async function (event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        alert("⚠️ Librería de Excel no cargada. Reintenta.");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonRows = XLSX.utils.sheet_to_json(worksheet);

            if (!jsonRows || jsonRows.length === 0) {
                alert("⚠️ El archivo Excel está vacío o no tiene el formato correcto.");
                return;
            }

            const groupedByProdId = {};
            jsonRows.forEach(row => {
                const prodId = row["ID_Producto"] || row["id"] || row["ID"];
                if (!prodId) return;

                if (!groupedByProdId[prodId]) {
                    groupedByProdId[prodId] = [];
                }
                groupedByProdId[prodId].push(row);
            });

            const prodIds = Object.keys(groupedByProdId);
            const totalProducts = prodIds.length;

            if (totalProducts === 0) {
                alert("⚠️ No se encontraron IDs de productos válidos en el archivo Excel.");
                return;
            }

            if (!confirm(`¿Iniciar sincronización de inventario en SEGUNDO PLANO para ${totalProducts} productos? Podrás seguir usando el panel normalmente.`)) {
                return;
            }

            showSyncNotification(totalProducts);

            setTimeout(async () => {
                let updatedCount = 0;
                let errorCount = 0;
                let opsInBatch = 0;
                let currentBatch = writeBatch(db);

                for (let i = 0; i < totalProducts; i++) {
                    const prodId = prodIds[i];
                    const rowsForProd = groupedByProdId[prodId];
                    const pDoc = adminProductsCache.find(p => p.id === prodId);

                    if (!pDoc) {
                        console.warn(`Producto ${prodId} no encontrado en catálogo.`);
                        errorCount++;
                        updateSyncProgress(i + 1, totalProducts);
                        continue;
                    }

                    try {
                        const prodRef = doc(db, "products", prodId);
                        const updates = { updatedAt: new Date() };

                        if (pDoc.combinations && pDoc.combinations.length > 0) {
                            const updatedCombos = JSON.parse(JSON.stringify(pDoc.combinations));

                            rowsForProd.forEach(r => {
                                const color = r["Variante_Color"] || '';
                                const capacity = r["Variante_Capacidad"] || '';
                                const variantSku = r["SKU_Variante"] || '';

                                const cIndex = updatedCombos.findIndex(c =>
                                    (c.color || '') === color &&
                                    (c.capacity || '') === capacity
                                );

                                if (cIndex >= 0) {
                                    const stockBodega = r["Stock_Bodega"] !== undefined ? parseInt(r["Stock_Bodega"]) || 0 : null;
                                    const stockCentro = r["Stock_Centro"] !== undefined ? parseInt(r["Stock_Centro"]) || 0 : null;
                                    const priceVal = r["Precio_Venta"] !== undefined ? parseFloat(r["Precio_Venta"]) || 0 : null;

                                    if (!updatedCombos[cIndex].branchStock) updatedCombos[cIndex].branchStock = {};

                                    if (stockBodega !== null) updatedCombos[cIndex].branchStock['bodega'] = Math.max(0, stockBodega);
                                    if (stockCentro !== null) updatedCombos[cIndex].branchStock['centro'] = Math.max(0, stockCentro);

                                    updatedCombos[cIndex].stock = Object.values(updatedCombos[cIndex].branchStock).reduce((s, v) => s + v, 0);

                                    if (priceVal !== null) updatedCombos[cIndex].price = priceVal;
                                    if (variantSku) updatedCombos[cIndex].sku = variantSku;
                                }
                            });

                            updates.combinations = updatedCombos;
                            updates.stock = updatedCombos.reduce((s, c) => s + (c.stock || 0), 0);

                            const rootBranchStock = {};
                            updatedCombos.forEach(c => {
                                if (c.branchStock) {
                                    Object.keys(c.branchStock).forEach(bId => {
                                        rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (c.branchStock[bId] || 0);
                                    });
                                }
                            });
                            updates.branchStock = rootBranchStock;

                        } else {
                            const r = rowsForProd[0];
                            const stockBodega = r["Stock_Bodega"] !== undefined ? parseInt(r["Stock_Bodega"]) || 0 : null;
                            const stockCentro = r["Stock_Centro"] !== undefined ? parseInt(r["Stock_Centro"]) || 0 : null;
                            const priceVal = r["Precio_Venta"] !== undefined ? parseFloat(r["Precio_Venta"]) || 0 : null;
                            const lastCost = r["Costo_Ultima_Compra"] !== undefined ? parseFloat(r["Costo_Ultima_Compra"]) || 0 : null;

                            const bStock = pDoc.branchStock ? JSON.parse(JSON.stringify(pDoc.branchStock)) : {};

                            if (stockBodega !== null) bStock['bodega'] = Math.max(0, stockBodega);
                            if (stockCentro !== null) bStock['centro'] = Math.max(0, stockCentro);

                            updates.branchStock = bStock;
                            updates.stock = Object.values(bStock).reduce((s, v) => s + v, 0);

                            if (priceVal !== null) updates.price = priceVal;
                            if (lastCost !== null) updates.lastPurchaseCost = lastCost;
                        }

                        currentBatch.update(prodRef, updates);
                        opsInBatch++;
                        updatedCount++;

                        if (opsInBatch >= 400) {
                            await currentBatch.commit();
                            currentBatch = writeBatch(db);
                            opsInBatch = 0;
                        }

                    } catch (err) {
                        console.error(`Error actualizando producto ${prodId}:`, err);
                        errorCount++;
                    }

                    updateSyncProgress(i + 1, totalProducts);
                }

                if (opsInBatch > 0) {
                    await currentBatch.commit();
                }

                finishSyncNotification(updatedCount, errorCount);
            }, 50);

        } catch (err) {
            console.error("Error leyendo Excel:", err);
            alert("❌ Error al procesar el archivo Excel: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
};

// =============================================================================
// 🔥 INICIALIZACIÓN CENTRALIZADA
// =============================================================================

// Cargar categorías guardadas en caché local de inmediato
loadCategoriesFromLocal();

// Escuchar cambios reactivos en categorías (Store Central)
if (AdminStore.subscribeToCategories) {
    AdminStore.subscribeToCategories((catList) => {
        if (catList && catList.length > 0) {
            localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(catList));
            processCategoriesData(catList);
        }
    });
}

// Fallback directo por si categories no está en AdminStore
try {
    onSnapshot(collection(db, "categories"), (snap) => {
        const catDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (catDocs.length > 0) {
            localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(catDocs));
            processCategoriesData(catDocs);
        }
    }, (err) => {
        // Ignorar si no hay permisos de lectura directa
    });
} catch (e) {}

// Suscripción al Store Central de Productos
AdminStore.subscribeToProducts((productsArray) => {
    adminProductsCache = productsArray || [];
    // Actualizar marcas y categorías con los datos recibidos
    processCategoriesData(JSON.parse(localStorage.getItem(CATEGORIES_STORAGE_KEY) || '[]'));
    renderViewFromMemory();
});
