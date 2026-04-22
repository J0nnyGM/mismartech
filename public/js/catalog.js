import { db, collection, getDocs, query, where, limit, onSnapshot } from "./firebase-init.js";
import { addToCart, updateCartCount, getProductQtyInCart, removeOneUnit } from "./cart.js";

// --- ESTADO GLOBAL ---
let allProducts = [];
let filteredProducts = [];
const activeFilters = { category: [], subcategory: [], brand: [], color: [], capacity: [] };

// CONFIGURACIÓN
const ITEMS_PER_PAGE = 28;
let currentPage = 1;
let currentSort = 'newest';
let isPromoMode = false;

// REFERENCIAS DOM
const grid = document.getElementById('products-grid');
const countLabel = document.getElementById('product-count');
const filtersContainer = document.getElementById('filters-container');
const emptyState = document.getElementById('empty-state');
const btnClear = document.getElementById('btn-clear-filters');
const paginationContainer = document.getElementById('pagination-controls');

const pageTitle = document.querySelector('h1'); 
const pageSubtitle = document.querySelector('h1')?.previousElementSibling;

const sortTrigger = document.getElementById('sort-trigger');
const sortLabel = document.getElementById('sort-label');
const sortIcon = document.getElementById('sort-icon');
const sortDropdown = document.getElementById('sort-dropdown');
const drawer = document.getElementById('mobile-filters-drawer');
const mobileOverlay = document.getElementById('mobile-filters-overlay');
const mobileContent = document.getElementById('mobile-filters-content');

// --- 1. INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'promos') {
        isPromoMode = true;
        setupPromoView();
        currentSort = 'discount'; 
        if(sortLabel) sortLabel.textContent = "Mejores Ofertas";
    }
    const catParam = urlParams.get('category');
    const subParam = urlParams.get('subcategory');
    if (catParam) activeFilters.category.push(decodeURIComponent(catParam));
    if (subParam) activeFilters.subcategory.push(decodeURIComponent(subParam));

    // Iniciamos el motor inteligente en tiempo real
    SmartCatalogSync.init();
});

function setupPromoView() {
    if(pageTitle) pageTitle.innerHTML = `OFERTAS <span class="text-brand-red">ESPECIALES</span>`;
    if(pageSubtitle) {
        pageSubtitle.textContent = "Tiempo Limitado";
        pageSubtitle.classList.remove('text-gray-400');
        pageSubtitle.classList.add('text-brand-red', 'animate-pulse');
    }
    const carousel = document.getElementById('brands-carousel-area');
    if(carousel) carousel.classList.add('hidden');
}

/* ==========================================================================
   ⚙️ MOTOR DE SINCRONIZACIÓN INTELIGENTE (REAL-TIME CACHE PARA CATÁLOGO)
   ========================================================================== */
const SmartCatalogSync = {
    STORAGE_KEY: 'pixeltech_master_catalog',
    runtimeMap: {},
    isListening: false,
    
    init() {
        // 1. Carga instantánea desde memoria local
        const localData = localStorage.getItem(this.STORAGE_KEY);
        let lastSyncTime = 0;
        
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                this.runtimeMap = parsed.map || {};
                lastSyncTime = parsed.lastSync || 0;
                
                // Actualizamos el array global para los filtros
                allProducts = Object.values(this.runtimeMap).filter(p => p.status === 'active');
                
                if (allProducts.length > 0) {
                    console.log(`📂 [Catálogo] Cargados ${allProducts.length} productos de caché local.`);
                    if (isPromoMode) {
                        allProducts = allProducts.filter(p => p.originalPrice && p.price < p.originalPrice);
                    }
                    renderFiltersUI(); 
                    applySortAndFilter();
                    syncCheckboxes();
                }
            } catch (e) {
                console.warn("Error leyendo caché local, reiniciando...");
            }
        }

        // 2. Iniciar conexión en tiempo real con Firebase
        this.listenForUpdates(lastSyncTime);
    },

    listenForUpdates(lastSyncTime) {
        if (this.isListening) return;
        this.isListening = true;

        const collectionRef = collection(db, "products");
        let q;

        // CASO 1: Primera carga (Caché vacío)
        if (lastSyncTime === 0 || Object.keys(this.runtimeMap).length === 0) {
            console.log("⬇️ [Catálogo] Descargando inventario completo y activando tiempo real...");
            q = query(collectionRef, where("status", "==", "active"));
        } 
        // CASO 2: Usuario recurrente (Solo escucha Deltas)
        else {
            console.log("🔄 [Catálogo] Escuchando actualizaciones en tiempo real desde:", new Date(lastSyncTime).toLocaleString());
            q = query(collectionRef, where("updatedAt", ">", new Date(lastSyncTime)));
        }

        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                if (lastSyncTime !== 0) console.log("✅ [Catálogo] Todo está al día.");
                return;
            }

            let hasChanges = false;

            // Procesamos los cambios exactos
            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                const id = change.doc.id;

                if (change.type === 'added' || change.type === 'modified') {
                    if (data.status === 'active') {
                        this.runtimeMap[id] = { id, ...data };
                        hasChanges = true;
                    } else {
                        if (this.runtimeMap[id]) {
                            delete this.runtimeMap[id];
                            hasChanges = true;
                        }
                    }
                } else if (change.type === 'removed') {
                    if (this.runtimeMap[id]) {
                        delete this.runtimeMap[id];
                        hasChanges = true;
                    }
                }
            });

            // Si la base de datos tuvo movimientos, actualizamos la vista
            if (hasChanges) {
                console.log(`🔥 [Catálogo] Inventario actualizado en vivo: ${snapshot.docChanges().length} modificaciones.`);
                
                // Actualizamos Array Global
                allProducts = Object.values(this.runtimeMap).filter(p => p.status === 'active');
                if (isPromoMode) {
                    allProducts = allProducts.filter(p => p.originalPrice && p.price < p.originalPrice);
                }

                // Guardamos el nuevo estado en el celular del usuario
                this.saveState();
                
                // 🔥 LA MAGIA: Repintamos los filtros y la grilla SIN perder lo que el usuario estaba haciendo
                renderFiltersUI();
                syncCheckboxes(); // Mantiene marcadas las cajitas que el usuario ya había tocado
                applySortAndFilter();
            }
        }, (error) => {
            console.error("Error en SmartSync Catalog Realtime:", error);
            if (allProducts.length === 0) grid.innerHTML = `<p class="col-span-full text-center text-red-400 font-bold">Error cargando inventario en vivo.</p>`;
        });
    },

    saveState() {
        try {
            const state = {
                map: this.runtimeMap,
                lastSync: Date.now() // Guardamos el momento exacto
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("⚠️ Quota de LocalStorage excedida. La caché no persistirá al cerrar.");
        }
    }
};

// --- SMART SYNC ---
async function loadProductsSmart() {
    const STORAGE_KEY = 'pixeltech_master_catalog';
    let runtimeMap = {};
    let lastSyncTime = 0;

    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    if (cachedRaw) {
        try {
            const parsed = JSON.parse(cachedRaw);
            runtimeMap = parsed.map || {};
            lastSyncTime = parsed.lastSync || 0;
        } catch (e) { console.warn("Caché corrupto"); }
    }

    allProducts = Object.values(runtimeMap).filter(p => p.status === 'active');
    
    if (allProducts.length > 0) {
        renderFiltersUI(); 
        applySortAndFilter();
    }

    try {
        const collectionRef = collection(db, "products");
        let q;
        if (lastSyncTime === 0 || allProducts.length === 0) {
            q = query(collectionRef, where("status", "==", "active"));
        } else {
            q = query(collectionRef, where("updatedAt", ">", new Date(lastSyncTime)));
        }

        const snap = await getDocs(q);

        if (!snap.empty) {
            snap.forEach(docSnap => {
                const data = docSnap.data();
                if (data.status === 'active') {
                    runtimeMap[docSnap.id] = { id: docSnap.id, ...data };
                } else {
                    if (runtimeMap[docSnap.id]) delete runtimeMap[docSnap.id];
                }
            });

            const newState = { map: runtimeMap, lastSync: Date.now() };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
            allProducts = Object.values(runtimeMap).filter(p => p.status === 'active');
            renderFiltersUI();
        }

    } catch (e) {
        console.error("Error en SmartSync Catalog:", e);
        if (allProducts.length === 0) grid.innerHTML = `<p class="col-span-full text-center text-red-400 font-bold">Error cargando inventario.</p>`;
    }

    if (isPromoMode) {
        allProducts = allProducts.filter(p => p.originalPrice && p.price < p.originalPrice);
    }
    
    applySortAndFilter();
}

// --- OVERLAY LÓGICA (Idéntico a search.js) ---
const colorMap = { "negro": "#171717", "black": "#171717", "blanco": "#F9FAFB", "white": "#F9FAFB", "azul": "#2563EB", "blue": "#2563EB", "rojo": "#DC2626", "red": "#DC2626" };
function getColorHex(name) { if (!name) return '#E5E7EB'; return colorMap[name.toLowerCase()] || name; }

window.openCardOverlay = (id, prefix) => {
    event.stopPropagation();
    // Buscar el producto en la lista cargada
    const p = allProducts.find(x => x.id === id);
    const uniqueId = prefix + '-' + id;
    const overlay = document.getElementById(`overlay-${uniqueId}`);
    
    if (!p || !overlay) return;

    // 1. Determinar selecciones iniciales (Primera opción disponible)
    const initialColor = (p.hasVariants && p.variants?.length > 0) ? p.variants[0].color : null;
    const initialCap = (p.hasCapacities && p.capacities?.length > 0) ? p.capacities[0].label : null;

    // 2. Calcular Precio Inicial
    let initialPrice = p.price;
    if (p.combinations && p.combinations.length > 0) {
        // Buscar precio de la combinación inicial
        const combo = p.combinations.find(c => 
            (c.color === initialColor || !initialColor) && 
            (c.capacity === initialCap || !initialCap)
        );
        if (combo) initialPrice = combo.price;
    } else if (initialCap && p.capacities) {
        // Fallback si no hay combinaciones pero hay capacidades
        const capObj = p.capacities.find(c => c.label === initialCap);
        if (capObj) initialPrice = capObj.price;
    }

    let html = `
    <div class="absolute inset-0 z-50 bg-white flex flex-col h-full w-full p-4" onclick="event.stopPropagation()">
        
        <div class="flex justify-between items-center border-b-2 border-gray-100 pb-2 mb-2 shrink-0">
            <h4 class="text-xs font-black uppercase text-black tracking-widest">
                Personalizar
            </h4>
            <button onclick="window.closeCardOverlay('${uniqueId}')" class="w-6 h-6 flex items-center justify-center text-black hover:text-white hover:bg-black transition rounded-full bg-gray-100">
                <i class="fa-solid fa-xmark text-xs"></i>
            </button>
        </div>
        
        <div class="flex-grow flex flex-col justify-center gap-4 overflow-y-auto no-scrollbar py-2" id="overlay-opts-${uniqueId}" data-id="${id}">`;

    // Render Colores
    if (p.hasVariants && p.variants?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[10px] font-black text-black uppercase mb-2 text-center">Selecciona Color</p>
            <div class="flex flex-wrap gap-3 justify-center">`;
        p.variants.forEach((v, idx) => {
            const isLight = ['blanco', 'white', 'plateado', 'silver'].includes(v.color.toLowerCase());
            // Nota: Agregamos scale-110 y ring al primero por defecto (idx===0)
            html += `
                <button onclick="window.selectVariantOption('${uniqueId}', 'color', '${v.color}', this)" 
                    class="w-8 h-8 rounded-full shadow-sm hover:scale-110 transition-all var-btn-color ring-2 ${idx===0 ? 'ring-brand-cyan scale-110' : 'ring-gray-200'} ${isLight ? 'border border-gray-300' : ''}" 
                    style="background-color: ${getColorHex(v.color)}" 
                    data-val="${v.color}">
                </button>`;
        });
        html += `</div></div>`;
    }

    // Render Capacidades
    if (p.hasCapacities && p.capacities?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[10px] font-black text-black uppercase mb-2 text-center">Selecciona Capacidad</p>
            <div class="flex flex-wrap gap-2 justify-center">`;
        p.capacities.forEach((c, idx) => {
            html += `
                <button onclick="window.selectVariantOption('${uniqueId}', 'capacity', '${c.label}', this)" 
                    class="px-3 py-2 rounded-lg border-2 text-[9px] font-black uppercase transition-all var-btn-cap ${idx===0 ? 'bg-black text-white border-black' : 'bg-white text-black border-gray-200 hover:border-brand-cyan'}" 
                    data-val="${c.label}">
                    ${c.label}
                </button>`;
        });
        html += `</div></div>`;
    }

    html += `</div>
        
        <div class="mt-auto shrink-0 pt-2 border-t border-dashed border-gray-100">
            <div class="flex justify-between items-center mb-2 px-1">
                <span class="text-[9px] font-bold text-gray-400 uppercase">Total:</span>
                <span class="text-sm font-black text-brand-black" id="overlay-price-${uniqueId}">$${initialPrice.toLocaleString('es-CO')}</span>
            </div>
            <button onclick="window.confirmAdd('${uniqueId}')" class="w-full bg-brand-cyan text-black font-black py-3 rounded-xl uppercase text-[10px] tracking-[0.2em] hover:bg-cyan-400 transition shadow-lg active:scale-95 flex items-center justify-center gap-2">
                <span>Agregar al Carrito</span> <i class="fa-solid fa-check"></i>
            </button>
        </div>
    </div>`;

    overlay.innerHTML = html;
    
    overlay.classList.remove('hidden');
    overlay.classList.add('flex'); 
    
    requestAnimationFrame(() => { 
        overlay.classList.remove('opacity-0', 'scale-95', 'pointer-events-none'); 
        overlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto'); 
    });

    // Guardar estado inicial en el DOM
    const container = document.getElementById(`overlay-opts-${uniqueId}`);
    container.dataset.selColor = initialColor || "";
    container.dataset.selCap = initialCap || "";
};

window.selectVariantOption = (uniqueId, type, val, btn) => {
    event.stopPropagation();
    const container = document.getElementById(`overlay-opts-${uniqueId}`);
    if (!container) return;

    const id = container.dataset.id;
    const p = allProducts.find(x => x.id === id); // Necesitamos el producto para calcular precio

    // 1. Actualizar Selección Visual y Estado
    if (type === 'color') {
        container.dataset.selColor = val;
        const parent = btn.parentElement;
        parent.querySelectorAll('.var-btn-color').forEach(b => {
            b.classList.remove('ring-brand-cyan', 'scale-110');
            b.classList.add('ring-gray-200');
        });
        btn.classList.remove('ring-gray-200');
        btn.classList.add('ring-brand-cyan', 'scale-110');
    }

    if (type === 'capacity') {
        container.dataset.selCap = val;
        const parent = btn.parentElement;
        parent.querySelectorAll('.var-btn-cap').forEach(b => {
            b.className = "px-3 py-2 rounded-lg border-2 text-[9px] font-black uppercase transition-all var-btn-cap border-gray-200 text-gray-500 hover:border-brand-cyan";
        });
        btn.className = "px-3 py-2 rounded-lg border-2 text-[9px] font-black uppercase transition-all var-btn-cap bg-black text-white border-black shadow-sm";
    }

    // 2. RECALCULAR PRECIO (CORRECCIÓN)
    // Leemos el estado actual de AMBOS (color y capacidad) para buscar la combinación exacta
    const curColor = container.dataset.selColor;
    const curCap = container.dataset.selCap;
    let newPrice = p.price; // Precio base por defecto

    if (p.combinations && p.combinations.length > 0) {
        // Buscar coincidencia exacta en la matriz
        const combo = p.combinations.find(c => 
            (c.color === curColor || !c.color) && 
            (c.capacity === curCap || !c.capacity)
        );
        if (combo) {
            newPrice = combo.price;
        }
    } else if (p.capacities && curCap) {
        // Caso simple: Solo capacidades
        const c = p.capacities.find(x => x.label === curCap);
        if (c) newPrice = c.price;
    }

    // 3. Actualizar DOM del Precio
    const priceEl = document.getElementById(`overlay-price-${uniqueId}`);
    if (priceEl) {
        // Animación simple de cambio
        priceEl.style.opacity = '0.5';
        setTimeout(() => {
            priceEl.textContent = `$${newPrice.toLocaleString('es-CO')}`;
            priceEl.style.opacity = '1';
        }, 150);
    }
};

window.closeCardOverlay = (uniqueId) => {
    event.stopPropagation();
    const overlay = document.getElementById(`overlay-${uniqueId}`);
    if (!overlay) return;
    overlay.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
    overlay.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    setTimeout(() => { overlay.classList.add('hidden'); overlay.innerHTML = ''; }, 300);
};


window.confirmAdd = (uniqueId) => {
    event.stopPropagation();
    const container = document.getElementById(`overlay-opts-${uniqueId}`);
    const id = container.dataset.id;
    const p = allProducts.find(x => x.id === id);

    const selColor = container.dataset.selColor || null;
    const selCap = container.dataset.selCap || null;

    let finalPrice = p.price;
    if (selCap && p.capacities) {
        const c = p.capacities.find(x => x.label === selCap);
        if (c) finalPrice = c.price;
    }

    let finalImage = p.mainImage || p.image;
    if (selColor && p.variants) {
        const v = p.variants.find(x => x.color === selColor);
        if (v && v.images?.[0]) finalImage = v.images[0];
    }

    addToCart({ id: p.id, name: p.name, price: finalPrice, originalPrice: p.originalPrice || 0, image: finalImage, color: selColor, capacity: selCap, quantity: 1 });
    window.closeCardOverlay(uniqueId);
    renderGrid();
    updateCartCount();
};

window.quickAdd = (id) => {
    event.stopPropagation();
    const p = allProducts.find(x => x.id === id);
    if (!p) return;

    let finalPrice = p.price;
    let finalImage = p.mainImage || p.image;
    let selectedColor = null;
    let selectedCapacity = null;

    if (p.hasCapacities && p.capacities && p.capacities.length > 0) {
        selectedCapacity = p.capacities[0].label;
        finalPrice = p.capacities[0].price;
    }
    if (p.hasVariants && p.variants && p.variants.length > 0) {
        selectedColor = p.variants[0].color;
        if (p.variants[0].images?.[0]) finalImage = p.variants[0].images[0];
    }

    addToCart({ id: p.id, name: p.name, price: finalPrice, image: finalImage, color: selectedColor, capacity: selectedCapacity, quantity: 1 });
    renderGrid();
    updateCartCount();
};

// --- RENDER GRID ---
function renderGrid() {
    if (filteredProducts.length === 0) {
        grid.classList.add('hidden');
        paginationContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    grid.classList.remove('hidden');
    paginationContainer.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const productsToShow = filteredProducts.slice(start, end);

    grid.innerHTML = productsToShow.map(p => {
        const isOutOfStock = (p.stock || 0) <= 0;
        const hasDiscount = !isOutOfStock && (p.originalPrice && p.originalPrice > p.price);
        const qtyInCart = getProductQtyInCart(p.id);
        const hasVariants = (p.hasVariants && p.variants?.length > 0) || (p.hasCapacities && p.capacities?.length > 0);

        let actionBtnHTML;
        if (isOutOfStock) {
            actionBtnHTML = `<div class="w-full h-10 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-[10px] font-black uppercase tracking-widest cursor-not-allowed mt-auto">Agotado</div>`;
        } else if (qtyInCart > 0) {
            actionBtnHTML = `
                <div onclick="event.stopPropagation()" class="mt-auto w-full h-10 bg-brand-black text-white rounded-xl shadow-lg flex items-center justify-between px-1">
                    <button onclick="window.handleCartAction('${p.id}', -1)" class="w-8 h-full flex items-center justify-center hover:text-brand-cyan transition active:scale-90"><i class="fa-solid fa-minus text-xs"></i></button>
                    <span class="text-xs font-bold w-6 text-center select-none">${qtyInCart}</span>
                    <button onclick="window.handleCartAction('${p.id}', 1)" class="w-8 h-full flex items-center justify-center hover:text-brand-cyan transition active:scale-90"><i class="fa-solid fa-plus text-xs"></i></button>
                </div>`;
        } else {
            // Lógica de botón: Agregar directo o Abrir Opciones
            const btnLabel = hasVariants ? 'Opciones' : 'Agregar';
            const btnIcon = hasVariants ? 'fa-list-ul' : 'fa-cart-plus';
            const clickFn = hasVariants ? `window.openCardOverlay('${p.id}', 'catalog')` : `window.quickAdd('${p.id}')`;

            actionBtnHTML = `
                <button onclick="event.stopPropagation(); ${clickFn}" 
                    class="mt-auto w-full h-10 bg-brand-black text-white rounded-xl shadow-md hover:bg-brand-cyan hover:text-brand-black transition-all flex items-center justify-center gap-2 font-black text-[10px] uppercase tracking-widest group-btn active:scale-95">
                    <span>${btnLabel}</span> <i class="fa-solid ${btnIcon} text-sm"></i>
                </button>`;
        }

        let containerClasses = "group bg-white rounded-[2rem] p-4 border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-300 flex flex-col cursor-pointer h-full relative overflow-hidden ";
        if (isOutOfStock) containerClasses += "opacity-70 grayscale";
        else containerClasses += "hover:border-brand-cyan/20 hover:-translate-y-1";

        const imageSrc = p.mainImage || p.image || 'https://placehold.co/300x300';
        const clickAction = isOutOfStock ? "" : `window.location.href='/shop/product.html?id=${p.id}'`;
        const overlayHTML = `<div id="overlay-catalog-${p.id}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

        let badge = "";
        if(hasDiscount) {
            const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
            badge = `<div class="absolute top-0 left-0 bg-gradient-to-r from-red-600 to-pink-600 text-white text-[9px] font-black px-3 py-1.5 rounded-br-2xl z-20 shadow-md flex items-center gap-1">-${disc}%</div>`;
        }

        return `
        <div class="${containerClasses}" onclick="${clickAction}">
            ${badge}
            ${overlayHTML}
            <div class="relative mb-3 overflow-hidden rounded-2xl bg-slate-50 h-48 md:h-56 flex items-center justify-center p-4">
                <img src="${imageSrc}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-700 mix-blend-multiply relative z-10" loading="lazy">
            </div>
            <div class="flex flex-col flex-grow text-center">
                <p class="text-[8px] font-black text-brand-cyan uppercase tracking-widest mb-1 truncate">${p.subcategory || p.category || 'Tecnología'}</p>
                <h3 class="font-bold text-xs md:text-sm text-brand-black mb-2 line-clamp-2 uppercase leading-tight min-h-[2.5em] group-hover:text-brand-cyan transition-colors">${p.name}</h3>
                <div class="mt-auto w-full">
                    <div class="mb-3"><span class="text-lg font-black text-brand-black tracking-tight">$${p.price.toLocaleString('es-CO')}</span></div>
                    ${actionBtnHTML}
                </div>
            </div>
        </div>`;
    }).join('');
    
    if (currentPage > 1) document.getElementById('global-header').scrollIntoView({ behavior: 'smooth' });
}

// ... (Resto igual: Filtros UI, Toggle, Pagination, etc.) ...
// --- 3. UI FILTROS ---
function renderFiltersUI() {
    
    const getPoolForCounting = (excludeKey) => {
        return allProducts.filter(p => {
            const norm = (str) => str ? str.toLowerCase() : '';

            if (excludeKey !== 'category' && activeFilters.category.length > 0) {
                if (!activeFilters.category.some(f => norm(p.category) === norm(f))) return false;
            }
            if (excludeKey !== 'subcategory' && activeFilters.subcategory.length > 0) {
                if (!activeFilters.subcategory.some(f => norm(p.subcategory) === norm(f))) return false;
            }
            if (excludeKey !== 'brand' && activeFilters.brand.length > 0) {
                if (!activeFilters.brand.some(f => norm(p.brand) === norm(f))) return false;
            }
            if (excludeKey !== 'color' && activeFilters.color.length > 0) {
                const pColors = new Set();
                if (p.color) pColors.add(norm(p.color));
                if (p.combinations) p.combinations.forEach(c => { if(c.color) pColors.add(norm(c.color)); });
                if (!activeFilters.color.some(f => pColors.has(norm(f)))) return false;
            }
            if (excludeKey !== 'capacity' && activeFilters.capacity.length > 0) {
                const pCaps = new Set();
                if (p.capacity) pCaps.add(norm(p.capacity));
                if (p.combinations) p.combinations.forEach(c => { if(c.capacity) pCaps.add(norm(c.capacity)); });
                if (!activeFilters.capacity.some(f => pCaps.has(norm(f)))) return false;
            }

            return true;
        });
    };

    const extractCounts = (key, isVariantField, sourceArray) => {
        const counts = {};
        sourceArray.forEach(p => {
            let values = [];
            if (isVariantField) {
                const fromRaiz = p[key] ? [p[key]] : [];
                const fromVar = p.combinations ? p.combinations.map(c => c[key]) : [];
                values = [...new Set([...fromRaiz, ...fromVar])];
            } else {
                if (p[key]) values = [p[key]];
            }
            values.forEach(val => {
                if (val && val.trim() !== '') {
                    const cleanVal = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase(); 
                    counts[cleanVal] = (counts[cleanVal] || 0) + 1;
                }
            });
        });
        return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
    };

    const sections = [];

    sections.push({ 
        id: 'category', 
        label: 'Categorías', 
        items: extractCounts('category', false, getPoolForCounting('category')) 
    });

    if (activeFilters.category.length > 0) {
        const subItems = extractCounts('subcategory', false, getPoolForCounting('subcategory'));
        if (subItems.length > 0) {
            sections.push({ id: 'subcategory', label: 'Subcategorías', items: subItems });
        }
    }

    sections.push({ 
        id: 'brand', 
        label: 'Marcas', 
        items: extractCounts('brand', false, getPoolForCounting('brand')) 
    });

    sections.push({ id: 'color', label: 'Color', items: extractCounts('color', true, getPoolForCounting('color')) });
    sections.push({ id: 'capacity', label: 'Capacidad', items: extractCounts('capacity', true, getPoolForCounting('capacity')) });

    let html = '';
    sections.forEach(sec => {
        if (sec.items.length === 0) return;
        const currentActive = activeFilters[sec.id] || [];
        html += `
            <div class="border-b border-gray-50 pb-6 last:border-0">
                <h4 class="font-black text-xs uppercase text-brand-black mb-4">${sec.label}</h4>
                <div class="space-y-2 max-h-48 overflow-y-auto custom-scroll pr-2">
                    ${sec.items.map(item => {
                        const isChecked = currentActive.some(val => val.toLowerCase() === item.label.toLowerCase());
                        return `
                        <div class="flex items-center gap-3 group cursor-pointer hover:bg-slate-50 p-1.5 rounded-xl transition">
                            <input type="checkbox" id="${sec.id}-${item.label}" value="${item.label}" 
                                class="filter-checkbox appearance-none w-4 h-4 border-2 border-gray-200 rounded-md checked:bg-brand-cyan checked:border-brand-cyan transition cursor-pointer shrink-0"
                                onchange="window.toggleFilter('${sec.id}', '${item.label}')"
                                ${isChecked ? 'checked' : ''}>
                            <label for="${sec.id}-${item.label}" class="flex-grow flex justify-between items-center cursor-pointer select-none">
                                <span class="text-[11px] font-bold text-gray-600 uppercase tracking-wide group-hover:text-brand-cyan transition truncate mr-2">${item.label}</span>
                                <span class="text-[10px] font-black text-brand-black bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md transition min-w-[24px] text-center">${item.count}</span>
                            </label>
                        </div>
                    `}).join('')}
                </div>
            </div>
        `;
    });
    filtersContainer.innerHTML = html;
    mobileContent.innerHTML = html;
}

window.toggleFilter = (type, value) => {
    const index = activeFilters[type].findIndex(item => item.toLowerCase() === value.toLowerCase());
    if (index === -1) activeFilters[type].push(value);
    else activeFilters[type].splice(index, 1);
    if (type === 'category') { activeFilters.subcategory = []; renderFiltersUI(); }
    applySortAndFilter();
};

function syncCheckboxes() {
    Object.keys(activeFilters).forEach(key => {
        activeFilters[key].forEach(val => {
            const els = document.querySelectorAll(`input[id="${key}-${val}"]`);
            els.forEach(el => el.checked = true);
        });
    });
}
window.clearAllFilters = () => { Object.keys(activeFilters).forEach(key => activeFilters[key] = []); document.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false); renderFiltersUI(); applySortAndFilter(); if(window.innerWidth < 1024) toggleDrawer(false); };
window.setSort = (value, label) => { currentSort = value; sortLabel.textContent = label; sortDropdown.classList.add('hidden'); sortIcon.classList.remove('rotate-180'); applySortAndFilter(); };
if (sortTrigger) sortTrigger.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = sortDropdown.classList.contains('hidden'); if (isHidden) { sortDropdown.classList.remove('hidden'); sortIcon.classList.add('rotate-180'); } else { sortDropdown.classList.add('hidden'); sortIcon.classList.remove('rotate-180'); } });
document.addEventListener('click', (e) => { if (sortTrigger && !sortTrigger.contains(e.target) && !sortDropdown.contains(e.target)) { sortDropdown.classList.add('hidden'); sortIcon.classList.remove('rotate-180'); } });

function applySortAndFilter() {
    filteredProducts = allProducts.filter(p => {
        const norm = (str) => str ? str.toLowerCase() : '';
        const matchCat = activeFilters.category.length === 0 || activeFilters.category.some(f => norm(p.category) === norm(f));
        const matchSub = activeFilters.subcategory.length === 0 || activeFilters.subcategory.some(f => norm(p.subcategory) === norm(f));
        const matchBrand = activeFilters.brand.length === 0 || activeFilters.brand.some(f => norm(p.brand) === norm(f));
        const productColors = new Set(); if (p.color) productColors.add(norm(p.color)); if (p.combinations) p.combinations.forEach(c => { if(c.color) productColors.add(norm(c.color)); });
        const matchColor = activeFilters.color.length === 0 || activeFilters.color.some(f => productColors.has(norm(f)));
        const productCaps = new Set(); if (p.capacity) productCaps.add(norm(p.capacity)); if (p.combinations) p.combinations.forEach(c => { if(c.capacity) productCaps.add(norm(c.capacity)); });
        const matchCap = activeFilters.capacity.length === 0 || activeFilters.capacity.some(f => productCaps.has(norm(f)));
        return matchCat && matchSub && matchBrand && matchColor && matchCap;
    });
    filteredProducts.sort((a, b) => {
        if (currentSort === 'price-asc') return a.price - b.price;
        if (currentSort === 'price-desc') return b.price - a.price;
        if (currentSort === 'alpha-asc') return a.name.localeCompare(b.name);
        if (currentSort === 'discount') {
            const discA = a.originalPrice ? (a.originalPrice - a.price) / a.originalPrice : 0;
            const discB = b.originalPrice ? (b.originalPrice - b.price) / b.originalPrice : 0;
            return discB - discA;
        }
        const dateA = a.updatedAt ? (a.updatedAt.seconds || new Date(a.updatedAt).getTime()) : 0;
        const dateB = b.updatedAt ? (b.updatedAt.seconds || new Date(b.updatedAt).getTime()) : 0;
        return dateB - dateA;
    });
    currentPage = 1;
    if(countLabel) countLabel.textContent = filteredProducts.length;
    renderGrid();
    renderPagination();
}

window.handleCartAction = (productId, delta) => {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    if (delta > 0) addToCart(product);
    else removeOneUnit(productId);
    renderGrid();
    if (window.updateCartCountGlobal) window.updateCartCountGlobal();
    else updateCartCount();
};

function renderPagination() {
    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) { paginationContainer.innerHTML = ''; return; }
    let html = `<button onclick="window.changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-30 disabled:pointer-events-none transition"><i class="fa-solid fa-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += `<button onclick="window.changePage(${i})" class="w-10 h-10 flex items-center justify-center rounded-xl font-bold text-xs transition ${i === currentPage ? 'bg-brand-black text-white shadow-lg' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += `<span class="text-gray-300 font-bold text-xs">...</span>`;
        }
    }
    html += `<button onclick="window.changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-30 disabled:pointer-events-none transition"><i class="fa-solid fa-chevron-right"></i></button>`;
    paginationContainer.innerHTML = html;
}
window.changePage = (p) => { currentPage = p; renderGrid(); renderPagination(); };

const openBtn = document.getElementById('btn-open-filters');
const closeBtn = document.getElementById('btn-close-filters');
const applyBtn = document.getElementById('btn-apply-mobile');
const toggleDrawer = (show) => {
    if (show) { drawer.classList.remove('translate-x-full'); mobileOverlay.classList.remove('hidden'); setTimeout(()=>mobileOverlay.classList.remove('opacity-0'),10); } 
    else { drawer.classList.add('translate-x-full'); mobileOverlay.classList.add('opacity-0'); setTimeout(()=>mobileOverlay.classList.add('hidden'),300); }
};
if(openBtn) openBtn.onclick = () => toggleDrawer(true);
if(closeBtn) closeBtn.onclick = () => toggleDrawer(false);
if(mobileOverlay) mobileOverlay.onclick = () => toggleDrawer(false);
if(applyBtn) applyBtn.onclick = () => toggleDrawer(false);