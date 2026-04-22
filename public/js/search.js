import { db, collection, query, where, onSnapshot } from "./firebase-init.js";
import { addToCart, updateCartCount, getProductQtyInCart, removeOneUnit } from "./cart.js";
import { renderBrandCarousel } from "./global-components.js";

// --- ESTADO GLOBAL ---
let allProducts = [];
let filteredProducts = [];
const activeFilters = { category: [], subcategory: [], brand: [], color: [], capacity: [] };

// CONFIGURACIÓN
const ITEMS_PER_PAGE = 28;
let currentPage = 1;
let currentSort = 'newest';
let searchQuery = ""; 
let isPromoMode = false;

// DOM ELEMENTS
const grid = document.getElementById('products-grid');
const countLabel = document.getElementById('result-count');
const filtersContainer = document.getElementById('filters-container');
const emptyState = document.getElementById('empty-state');
const btnClear = document.getElementById('btn-clear-filters');
const paginationContainer = document.getElementById('pagination-controls');
const searchTitle = document.getElementById('search-title');
const searchSubtitle = document.getElementById('search-subtitle');

// Sort & Mobile
const sortTrigger = document.getElementById('sort-trigger');
const sortLabel = document.getElementById('sort-label');
const sortIcon = document.getElementById('sort-icon');
const sortDropdown = document.getElementById('sort-dropdown');
const drawer = document.getElementById('mobile-filters-drawer');
const mobileOverlay = document.getElementById('mobile-filters-overlay');
const mobileContent = document.getElementById('mobile-filters-content');

// --- 1. INICIALIZACIÓN ---
export function initSearch() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
        searchQuery = q.toLowerCase().trim();
        searchTitle.textContent = `"${q}"`;
        searchSubtitle.textContent = "Resultados para";
    }
    const cat = params.get('category');
    if (cat) {
        const decodedCat = decodeURIComponent(cat);
        activeFilters.category.push(decodedCat);
        if(!q) {
            searchTitle.textContent = decodedCat;
            searchSubtitle.textContent = "Explorando";
        }
    }
    const sub = params.get('subcategory');
    if (sub) {
        const decodedSub = decodeURIComponent(sub);
        activeFilters.subcategory.push(decodedSub); 
    }
    const brand = params.get('brand');
    if (brand) {
        const decodedBrand = decodeURIComponent(brand);
        activeFilters.brand.push(decodedBrand);
        if (!q && !cat) {
            searchTitle.textContent = decodedBrand;
            searchSubtitle.textContent = "Marca Oficial";
        }
    }

    if (params.get('mode') === 'promos') {
        isPromoMode = true;
        setupPromoView();
        currentSort = 'discount'; 
        if(sortLabel) sortLabel.textContent = "Mejores Ofertas";
    }

    // Iniciamos el motor inteligente en tiempo real
    SmartCatalogSync.init();
}

function setupPromoView() {
    const pageTitle = document.querySelector('h1'); 
    const pageSubtitle = document.querySelector('h1')?.previousElementSibling;
    if(pageTitle) pageTitle.innerHTML = `OFERTAS <span class="text-brand-red">ESPECIALES</span>`;
    if(pageSubtitle) {
        pageSubtitle.textContent = "Tiempo Limitado";
        pageSubtitle.classList.remove('text-gray-400');
        pageSubtitle.classList.add('text-brand-red', 'animate-pulse');
    }
    const carousel = document.getElementById('brands-carousel-area');
    if(carousel) carousel.classList.add('hidden');
}

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE (Máxima Eficiencia para el Catálogo)
// ==========================================================================
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
                
                this.updateGlobalState();
                
                if (allProducts.length > 0) {
                    console.log(`📂 [Catálogo] Cargados ${allProducts.length} productos de caché local.`);
                    this.renderAll();
                }
            } catch (e) {
                console.warn("Error leyendo caché local, reiniciando...");
            }
        }

        // 2. Iniciar conexión en tiempo real con Firebase
        this.listenForUpdates(lastSyncTime);
    },

    updateGlobalState() {
        allProducts = Object.values(this.runtimeMap).filter(p => p.status === 'active');
        if (isPromoMode) {
            allProducts = allProducts.filter(p => p.originalPrice && p.price < p.originalPrice);
        }
    },

    renderAll() {
        renderFiltersUI(); 
        syncCheckboxes();
        applySortAndFilter();
        
        if (!isPromoMode) {
            const activeBrands = new Set();
            allProducts.forEach(p => { if(p.brand) activeBrands.add(p.brand); });
            renderBrandCarousel('brands-carousel-area', activeBrands);
        }
    },

    listenForUpdates(lastSyncTime) {
        if (this.isListening) return;
        this.isListening = true;

        const collectionRef = collection(db, "products");
        let q;

        if (lastSyncTime === 0 || Object.keys(this.runtimeMap).length === 0) {
            console.log("⬇️ [Catálogo] Descargando inventario completo y activando tiempo real...");
            q = query(collectionRef, where("status", "==", "active"));
        } else {
            console.log("🔄 [Catálogo] Escuchando actualizaciones en la nube desde:", new Date(lastSyncTime).toLocaleString());
            q = query(collectionRef, where("updatedAt", ">", new Date(lastSyncTime)));
        }

        onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                if (lastSyncTime !== 0) console.log("✅ [Catálogo] Todo está al día.");
                return;
            }

            let hasChanges = false;

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

            if (hasChanges) {
                console.log(`🔥 [Catálogo] Inventario actualizado en vivo: ${snapshot.docChanges().length} modificaciones.`);
                
                this.updateGlobalState();
                this.saveState();
                
                // Repintamos todo silenciosamente conservando el estado del usuario
                this.renderAll();
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
                lastSync: Date.now()
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn("⚠️ Quota de LocalStorage excedida. La caché no persistirá al cerrar.");
        }
    }
};

// --- LOGICA DE OVERLAY Y VARIANTES ---
const colorMap = { "negro": "#171717", "black": "#171717", "blanco": "#F9FAFB", "white": "#F9FAFB", "azul": "#2563EB", "blue": "#2563EB", "rojo": "#DC2626", "red": "#DC2626" }; // Puedes expandir esto
function getColorHex(name) { if (!name) return '#E5E7EB'; return colorMap[name.toLowerCase()] || name; }

window.openCardOverlay = (id, prefix) => {
    event.stopPropagation();
    const p = allProducts.find(x => x.id === id);
    const uniqueId = prefix + '-' + id;
    const overlay = document.getElementById(`overlay-${uniqueId}`);
    
    if (!p || !overlay) return;

    const initialColor = (p.hasVariants && p.variants?.length > 0) ? p.variants[0].color : null;
    const initialCap = (p.hasCapacities && p.capacities?.length > 0) ? p.capacities[0].label : null;

    let initialPrice = p.price;
    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => 
            (c.color === initialColor || !initialColor) && 
            (c.capacity === initialCap || !initialCap)
        );
        if (combo) initialPrice = combo.price;
    } else if (initialCap && p.capacities) {
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

    if (p.hasVariants && p.variants?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[10px] font-black text-black uppercase mb-2 text-center">Selecciona Color</p>
            <div class="flex flex-wrap gap-3 justify-center">`;
        p.variants.forEach((v, idx) => {
            const isLight = ['blanco', 'white', 'plateado', 'silver'].includes(v.color.toLowerCase());
            html += `
                <button onclick="window.selectVariantOption('${uniqueId}', 'color', '${v.color}', this)" 
                    class="w-8 h-8 rounded-full shadow-sm hover:scale-110 transition-all var-btn-color ring-2 ${idx===0 ? 'ring-brand-cyan scale-110' : 'ring-gray-200'} ${isLight ? 'border border-gray-300' : ''}" 
                    style="background-color: ${getColorHex(v.color)}" 
                    data-val="${v.color}">
                </button>`;
        });
        html += `</div></div>`;
    }

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

    const container = document.getElementById(`overlay-opts-${uniqueId}`);
    container.dataset.selColor = initialColor || "";
    container.dataset.selCap = initialCap || "";
};

window.selectVariantOption = (uniqueId, type, val, btn) => {
    event.stopPropagation();
    const container = document.getElementById(`overlay-opts-${uniqueId}`);
    if (!container) return;

    const id = container.dataset.id;
    const p = allProducts.find(x => x.id === id); 

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

    const curColor = container.dataset.selColor;
    const curCap = container.dataset.selCap;
    let newPrice = p.price; 

    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => 
            (c.color === curColor || !c.color) && 
            (c.capacity === curCap || !c.capacity)
        );
        if (combo) {
            newPrice = combo.price;
        }
    } else if (p.capacities && curCap) {
        const c = p.capacities.find(x => x.label === curCap);
        if (c) newPrice = c.price;
    }

    const priceEl = document.getElementById(`overlay-price-${uniqueId}`);
    if (priceEl) {
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

    addToCart({
        id: p.id,
        name: p.name,
        price: finalPrice,
        originalPrice: p.originalPrice || 0,
        image: finalImage,
        color: selColor,
        capacity: selCap,
        quantity: 1
    });

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
            const btnLabel = hasVariants ? 'Opciones' : 'Agregar';
            const btnIcon = hasVariants ? 'fa-list-ul' : 'fa-cart-plus';
            const clickFn = hasVariants ? `window.openCardOverlay('${p.id}', 'search')` : `window.quickAdd('${p.id}')`;

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
        const overlayHTML = `<div id="overlay-search-${p.id}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

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

// --- FILTROS UI ---
function renderFiltersUI() {
    const getPoolForCounting = (excludeKey) => {
        return allProducts.filter(p => {
            const norm = (str) => str ? str.toLowerCase() : '';
            if (searchQuery) {
                const textMatch = norm(p.name).includes(searchQuery) || norm(p.description).includes(searchQuery) || norm(p.category).includes(searchQuery) || norm(p.subcategory).includes(searchQuery) || (p.tags && p.tags.some(t => norm(t).includes(searchQuery)));
                if (!textMatch) return false;
            }
            if (excludeKey !== 'category' && activeFilters.category.length > 0) { if (!activeFilters.category.some(f => norm(p.category) === norm(f))) return false; }
            if (excludeKey !== 'subcategory' && activeFilters.subcategory.length > 0) { if (!activeFilters.subcategory.some(f => norm(p.subcategory) === norm(f))) return false; }
            if (excludeKey !== 'brand' && activeFilters.brand.length > 0) { if (!activeFilters.brand.some(f => norm(p.brand) === norm(f))) return false; }
            if (excludeKey !== 'color' && activeFilters.color.length > 0) {
                const pColors = new Set(); if (p.color) pColors.add(norm(p.color)); if (p.combinations) p.combinations.forEach(c => { if(c.color) pColors.add(norm(c.color)); });
                if (!activeFilters.color.some(f => pColors.has(norm(f)))) return false;
            }
            if (excludeKey !== 'capacity' && activeFilters.capacity.length > 0) {
                const pCaps = new Set(); if (p.capacity) pCaps.add(norm(p.capacity)); if (p.combinations) p.combinations.forEach(c => { if(c.capacity) pCaps.add(norm(c.capacity)); });
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
            } else { if (p[key]) values = [p[key]]; }
            values.forEach(val => { if (val && val.trim() !== '') { const cleanVal = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase(); counts[cleanVal] = (counts[cleanVal] || 0) + 1; } });
        });
        return Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
    };

    const sections = [];
    sections.push({ id: 'category', label: 'Categorías', items: extractCounts('category', false, getPoolForCounting('category')) });
    if (activeFilters.category.length > 0) {
        const subItems = extractCounts('subcategory', false, getPoolForCounting('subcategory'));
        if (subItems.length > 0) sections.push({ id: 'subcategory', label: 'Subcategorías', items: subItems });
    }
    sections.push({ id: 'brand', label: 'Marcas', items: extractCounts('brand', false, getPoolForCounting('brand')) });
    sections.push({ id: 'color', label: 'Color', items: extractCounts('color', true, getPoolForCounting('color')) });
    sections.push({ id: 'capacity', label: 'Capacidad', items: extractCounts('capacity', true, getPoolForCounting('capacity')) });

    let html = '';
    sections.forEach(sec => {
        if (sec.items.length === 0) return;
        const currentActive = activeFilters[sec.id] || [];
        html += `<div class="border-b border-gray-50 pb-6 last:border-0"><h4 class="font-black text-xs uppercase text-brand-black mb-4">${sec.label}</h4><div class="space-y-2 max-h-48 overflow-y-auto custom-scroll pr-2">${sec.items.map(item => { const isChecked = currentActive.some(val => val.toLowerCase() === item.label.toLowerCase()); return `<div class="flex items-center gap-3 group cursor-pointer hover:bg-slate-50 p-1.5 rounded-xl transition"><input type="checkbox" id="${sec.id}-${item.label}" value="${item.label}" class="filter-checkbox appearance-none w-4 h-4 border-2 border-gray-200 rounded-md checked:bg-brand-cyan checked:border-brand-cyan transition cursor-pointer shrink-0" onchange="window.toggleFilter('${sec.id}', '${item.label}')" ${isChecked ? 'checked' : ''}><label for="${sec.id}-${item.label}" class="flex-grow flex justify-between items-center cursor-pointer select-none"><span class="text-[11px] font-bold text-gray-600 uppercase tracking-wide group-hover:text-brand-cyan transition truncate mr-2">${item.label}</span><span class="text-[10px] font-black text-brand-black bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md transition min-w-[24px] text-center">${item.count}</span></label></div>` }).join('')}</div></div>`;
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
    Object.keys(activeFilters).forEach(key => { activeFilters[key].forEach(val => { const els = document.querySelectorAll(`input[id="${key}-${val}"]`); els.forEach(el => el.checked = true); }); });
}
window.clearAllFilters = () => { Object.keys(activeFilters).forEach(key => activeFilters[key] = []); document.querySelectorAll('.filter-checkbox').forEach(cb => cb.checked = false); renderFiltersUI(); applySortAndFilter(); if(window.innerWidth < 1024) toggleDrawer(false); };
window.setSort = (value, label) => { currentSort = value; sortLabel.textContent = label; sortDropdown.classList.add('hidden'); sortIcon.classList.remove('rotate-180'); applySortAndFilter(); };
if (sortTrigger) sortTrigger.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = sortDropdown.classList.contains('hidden'); if (isHidden) { sortDropdown.classList.remove('hidden'); sortIcon.classList.add('rotate-180'); } else { sortDropdown.classList.add('hidden'); sortIcon.classList.remove('rotate-180'); } });
document.addEventListener('click', (e) => { if (sortTrigger && !sortTrigger.contains(e.target) && !sortDropdown.contains(e.target)) { sortDropdown.classList.add('hidden'); sortIcon.classList.remove('rotate-180'); } });

function applySortAndFilter() {
    filteredProducts = allProducts.filter(p => {
        const norm = (str) => str ? str.toLowerCase() : '';
        if (searchQuery) { const textMatch = norm(p.name).includes(searchQuery) || norm(p.description).includes(searchQuery) || norm(p.category).includes(searchQuery) || norm(p.subcategory).includes(searchQuery) || (p.tags && p.tags.some(t => norm(t).includes(searchQuery))); if (!textMatch) return false; }
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
        const dateA = a.updatedAt ? (a.updatedAt.seconds || new Date(a.updatedAt).getTime()) : 0;
        const dateB = b.updatedAt ? (b.updatedAt.seconds || new Date(b.updatedAt).getTime()) : 0;
        return dateB - dateA;
    });
    currentPage = 1;
    if(countLabel) countLabel.textContent = filteredProducts.length;
    const hasActiveFilters = Object.values(activeFilters).some(arr => arr.length > 0) || searchQuery !== "";
    if (btnClear) { if (hasActiveFilters) { btnClear.classList.remove('hidden'); btnClear.classList.add('flex'); } else { btnClear.classList.add('hidden'); btnClear.classList.remove('flex'); } }
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

initSearch();