import { db, collection, query, where, onSnapshot } from "../firebase-init.js";
import { addToCart, updateCartCount, getProductQtyInCart, removeOneUnit } from "./cart.js";
import { SmartCache } from "./cache-service.js";

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

/* ==========================================================================
   🎨 MAPA DE COLORES EXPORTABLE (Sincronizado con app.js y global-components)
   ========================================================================== */
const colorMap = {
    "negro": "#171717", "black": "#171717", "blanco": "#F9FAFB", "white": "#F9FAFB",
    "azul": "#2563EB", "blue": "#2563EB", "rojo": "#DC2626", "red": "#DC2626",
    "verde": "#16A34A", "green": "#16A34A", "gris": "#4B5563", "gray": "#4B5563",
    "plateado": "#E5E7EB", "silver": "#E5E7EB", "dorado": "#FCD34D", "gold": "#FCD34D",
    "morado": "#9333EA", "purple": "#9333EA", "rosa": "#EC4899", "pink": "#EC4899",
    "titanio": "#9CA3AF", "natural": "#D4D4D8"
};

function getColorHex(name) {
    if (!name) return '#E5E7EB';
    if (name.startsWith('#')) return name; 
    if (/^[0-9A-Fa-f]{6}$/i.test(name)) return `#${name}`; 
    return colorMap[name.toLowerCase()] || name; 
}

// --- 1. INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar SmartCache de Categorías/Marcas antes de pintar
    await SmartCache.init();

    // Recargar el banner de marcas si se actualiza asíncronamente
    window.addEventListener('brandsUpdated', () => {
        loadBrandsMarquee();
    });

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

    // Iniciamos el motor inteligente en tiempo real para el catálogo
    SmartCatalogSync.init();

    // Pintar el carrusel superior de marcas
    loadBrandsMarquee();
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
   🧠 SMART REAL-TIME CACHE (Máxima Eficiencia para el Catálogo)
   ========================================================================== */
const SmartCatalogSync = {
    STORAGE_KEY: 'smartech_master_catalog',
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
            console.log("🔄 [Catálogo] Escuchando actualizaciones en vivo desde:", new Date(lastSyncTime).toLocaleString());
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

/* ==========================================================================
   🎠 MOTOR DE CARRUSEL DE MARCAS Y AUTO-SCROLL INFINITO (Estilo Home)
   ========================================================================== */
window.activeCarousels = {};

window.scrollCarousel = (trackId, offset, isVertical = false) => {
    const track = document.getElementById(trackId);
    if (track) {
        track.style.scrollBehavior = 'smooth';
        isVertical ? track.scrollBy({ top: offset, behavior: 'smooth' }) : track.scrollBy({ left: offset, behavior: 'smooth' });
        setTimeout(() => { if (track) track.style.scrollBehavior = 'auto'; }, 400);
    }
};

function initAutoScroll(trackId, speed = 1) {
    const track = document.getElementById(trackId);
    if (!track) return;

    track.style.scrollBehavior = 'auto';

    let isHovered = false;
    track.addEventListener('mouseenter', () => isHovered = true);
    track.addEventListener('mouseleave', () => isHovered = false);
    track.addEventListener('touchstart', () => isHovered = true, { passive: true });
    track.addEventListener('touchend', () => isHovered = false);

    if (window.activeCarousels[trackId]) cancelAnimationFrame(window.activeCarousels[trackId]);

    let exactScroll = track.scrollLeft;

    function step() {
        if (!isHovered && track) {
            if (Math.abs(exactScroll - track.scrollLeft) > 2) {
                exactScroll = track.scrollLeft;
            }

            exactScroll += speed;
            const slides = track.children;
            if (slides.length > 0) {
                const halfIndex = Math.floor(slides.length / 2);
                const resetPoint = slides[halfIndex].offsetLeft;

                if (exactScroll >= resetPoint) {
                    exactScroll -= resetPoint;
                    track.scrollLeft = exactScroll;
                } else {
                    track.scrollLeft = exactScroll;
                }
            } else {
                const maxScrollable = track.scrollWidth - track.clientWidth;
                if (exactScroll >= maxScrollable) {
                    exactScroll = 0;
                }
                track.scrollLeft = exactScroll;
            }
        }
        window.activeCarousels[trackId] = requestAnimationFrame(step);
    }
    
    window.activeCarousels[trackId] = requestAnimationFrame(step);
}

function loadBrandsMarquee() {
    const area = document.getElementById('brands-carousel-area');
    if (!area) return;

    if (isPromoMode) {
        area.classList.add('hidden');
        return;
    }

    const brands = SmartCache.getBrands();
    if (brands.length === 0) return;

    // Inyectar el maquetado exacto del carrusel del Home sin títulos de sección, con espaciado ajustado
    area.className = "mb-2 relative group/brands w-full";
    area.innerHTML = `
        <button onclick="window.scrollCarousel('brands-track-container', -300)" class="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-10 h-10 bg-white border border-gray-100 rounded-full shadow-lg flex items-center justify-center text-brand-black hover:text-brand-orange transition-all opacity-0 group-hover/brands:opacity-100 -translate-x-4 hidden md:flex"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="relative w-full overflow-hidden mask-fade">
            <div id="brands-track-container" class="flex gap-4 overflow-x-auto no-scrollbar py-1 items-center">
            </div>
        </div>
        <button onclick="window.scrollCarousel('brands-track-container', 300)" class="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-10 h-10 bg-white border border-gray-100 rounded-full shadow-lg flex items-center justify-center text-brand-black hover:text-brand-orange transition-all opacity-0 group-hover/brands:opacity-100 translate-x-4 hidden md:flex"><i class="fa-solid fa-chevron-right"></i></button>
    `;

    const track = document.getElementById('brands-track-container');
    if (!track) return;

    let displayBrands = [...brands, ...brands, ...brands, ...brands];

    track.innerHTML = displayBrands.map(b => `
        <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="bg-white border border-gray-100 rounded-2xl h-24 w-40 flex items-center justify-center p-4 hover:border-brand-orange hover:shadow-[0_10px_20px_rgba(240,90,40,0.1)] hover:-translate-y-2 transition-all duration-300 cursor-pointer group shrink-0">
            <img src="${b.image || 'https://placehold.co/100'}" class="max-h-full max-w-full object-contain opacity-60 group-hover:opacity-100 group-hover:scale-125 transition duration-500 mix-blend-multiply drop-shadow-sm group-hover:drop-shadow-lg" alt="${b.name}">
        </a>
    `).join('');

    initAutoScroll('brands-track-container', 1.5);
}

/* ==========================================================================
   🛠️ GENERADOR DE TARJETAS ULTRA-PREMIUM UNIFICADO
   ========================================================================== */
function getCardActionBtnHTML(p, style, cardToken) {
    const isOutOfStock = (p.stock || 0) <= 0;
    const hasVariants = (p.hasVariants && p.variants?.length > 0) || (p.hasCapacities && p.capacities?.length > 0);
    const qtyInCart = getProductQtyInCart(p.id);

    // Si es una tarjeta de búsqueda o catálogo, aplicar botones anchos ultra-premium
    if (cardToken && (cardToken.startsWith("search_") || cardToken.startsWith("catalog_"))) {
        if (isOutOfStock) {
            return `
            <div class="w-full h-10 bg-gray-100 text-gray-400 text-[10px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 cursor-not-allowed border border-gray-200">
                <span>Agotado</span> <i class="fa-solid fa-circle-xmark"></i>
            </div>`;
        }
        
        if (hasVariants) {
            let badgeHTML = qtyInCart > 0 ? `<span class="absolute -top-1.5 -right-1.5 bg-brand-orange text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center shadow-sm animate-in-up border border-white z-10">${qtyInCart}</span>` : '';
            return `
            <button onclick="event.stopPropagation(); window.openCardOverlay('${p.id}', '${cardToken}')" class="relative w-full h-10 bg-brand-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-brand-orange hover:text-brand-black transition duration-300 rounded-xl flex items-center justify-center gap-2 active:scale-95 shadow-sm border border-brand-black hover:border-brand-orange">
                <span>Ver Opciones</span> <i class="fa-solid fa-list-ul"></i>
                ${badgeHTML}
            </button>`;
        } else {
            if (qtyInCart > 0) {
                return `
                <div class="flex items-center bg-brand-black text-white rounded-xl shadow-md overflow-hidden h-10 w-full border border-brand-black" onclick="event.stopPropagation()">
                    <button onclick="window.updateCardQty('${p.id}', -1)" class="w-10 h-full flex items-center justify-center text-gray-300 hover:bg-brand-orange hover:text-white transition active:scale-95"><i class="fa-solid fa-minus text-[10px]"></i></button>
                    <span class="flex-1 text-center text-xs font-black">${qtyInCart}</span>
                    <button onclick="window.updateCardQty('${p.id}', 1)" class="w-10 h-full flex items-center justify-center text-gray-300 hover:bg-brand-orange hover:text-white transition active:scale-95"><i class="fa-solid fa-plus text-[10px]"></i></button>
                </div>`;
            } else {
                return `
                <button onclick="event.stopPropagation(); window.updateCardQty('${p.id}', 1)" class="w-full h-10 bg-brand-black text-white text-[10px] font-black uppercase tracking-widest hover:bg-brand-orange hover:text-brand-black transition duration-300 rounded-xl flex items-center justify-center gap-2 active:scale-95 shadow-sm border border-brand-black hover:border-brand-orange">
                    <span>Agregar</span> <i class="fa-solid fa-cart-plus"></i>
                </button>`;
            }
        }
    }

    let actionBtnHTML = "";
    if(!isOutOfStock) {
        if(hasVariants) {
            let badgeHTML = qtyInCart > 0 ? `<span class="absolute -top-2 -right-2 bg-brand-orange text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-sm animate-in-up">${qtyInCart}</span>` : '';
            
            if (style === "compact") {
                actionBtnHTML = `<button onclick="event.stopPropagation(); window.openCardOverlay('${p.id}', '${cardToken}')" class="relative w-8 h-8 rounded-full bg-gray-50 border border-gray-100 text-gray-500 hover:bg-brand-orange hover:text-white transition flex items-center justify-center shadow-sm hover:shadow-md hover:-translate-y-0.5" title="Ver Opciones"><i class="fa-solid fa-list-ul text-[10px]"></i>${badgeHTML}</button>`;
            } else {
                actionBtnHTML = `<button onclick="event.stopPropagation(); window.openCardOverlay('${p.id}', '${cardToken}')" class="relative h-8 px-3.5 rounded-xl bg-gray-50 border border-gray-100 text-[9px] font-black text-gray-500 hover:bg-brand-orange hover:text-white flex items-center gap-1.5 uppercase tracking-widest transition shadow-sm">${badgeHTML}<i class="fa-solid fa-list-ul"></i> Opciones</button>`;
            }
        } else {
            if (qtyInCart > 0) {
                if (style === "compact") {
                    actionBtnHTML = `
                    <div class="flex items-center bg-gray-50 rounded-full border border-gray-200 shadow-sm overflow-hidden h-8 w-24 mx-auto" onclick="event.stopPropagation()">
                        <button onclick="window.updateCardQty('${p.id}', -1)" class="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-200 transition"><i class="fa-solid fa-minus text-[10px]"></i></button>
                        <span class="flex-1 text-center text-xs font-black text-brand-black">${qtyInCart}</span>
                        <button onclick="window.updateCardQty('${p.id}', 1)" class="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-brand-orange hover:text-white transition"><i class="fa-solid fa-plus text-[10px]"></i></button>
                    </div>`;
                } else {
                    actionBtnHTML = `
                    <div class="flex items-center bg-gray-50 rounded-xl border border-gray-200 shadow-sm overflow-hidden h-8 w-24" onclick="event.stopPropagation()">
                        <button onclick="window.updateCardQty('${p.id}', -1)" class="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-200 transition"><i class="fa-solid fa-minus text-[9px]"></i></button>
                        <span class="flex-1 text-center text-[10px] font-black text-brand-black">${qtyInCart}</span>
                        <button onclick="window.updateCardQty('${p.id}', 1)" class="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-brand-orange hover:text-white transition"><i class="fa-solid fa-plus text-[9px]"></i></button>
                    </div>`;
                }
            } else {
                if (style === "compact") {
                    actionBtnHTML = `<button onclick="event.stopPropagation(); window.updateCardQty('${p.id}', 1)" class="w-8 h-8 rounded-full bg-gray-50 border border-gray-100 text-gray-500 hover:bg-brand-orange hover:text-white transition flex items-center justify-center shadow-sm hover:shadow-md hover:-translate-y-0.5" title="Agregar"><i class="fa-solid fa-cart-plus text-[10px]"></i></button>`;
                } else {
                    actionBtnHTML = `<button onclick="event.stopPropagation(); window.updateCardQty('${p.id}', 1)" class="h-8 px-3.5 rounded-xl bg-gray-50 border border-gray-100 text-[9px] font-black text-gray-500 hover:bg-brand-orange hover:text-white flex items-center gap-1.5 uppercase tracking-widest transition shadow-sm"><i class="fa-solid fa-cart-plus"></i> Agregar</button>`;
                }
            }
        }
    } else {
        actionBtnHTML = `<span class="text-[9px] text-red-500 font-black uppercase tracking-widest h-8 flex items-center px-2">Agotado</span>`;
    }
    return actionBtnHTML;
}

function createProductCard(p, style = "normal", prefix = "grid") {
    const isOutOfStock = (p.stock || 0) <= 0;
    const hasDiscount = !isOutOfStock && (p.originalPrice && p.originalPrice > p.price);
    const cardToken = `${prefix}_${Math.random().toString(36).substr(2, 5)}_${p.id}`;

    let containerClasses = "";
    let contentHTML = "";

    const actionContainerHTML = `<div class="product-action-container ${(prefix === 'search' || prefix === 'catalog') ? 'w-full mt-4' : 'flex justify-end'}" data-product-id="${p.id}" data-card-style="${style}" data-card-token="${cardToken}">${getCardActionBtnHTML(p, style, cardToken)}</div>`;
    const overlayHTML = `<div id="overlay-${cardToken}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

    if (style === "compact") {
        if (prefix === "search" || prefix === "catalog") {
            // Estructura ultra premium unificada para el grid de la página de búsqueda / catálogo
            containerClasses = "group bg-white rounded-[2rem] border border-gray-100 overflow-hidden transition-all duration-300 hover:border-brand-orange/30 hover:shadow-[0_20px_50px_rgba(240,90,40,0.12)] hover:-translate-y-1.5 flex flex-col justify-between p-5 cursor-pointer h-full relative shadow-sm";
            
            let badge = hasDiscount ? `<span class="absolute top-4 left-4 bg-brand-red text-white text-[10px] font-black px-2 py-1 rounded shadow-sm z-10">-${Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)}%</span>` : '';
            if(isOutOfStock) badge = `<span class="absolute top-4 left-4 bg-gray-400 text-white text-[10px] font-black px-2 py-1 rounded shadow-sm z-10">Agotado</span>`;

            contentHTML = `
                ${badge}
                ${overlayHTML}
                
                <!-- Contenedor de la Imagen con fondo suave y zoom al hover -->
                <div class="relative w-full h-48 md:h-56 mb-4 bg-slate-50/80 rounded-2xl flex items-center justify-center p-4 overflow-hidden group-hover:bg-brand-orange/5 transition-colors duration-500">
                    <img src="${p.mainImage || p.image || 'https://placehold.co/200'}" class="max-h-full max-w-full object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-700" loading="lazy">
                </div>

                <!-- Detalles Centrados del Producto -->
                <div class="flex-grow flex flex-col justify-between text-center px-1">
                    <div class="mb-3">
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">${p.category || p.subcategory || 'Smartech'}</p>
                        <h3 class="text-xs md:text-sm font-bold text-gray-800 leading-snug line-clamp-2 h-10 group-hover:text-brand-orange transition-colors" title="${p.name}">
                            ${p.name}
                        </h3>
                    </div>

                    <div class="mt-auto flex flex-col items-center">
                        <!-- Precios Centrados -->
                        <div class="flex flex-col items-center mb-1">
                            ${hasDiscount ? `<span class="line-through text-gray-400 text-xs font-normal mb-0.5">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                            <span class="font-black text-lg md:text-xl text-brand-orange">
                                $${p.price.toLocaleString('es-CO')}
                            </span>
                        </div>
                        
                        <!-- Botón de Acción Ancho Completo -->
                        ${actionContainerHTML}
                    </div>
                </div>`;
        } else {
            containerClasses = "p-5 border-b lg:border-b-0 lg:border-r last:border-r-0 border-gray-200 hover:shadow-[0_0_20px_rgba(0,0,0,0.08)] hover:z-10 transition duration-300 flex flex-col justify-between bg-white relative group cursor-pointer h-full";
            
            let badge = hasDiscount ? `<span class="absolute top-4 left-4 bg-brand-red text-white text-[10px] font-black px-2 py-1 rounded shadow-sm z-10">-${Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)}%</span>` : '';
            if(isOutOfStock) badge = `<span class="absolute top-4 left-4 bg-gray-400 text-white text-[10px] font-black px-2 py-1 rounded shadow-sm z-10">Agotado</span>`;

            contentHTML = `
                ${badge}
                ${overlayHTML}
                <div>
                    <div class="relative w-full h-32 mb-4 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform duration-500">
                        <img src="${p.mainImage || p.image || 'https://placehold.co/200'}" class="max-h-full max-w-full object-contain mix-blend-multiply" loading="lazy">
                    </div>
                    <h3 class="text-sm font-bold text-gray-700 leading-snug mb-2 line-clamp-2 h-11 group-hover:text-brand-orange transition-colors" title="${p.name}">${p.name}</h3>
                </div>
                <div>
                    <div class="font-bold text-lg text-brand-orange flex items-center justify-between">
                        <div>
                            ${hasDiscount ? `<span class="line-through text-gray-400 text-xs font-normal mr-2">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                            $${p.price.toLocaleString('es-CO')}
                        </div>
                        ${actionContainerHTML}
                    </div>
                </div>`;
        }
    } 
    else {
        containerClasses = "border border-gray-100 rounded-2xl p-3 flex gap-4 items-center hover:shadow-lg hover:border-brand-orange/30 transition bg-white relative cursor-pointer group h-full";
        
        let badge = hasDiscount ? `<span class="absolute top-2 left-2 bg-brand-red text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm z-10">-${Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)}%</span>` : '';

        contentHTML = `
            ${badge}
            ${overlayHTML}
            <div class="w-1/3 h-24 shrink-0 bg-gray-50 rounded-xl p-2 flex items-center justify-center group-hover:bg-brand-orange/5 transition-colors border border-gray-50 overflow-hidden">
                <img src="${p.mainImage || p.image}" class="max-h-full max-w-full object-contain group-hover:scale-110 transition duration-500 mix-blend-multiply" loading="lazy">
            </div>
            <div class="w-2/3 flex flex-col justify-center py-1 pr-1">
                <p class="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-0.5">${p.category || 'Tienda'}</p>
                <h4 class="text-[10px] font-black text-brand-black uppercase leading-tight mb-1 line-clamp-2 group-hover:text-brand-orange transition">${p.name}</h4>
                <div class="font-black text-sm text-brand-orange mb-2 leading-none">
                    ${hasDiscount ? `<span class="inline-block line-through text-gray-400 text-[9px] font-normal mr-1">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                    $${p.price.toLocaleString('es-CO')}
                </div>
                <div class="flex items-center justify-between mt-auto">
                    ${actionContainerHTML}
                </div>
            </div>`;
    }

    const clickAction = isOutOfStock ? "" : `window.location.href='/shop/product.html?id=${p.id}'`;
    return `<div class="${containerClasses}" onclick="${clickAction}">${contentHTML}</div>`;
}

/* ==========================================================================
   ⚡ INTERACTIVIDAD PREMIUM Y CONTROLADORES DE EVENTOS EN VENTANA (UNIFICADO)
   ========================================================================== */
window.openCardOverlay = (id, cardToken) => {
    event.stopPropagation();
    const p = SmartCache.getProduct(id); 
    const overlay = document.getElementById(`overlay-${cardToken}`);
    
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
    <div class="absolute inset-0 z-50 bg-white flex flex-col h-full w-full p-4 rounded-[inherit] shadow-inner" onclick="event.stopPropagation()">
        
        <div class="flex justify-between items-center border-b border-gray-100 pb-2.5 mb-2 shrink-0">
            <h4 class="text-[10px] font-black uppercase text-brand-black tracking-widest">Personalizar artículo</h4>
            <button onclick="window.closeCardOverlay('${cardToken}')" class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-brand-red transition rounded-full bg-gray-50 active:scale-90">
                <i class="fa-solid fa-xmark text-[10px]"></i>
            </button>
        </div>
        
        <div class="flex-grow flex flex-col justify-center gap-5 overflow-y-auto no-scrollbar py-2" id="overlay-opts-${cardToken}" data-id="${id}">`;

    if (p.hasVariants && p.variants?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2.5 text-center">Selecciona Color</p>
            <div class="flex flex-wrap gap-3 justify-center">`;
        p.variants.forEach((v, idx) => {
            const isLight = ['blanco', 'white', 'plateado', 'silver'].includes(v.color.toLowerCase());
            html += `
                <button onclick="window.selectVariantOption('${cardToken}', 'color', '${v.color}', this)" 
                    class="w-7 h-7 rounded-full shadow-sm hover:scale-110 transition-all var-btn-color ring-2 ring-offset-2 ${idx===0 ? 'ring-brand-orange scale-110' : 'ring-transparent'} ${isLight ? 'border border-gray-300' : ''}" 
                    style="background-color: ${getColorHex(v.color)}" 
                    data-val="${v.color}">
                </button>`;
        });
        html += `</div></div>`;
    }

    if (p.hasCapacities && p.capacities?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2.5 text-center">Selecciona Capacidad</p>
            <div class="flex flex-wrap gap-2 justify-center">`;
        p.capacities.forEach((c, idx) => {
            html += `
                <button onclick="window.selectVariantOption('${cardToken}', 'capacity', '${c.label}', this)" 
                    class="px-3.5 py-2 rounded-xl border-2 text-[9px] font-black uppercase tracking-wider transition-all var-btn-cap ${idx===0 ? 'bg-brand-black text-white border-brand-black shadow-sm scale-105' : 'bg-gray-50 text-gray-500 border-transparent hover:border-brand-orange'}" 
                    data-val="${c.label}">
                    ${c.label}
                </button>`;
        });
        html += `</div></div>`;
    }
    
    html += `
    <div class="w-full">
        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2.5 text-center">Cantidad</p>
        <div class="flex items-center justify-center gap-3 bg-gray-50 rounded-full border border-gray-100 shadow-inner h-10 w-40 mx-auto p-0.5 relative z-10" onclick="event.stopPropagation()">
            <button onclick="window.updateVariantQty('${cardToken}', -1)" class="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition rounded-full active:scale-90"><i class="fa-solid fa-minus text-[10px]"></i></button>
            <span class="flex-1 text-center text-base font-black text-brand-black" id="overlay-qty-display-${cardToken}">1</span>
            <button onclick="window.updateVariantQty('${cardToken}', 1)" class="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-brand-orange hover:text-white transition rounded-full active:scale-90"><i class="fa-solid fa-plus text-[10px]"></i></button>
        </div>
    </div>`;

    html += `</div>
        
        <div class="mt-auto shrink-0 pt-2 border-t border-dashed border-gray-100">
            <div class="flex justify-between items-center mb-2.5 px-1">
                <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total:</span>
                <span class="text-sm font-black text-brand-orange tracking-tight" id="overlay-price-${cardToken}">$${initialPrice.toLocaleString('es-CO')}</span>
            </div>
            <button onclick="window.confirmAdd('${cardToken}')" class="w-full bg-brand-orange text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-[0.2em] hover:bg-orange-600 transition shadow-md active:scale-95 flex items-center justify-center gap-2">
                <span>Confirmar adición</span> <i class="fa-solid fa-cart-plus text-[10px]"></i>
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

    const container = document.getElementById(`overlay-opts-${cardToken}`);
    container.dataset.selColor = initialColor || "";
    container.dataset.selCap = initialCap || "";
};

window.closeCardOverlay = (uniqueId) => {
    event.stopPropagation();
    const overlay = document.getElementById(`overlay-${uniqueId}`);
    if (!overlay) return;
    overlay.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
    overlay.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
    setTimeout(() => { overlay.classList.add('hidden'); overlay.innerHTML = ''; }, 300);
};

window.selectVariantOption = (context, type, val, btn) => {
    event.stopPropagation();
    const container = context === 'modal' ? document.getElementById('modal-options-container') : document.getElementById(`overlay-opts-${context}`);
    if (!container) return;

    const id = container.dataset.id;
    const p = SmartCache.getProduct(id); 

    if (type === 'color') {
        container.dataset.selColor = val;
        const parent = btn.parentElement;
        parent.querySelectorAll('.var-btn-color').forEach(b => {
            b.classList.remove('!ring-brand-orange', 'ring-brand-orange', 'scale-110');
            b.classList.add('ring-transparent');
        });
        btn.classList.remove('ring-transparent');
        btn.classList.add(context === 'modal' ? '!ring-brand-orange' : 'ring-brand-orange', 'scale-110');
        if (context === 'modal' && btn.dataset.img) document.getElementById('modal-product-img').src = btn.dataset.img;
    }
    if (type === 'capacity') {
        container.dataset.selCap = val;
        const parent = btn.parentElement;
        parent.querySelectorAll('.var-btn-cap').forEach(b => {
            b.className = context === 'modal'
                ? "px-4 py-2 rounded-xl border-2 border-gray-100 text-gray-400 text-[10px] font-black uppercase transition-all var-btn-cap hover:border-brand-orange hover:text-brand-orange"
                : "px-3 py-1.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-wider transition-all var-btn-cap bg-gray-50 text-gray-500 border-transparent hover:border-brand-orange";
        });
        btn.className = context === 'modal'
            ? "px-4 py-2 rounded-xl border-2 border-brand-black bg-brand-black text-white text-[10px] font-black uppercase transition-all var-btn-cap shadow-lg scale-105"
            : "px-3 py-1.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-wider transition-all var-btn-cap bg-brand-black text-white border-brand-black shadow-sm scale-105";
    }

    const curColor = container.dataset.selColor;
    const curCap = container.dataset.selCap;
    let newPrice = p.price;
    let maxStock = p.stock || 0;

    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => (c.color === curColor || !c.color) && (c.capacity === curCap || !c.capacity));
        if (combo) {
            newPrice = combo.price;
            maxStock = combo.stock || 0;
        }
    } else if (p.capacities && curCap) {
        const c = p.capacities.find(x => x.label === curCap);
        if (c) newPrice = c.price;
    }

    let qtySpan = context === 'modal' ? document.getElementById('modal-qty-display') : document.getElementById(`overlay-qty-display-${context}`);
    let currentQty = qtySpan ? (parseInt(qtySpan.textContent) || 1) : 1;
    
    if (maxStock <= 0) {
        currentQty = 0;
    } else if (currentQty > maxStock) {
        currentQty = maxStock;
    } else if (currentQty < 1) {
        currentQty = 1;
    }
    if (qtySpan) qtySpan.textContent = currentQty;

    const confirmBtn = container.parentElement.querySelector('button[onclick*="confirmAdd"]');
    if (confirmBtn) {
        if (maxStock <= 0) {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-400');
            confirmBtn.classList.remove('bg-brand-orange', 'hover:bg-orange-600');
            const btnTextEl = confirmBtn.querySelector('span');
            if (btnTextEl) btnTextEl.textContent = "Agotado";
        } else {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-400');
            confirmBtn.classList.add('bg-brand-orange', 'hover:bg-orange-600');
            const btnTextEl = confirmBtn.querySelector('span');
            if (btnTextEl) btnTextEl.textContent = context === 'modal' ? "Confirmar" : "Confirmar adición";
        }
    }

    let totalPrice = newPrice * currentQty;
    let priceEl = context === 'modal' ? document.getElementById('modal-price-display') : document.getElementById(`overlay-price-${context}`);
    if (priceEl) {
        priceEl.style.opacity = '0.5';
        setTimeout(() => {
            priceEl.textContent = `$${totalPrice.toLocaleString('es-CO')}`;
            priceEl.style.opacity = '1';
        }, 150);
    }
};

window.confirmAdd = (context) => {
    event.stopPropagation();
    const container = context === 'modal' ? document.getElementById('modal-options-container') : document.getElementById(`overlay-opts-${context}`);
    if (!container) return;
    const id = container.dataset.id;
    const p = SmartCache.getProduct(id); 

    const selColor = container.dataset.selColor || null;
    const selCap = container.dataset.selCap || null;

    let finalPrice = p.price;
    let maxStock = p.stock || 0;

    if (selCap && p.capacities) {
        const c = p.capacities.find(x => x.label === selCap);
        if (c) finalPrice = c.price;
    }

    let finalImage = p.mainImage || p.image;
    if (selColor && p.variants) {
        const v = p.variants.find(x => x.color === selColor);
        if (v && v.images?.[0]) finalImage = v.images[0];
    }
    
    // Resolve combinations stock
    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => 
            (c.color === selColor || !selColor) && 
            (c.capacity === selCap || !selCap)
        );
        if (combo) {
            maxStock = combo.stock !== undefined ? combo.stock : 0;
            finalPrice = combo.price || finalPrice;
        }
    }
    
    let qtySpan = context === 'modal' ? document.getElementById('modal-qty-display') : document.getElementById(`overlay-qty-display-${context}`);
    let quantityToAdd = parseInt(qtySpan.textContent) || 1;

    if (maxStock <= 0 || quantityToAdd <= 0) {
        window.showToast("Esta combinación no cuenta con inventario disponible.", "error");
        return;
    }

    addToCart({
        id: p.id, name: p.name, price: finalPrice, originalPrice: p.originalPrice || 0,
        image: finalImage, color: selColor, capacity: selCap, quantity: quantityToAdd,
        maxStock: maxStock
    });

    if (context === 'modal') window.closeGlobalModal();
    else window.closeCardOverlay(context);

    updateCartCount();
    window.updateAllProductCardsUI(); 
};

window.quickAdd = (id) => {
    event.stopPropagation();
    const p = SmartCache.getProduct(id); 
    if (!p) return;

    let finalPrice = p.price;
    let finalImage = p.mainImage || p.image;
    let selectedColor = null;
    let selectedCapacity = null;
    let maxStock = p.stock || 0;

    if (p.hasCapacities && p.capacities && p.capacities.length > 0) {
        selectedCapacity = p.capacities[0].label;
        finalPrice = p.capacities[0].price;
    }
    if (p.hasVariants && p.variants && p.variants.length > 0) {
        selectedColor = p.variants[0].color;
        if (p.variants[0].images && p.variants[0].images.length > 0) {
            finalImage = p.variants[0].images[0];
        }
    }

    // Resolve combinations stock
    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => 
            (c.color === selectedColor || !selectedColor) && 
            (c.capacity === selectedCapacity || !selectedCapacity)
        );
        if (combo) {
            maxStock = combo.stock !== undefined ? combo.stock : 0;
            finalPrice = combo.price || finalPrice;
        }
    }

    addToCart({
        id: p.id, name: p.name, price: finalPrice, originalPrice: p.originalPrice || 0,
        image: finalImage, color: selectedColor, capacity: selectedCapacity, quantity: 1,
        maxStock: maxStock
    });

    updateCartCount();
    window.updateAllProductCardsUI(); 
};

window.updateCardQty = (id, delta) => {
    event.stopPropagation();
    if (delta > 0) window.quickAdd(id);
    else removeOneUnit(id);
    updateCartCount();
    window.updateAllProductCardsUI(); 
};

window.updateVariantQty = (context, delta) => {
    event.stopPropagation();
    const container = context === 'modal' ? document.getElementById('modal-options-container') : document.getElementById(`overlay-opts-${context}`);
    if (!container) return;
    
    const id = container.dataset.id;
    const p = SmartCache.getProduct(id); 
    
    let qtySpan = context === 'modal' ? document.getElementById('modal-qty-display') : document.getElementById(`overlay-qty-display-${context}`);
    if (!qtySpan || !p) return;
    
    let currentQty = parseInt(qtySpan.textContent) || 1;
    currentQty += delta;

    const selColor = container.dataset.selColor || null;
    const selCap = container.dataset.selCap || null;

    let maxStock = p.stock || 0;
    let newPrice = p.price;

    if (selCap && p.capacities) {
        const c = p.capacities.find(x => x.label === selCap);
        if (c) newPrice = c.price;
    }

    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => 
            (c.color === selColor || !selColor) && 
            (c.capacity === selCap || !selCap)
        );
        if (combo) {
            maxStock = combo.stock !== undefined ? combo.stock : 0;
            newPrice = combo.price || newPrice;
        }
    }

    if (maxStock <= 0) {
        currentQty = 0;
    } else if (currentQty > maxStock) {
        currentQty = maxStock;
    } else if (currentQty < 1) {
        currentQty = 1;
    }
    if (qtySpan) qtySpan.textContent = currentQty;

    const confirmBtn = container.parentElement.querySelector('button[onclick*="confirmAdd"]');
    if (confirmBtn) {
        if (maxStock <= 0) {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-400');
            confirmBtn.classList.remove('bg-brand-orange', 'hover:bg-orange-600');
            const btnTextEl = confirmBtn.querySelector('span');
            if (btnTextEl) btnTextEl.textContent = "Agotado";
        } else {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-gray-400');
            confirmBtn.classList.add('bg-brand-orange', 'hover:bg-orange-600');
            const btnTextEl = confirmBtn.querySelector('span');
            if (btnTextEl) btnTextEl.textContent = context === 'modal' ? "Confirmar" : "Confirmar adición";
        }
    }

    let totalPrice = newPrice * currentQty;
    let priceEl = context === 'modal' ? document.getElementById('modal-price-display') : document.getElementById(`overlay-price-${context}`);
    if (priceEl) {
        priceEl.style.opacity = '0.5';
        setTimeout(() => {
            priceEl.textContent = `$${totalPrice.toLocaleString('es-CO')}`;
            priceEl.style.opacity = '1';
        }, 150);
    }
};

window.updateAllProductCardsUI = () => {
    document.querySelectorAll('.product-action-container').forEach(container => {
        const id = container.dataset.productId;
        const style = container.dataset.cardStyle;
        const token = container.dataset.cardToken;
        const p = SmartCache.getProduct(id);
        if (p) {
            container.innerHTML = getCardActionBtnHTML(p, style, token);
        }
    });
};

window.handleCartAction = (productId, delta) => {
    window.updateCardQty(productId, delta);
};

/* ==========================================================================
   🖼️ RENDER DEL GRID DE PRODUCTOS DE CATÁLOGO
   ========================================================================== */
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
        return createProductCard(p, "compact", "catalog");
    }).join('');
    
    if (currentPage > 1) {
        const header = document.getElementById('global-header');
        if (header) header.scrollIntoView({ behavior: 'smooth' });
    }
}

/* ==========================================================================
   🎛️ FILTROS DE INTERFAZ DE USUARIO Y NAVEGACIÓN
   ========================================================================== */
function renderFiltersUI() {
    const getPoolForCounting = (excludeKey) => {
        return allProducts.filter(p => {
            const norm = (str) => str ? str.toLowerCase() : '';
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
        html += `<div class="border-b border-gray-50 pb-6 last:border-0"><h4 class="font-black text-xs uppercase text-brand-black mb-4">${sec.label}</h4><div class="space-y-2 max-h-48 overflow-y-auto custom-scroll pr-2">${sec.items.map(item => { const isChecked = currentActive.some(val => val.toLowerCase() === item.label.toLowerCase()); return `<div class="flex items-center gap-3 group cursor-pointer hover:bg-slate-50 p-1.5 rounded-xl transition"><input type="checkbox" id="${sec.id}-${item.label}" value="${item.label}" class="filter-checkbox appearance-none w-4 h-4 border-2 border-gray-200 rounded-md checked:bg-brand-orange checked:border-brand-orange transition cursor-pointer shrink-0" onchange="window.toggleFilter('${sec.id}', '${item.label}')" ${isChecked ? 'checked' : ''}><label for="${sec.id}-${item.label}" class="flex-grow flex justify-between items-center cursor-pointer select-none"><span class="text-[11px] font-bold text-gray-600 uppercase tracking-wide group-hover:text-brand-orange transition truncate mr-2">${item.label}</span><span class="text-[10px] font-black text-brand-black bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-md transition min-w-[24px] text-center">${item.count}</span></label></div>` }).join('')}</div></div>`;
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
    const hasActiveFilters = Object.values(activeFilters).some(arr => arr.length > 0);
    if (btnClear) { if (hasActiveFilters) { btnClear.classList.remove('hidden'); btnClear.classList.add('flex'); } else { btnClear.classList.add('hidden'); btnClear.classList.remove('flex'); } }
    renderGrid();
    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) { paginationContainer.innerHTML = ''; return; }
    let html = `<button onclick="window.changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:border-brand-orange hover:text-brand-orange disabled:opacity-30 disabled:pointer-events-none transition"><i class="fa-solid fa-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += `<button onclick="window.changePage(${i})" class="w-10 h-10 flex items-center justify-center rounded-xl font-bold text-xs transition ${i === currentPage ? 'bg-brand-black text-white shadow-lg' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += `<span class="text-gray-300 font-bold text-xs">...</span>`;
        }
    }
    html += `<button onclick="window.changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:border-brand-orange hover:text-brand-orange disabled:opacity-30 disabled:pointer-events-none transition"><i class="fa-solid fa-chevron-right"></i></button>`;
    paginationContainer.innerHTML = html;
}
window.changePage = (p) => { currentPage = p; renderGrid(); renderPagination(); };

const openBtn = document.getElementById('btn-open-filters');
const closeBtn = document.getElementById('btn-close-filters');
const applyBtn = document.getElementById('btn-apply-mobile');
const toggleDrawer = (show) => {
    if (show) { 
        drawer.classList.remove('invisible');
        void drawer.offsetWidth; // Force reflow
        drawer.classList.remove('translate-x-full'); 
        mobileOverlay.classList.remove('hidden'); 
        setTimeout(()=>mobileOverlay.classList.remove('opacity-0'),10); 
    } 
    else { 
        drawer.classList.add('translate-x-full'); 
        mobileOverlay.classList.add('opacity-0'); 
        setTimeout(()=>{
            mobileOverlay.classList.add('hidden');
            drawer.classList.add('invisible');
        },300); 
    }
};
if(openBtn) openBtn.onclick = () => toggleDrawer(true);
if(closeBtn) closeBtn.onclick = () => toggleDrawer(false);
if(mobileOverlay) mobileOverlay.onclick = () => toggleDrawer(false);
if(applyBtn) applyBtn.onclick = () => toggleDrawer(false);