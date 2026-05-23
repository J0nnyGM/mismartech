import { db } from "../firebase-init.js";
import { addToCart, updateCartCount, removeOneUnit, getProductQtyInCart } from "./cart.js";
import { SmartCache } from "./cache-service.js"; // <--- CEREBRO CONECTADO

console.log("🚀 Smartech Store Iniciada - Modo Real-Time Total");

/* ==========================================================================
   LÓGICA HÍBRIDA MODERNA: MODAL GLOBAL + OVERLAY EN TARJETA (CON TOKENS ÚNICOS)
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

function getGlobalModal() {
    let modal = document.getElementById('global-variant-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-variant-modal';
        modal.className = "fixed inset-0 z-[100] hidden items-center justify-center p-4 bg-brand-black/60 backdrop-blur-sm transition-all duration-300 opacity-0";
        modal.onclick = (e) => { if (e.target === modal) window.closeGlobalModal(); };
        modal.innerHTML = `<div id="global-modal-content" class="bg-white w-full max-w-[340px] rounded-[2.5rem] shadow-2xl overflow-hidden transform scale-95 transition-all duration-300 relative flex flex-col max-h-[90vh]"></div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

window.openGlobalModal = (id) => {
    event.stopPropagation();
    const p = SmartCache.getProduct(id); 
    if (!p) return;

    const modal = getGlobalModal();
    const content = modal.querySelector('#global-modal-content');
    const img = p.mainImage || p.image || 'https://placehold.co/150';

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
    <div class="p-6 pb-4 text-center bg-gray-50/50 border-b border-gray-100 relative">
        <button onclick="window.closeGlobalModal()" class="absolute top-5 right-5 w-8 h-8 flex items-center justify-center bg-white border border-gray-100 rounded-full shadow-sm text-gray-400 hover:text-brand-red transition active:scale-90"><i class="fa-solid fa-xmark text-xs"></i></button>
        <div class="w-28 h-28 mx-auto bg-white rounded-2xl p-3 shadow-sm mb-3 flex items-center justify-center border border-gray-100"><img src="${img}" class="max-w-full max-h-full object-contain" id="modal-product-img"></div>
        <h3 class="font-black text-sm uppercase text-brand-black tracking-tight leading-tight max-w-[220px] mx-auto">${p.name}</h3>
        <p class="text-xl font-black text-brand-orange mt-2 tracking-tight" id="modal-price-display">$${initialPrice.toLocaleString('es-CO')}</p>
    </div>
    <div class="p-6 overflow-y-auto no-scrollbar space-y-6" id="modal-options-container" data-id="${id}">`;

    if (p.hasVariants && p.variants?.length > 0) {
        html += `<div><p class="text-[10px] font-black text-brand-black uppercase tracking-widest text-center mb-3.5">Escoge un Color</p><div class="flex flex-wrap justify-center gap-3.5">`;
        p.variants.forEach((v, idx) => {
            html += `<button onclick="window.selectVariantOption('modal', 'color', '${v.color}', this)" class="w-8 h-8 rounded-full shadow-md hover:scale-110 transition-all var-btn-color relative ring-2 ring-offset-2 ${idx === 0 ? 'ring-brand-orange scale-110' : 'ring-transparent'}" style="background-color: ${getColorHex(v.color)}" data-val="${v.color}" data-img="${v.images?.[0] || ''}"></button>`;
        });
        html += `</div></div>`;
    }
    if (p.hasCapacities && p.capacities?.length > 0) {
        html += `<div><p class="text-[10px] font-black text-brand-black uppercase tracking-widest text-center mb-3.5">Escoge Capacidad</p><div class="flex flex-wrap justify-center gap-2.5">`;
        p.capacities.forEach((c, idx) => {
            html += `<button onclick="window.selectVariantOption('modal', 'capacity', '${c.label}', this)" class="px-4 py-2.5 rounded-xl border-2 text-[10px] font-black uppercase tracking-wide transition-all var-btn-cap ${idx === 0 ? 'bg-brand-black text-white border-brand-black shadow-sm scale-105' : 'bg-gray-50 text-gray-400 border-transparent hover:border-gray-200 hover:text-brand-black'}" data-val="${c.label}">${c.label}</button>`;
        });
        html += `</div></div>`;
    }
    
    html += `
    <div><p class="text-[10px] font-black text-brand-black uppercase tracking-widest text-center mb-3.5">Cantidad</p>
    <div class="flex items-center justify-center gap-3 bg-gray-50 rounded-full border border-gray-100 shadow-inner h-12 w-48 mx-auto p-1 relative z-10" onclick="event.stopPropagation()">
        <button onclick="window.updateVariantQty('modal', -1)" class="w-10 h-10 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition rounded-full active:scale-90"><i class="fa-solid fa-minus text-xs"></i></button>
        <span class="flex-1 text-center text-lg font-black text-brand-black" id="modal-qty-display">1</span>
        <button onclick="window.updateVariantQty('modal', 1)" class="w-10 h-10 flex items-center justify-center text-gray-500 hover:bg-brand-orange hover:text-white transition rounded-full active:scale-90"><i class="fa-solid fa-plus text-xs"></i></button>
    </div></div>`;

    html += `</div>
    <div class="p-6 pt-0 mt-auto"><button onclick="window.confirmAdd('modal')" class="w-full bg-brand-orange text-white font-black py-4 rounded-2xl uppercase text-xs tracking-[0.2em] shadow-md hover:shadow-xl hover:bg-orange-600 transition-all active:scale-95 flex items-center justify-center gap-2.5"><span>Confirmar</span> <i class="fa-solid fa-check text-[9px]"></i></button></div>`;

    content.innerHTML = html;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => { modal.classList.remove('opacity-0'); modal.classList.add('flex'); content.classList.remove('scale-95'); content.classList.add('scale-100'); });

    const container = document.getElementById('modal-options-container');
    container.dataset.selColor = initialColor || "";
    container.dataset.selCap = initialCap || "";
};

window.closeGlobalModal = () => {
    const modal = document.getElementById('global-variant-modal');
    if (!modal) return;
    const content = modal.querySelector('#global-modal-content');
    modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('flex'); }, 300);
};

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

/* ==========================================================================
   ACTUALIZACIÓN INTELIGENTE DE BOTONES (SIN RECARGAR LA PÁGINA)
   ========================================================================== */
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
    
    const curColor = container.dataset.selColor;
    const curCap = container.dataset.selCap;
    let unitPrice = p.price;
    let maxStock = p.stock || 0;

    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => (c.color === curColor || !c.color) && (c.capacity === curCap || !c.capacity));
        if (combo) {
            unitPrice = combo.price;
            maxStock = combo.stock || 0;
        }
    } else if (p.capacities && curCap) {
        const c = p.capacities.find(x => x.label === curCap);
        if (c) unitPrice = c.price;
    }

    let currentQty = parseInt(qtySpan.textContent) || 1;
    currentQty += delta;
    
    if (maxStock <= 0) {
        currentQty = 0;
    } else {
        currentQty = Math.max(1, Math.min(currentQty, maxStock));
    }
    qtySpan.textContent = currentQty;

    let totalPrice = unitPrice * currentQty;
    let priceEl = context === 'modal' ? document.getElementById('modal-price-display') : document.getElementById(`overlay-price-${context}`);
    if (priceEl) {
        priceEl.textContent = `$${totalPrice.toLocaleString('es-CO')}`;
    }
};

function refreshAllGrids() {
    loadMainBanner();
    loadTripleBanners();
    renderBigPromoRandom();
    if (document.getElementById('featured-grid')) loadFeatured();
    loadExploreSection();
    loadPromotionsGrid();
    loadBestSellers();
    if (window.populateMegaMenus) window.populateMegaMenus();
}



/* ==========================================================================
   CARGADORES Y UI SMARTECH (DATOS DESDE SMARTCACHE)
   ========================================================================== */
function loadMainBanner() {
    const container = document.getElementById('main-hero-banner');
    if (!container) return;

    const allProductsCache = SmartCache.getAllProducts();
    let promos = allProductsCache.filter(p => p.isHeroPromo === true && p.stock > 0);
    if (promos.length === 0) promos = allProductsCache.filter(p => p.stock > 0).slice(0, 3);
    if (promos.length === 0) return;

    let html = '';
    promos.forEach((p, idx) => {
        const activeClass = idx === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none';
        const isCustom = !!p.promoBannerUrl;
        
        const bgImageWeb = p.promoBannerUrl || p.mainImage || p.image || 'https://placehold.co/1920x640';
        const bgImageMobile = p.promoBannerMobileUrl || bgImageWeb; 
        
        let contentHTML = '';
        if(isCustom) {
            contentHTML = `
                <div class="absolute inset-0 cursor-pointer group overflow-hidden bg-brand-black" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                    <picture class="absolute inset-0 w-full h-full block">
                        <source media="(max-width: 767px)" srcset="${bgImageMobile}">
                        <img src="${bgImageWeb}" class="w-full h-full object-fill transition duration-700 group-hover:scale-[1.01]" alt="${p.name}">
                    </picture>
                </div>
            `;
        } else {
            const hasDiscount = p.originalPrice && p.originalPrice > p.price;
            const discPercent = hasDiscount ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100) : 0;

            let priceHTML = '';
            if (hasDiscount) {
                priceHTML = `
                    <div class="flex items-center gap-2 md:gap-3 mb-3 md:mb-6 flex-wrap justify-start shrink-0">
                        <span class="text-sm md:text-3xl font-black text-brand-orange tracking-tight">$${p.price.toLocaleString('es-CO')}</span>
                        <span class="line-through text-gray-500 text-[10px] md:text-base font-semibold">$${p.originalPrice.toLocaleString('es-CO')}</span>
                        <span class="bg-brand-red text-white text-[7px] md:text-[10px] font-black px-1.5 py-0.5 md:py-1 rounded-md tracking-wider uppercase shadow-sm">-${discPercent}% DTO</span>
                    </div>
                `;
            } else {
                priceHTML = `
                    <div class="mb-3 md:mb-6 shrink-0">
                        <span class="text-sm md:text-3xl font-black text-white tracking-tight">$${p.price.toLocaleString('es-CO')}</span>
                    </div>
                `;
            }

            contentHTML = `
                <div class="absolute inset-0 bg-gradient-to-br from-gray-900 via-[#111111] to-black cursor-pointer group overflow-hidden" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                    
                    <div class="absolute right-0 bottom-0 w-[80%] h-[130%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-brand-orange/15 via-transparent to-transparent z-0 pointer-events-none transform translate-x-1/4 translate-y-1/4 group-hover:scale-110 transition-transform duration-1000"></div>
                    <div class="absolute inset-0 z-0 opacity-[0.07] pointer-events-none" style="background-image: radial-gradient(circle, #ffffff 1px, transparent 1px); background-size: 28px 28px;"></div>
                    <div class="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent z-0 pointer-events-none"></div>

                    <div class="flex flex-row w-full h-full relative z-10 p-4 md:p-14 items-center justify-between gap-4">
                        
                        <div class="w-[60%] md:w-[60%] flex flex-col justify-center text-left order-1 min-w-0">
                            <span class="text-brand-orange text-[8px] md:text-xs font-black uppercase tracking-[0.2em] mb-1 md:mb-3 flex items-center justify-start gap-1 md:gap-2 shrink-0">
                                <span class="w-3 h-0.5 bg-brand-orange hidden md:inline-block"></span> LO NUEVO DE ${p.brand || 'SMARTECH'}
                            </span>
                            
                            <h2 class="text-xs md:text-4xl lg:text-5xl font-black text-white leading-tight uppercase tracking-tight mb-1 md:mb-3 group-hover:text-brand-orange transition-colors duration-500 drop-shadow-xl line-clamp-2">
                                ${p.name}
                            </h2>
                            
                            <p class="text-gray-400 text-[8px] md:text-xs font-black uppercase tracking-widest mb-2 md:mb-4 shrink-0 truncate">
                                Categoría: <span class="text-white font-bold">${p.category || 'Tecnología'}</span>
                            </p>
                            
                            ${priceHTML}
                            
                            <button class="bg-brand-orange text-white font-black uppercase tracking-widest text-[8px] md:text-[9px] px-4 py-2 md:px-8 md:py-3.5 rounded-full w-max hover:bg-white hover:text-brand-orange transition-all flex items-center justify-center gap-1.5 md:gap-3 group/btn shadow-[0_10px_20px_rgba(240,90,40,0.15)] hover:shadow-xl active:scale-95 duration-300 shrink-0">
                                <span>Ver Producto</span> 
                                <i class="fa-solid fa-chevron-right text-[6px] md:text-[8px] group-hover/btn:translate-x-1 transition-transform"></i>
                            </button>
                        </div>
                        
                        <div class="w-[40%] md:w-[35%] h-[80%] md:h-[95%] flex items-center justify-center relative order-2 shrink-0 overflow-visible">
                            <div class="absolute w-24 h-24 md:w-64 md:h-64 bg-brand-orange/25 rounded-full blur-2xl group-hover:bg-brand-orange/35 transition duration-700 pointer-events-none"></div>
                            
                            <img src="${p.mainImage || p.image}" class="max-h-full md:max-h-[95%] object-contain drop-shadow-[0_0_15px_rgba(240,90,40,0.6)] md:drop-shadow-[0_10px_35px_rgba(240,90,40,0.45)] transform group-hover:scale-105 group-hover:-translate-y-0.5 transition-all duration-700 relative z-10 filter brightness-105">
                        </div>
                        
                    </div>
                </div>
            `;
        }
        html += `<div class="absolute inset-0 w-full h-full promo-slide transition-opacity duration-1000 ${activeClass}" data-idx="${idx}">${contentHTML}</div>`;
    });
    
    if (promos.length > 1) {
        html += `
            <button onclick="event.stopPropagation(); window.moveSlider('main-hero-banner', -1)" class="absolute left-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-brand-orange text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-md border border-white/5"><i class="fa-solid fa-chevron-left text-sm"></i></button>
            <button onclick="event.stopPropagation(); window.moveSlider('main-hero-banner', 1)" class="absolute right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-brand-orange text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 backdrop-blur-md border border-white/5"><i class="fa-solid fa-chevron-right text-sm"></i></button>
        `;
    }

    container.innerHTML = html;
    container.dataset.activeIdx = 0;
}

function loadTripleBanners() {
    const container = document.getElementById('triple-promo-grid');
    if (!container) return;

    const allProductsCache = SmartCache.getAllProducts();
    const allWithStock = allProductsCache.filter(p => p.stock > 0);
    const allPromos = allWithStock.filter(p => p.isNewLaunch || p.isHeroPromo || (p.originalPrice && p.originalPrice > p.price));

    let launchPool = [];
    let offerPool = [];

    if (allPromos.length === 2) {
        launchPool = [allPromos[0]];
        offerPool = [allPromos[1]];
    } 
    else if (allPromos.length === 1) {
        launchPool = [allPromos[0]];
        offerPool = allWithStock.filter(p => p.id !== allPromos[0].id);
    } 
    else if (allPromos.length === 0) {
        const shuffled = [...allWithStock].sort(() => 0.5 - Math.random());
        launchPool = [shuffled[0]];
        offerPool = shuffled.slice(1, 4);
    } 
    else {
        let rawNewLaunch = allPromos.filter(p => p.isNewLaunch);
        let rawHeroPromo = allPromos.filter(p => p.isHeroPromo || p.originalPrice > p.price);
        
        if (rawNewLaunch.length > 0) {
            launchPool = rawNewLaunch;
            offerPool = rawHeroPromo.filter(p => !launchPool.some(l => l.id === p.id));
        } else {
            const half = Math.ceil(allPromos.length / 2);
            launchPool = allPromos.slice(0, half);
            offerPool = allPromos.slice(half);
        }
    }

    if (offerPool.length === 0) {
        const launchIds = launchPool.map(p => p.id);
        offerPool = allWithStock.filter(p => !launchIds.includes(p.id));
    }

    let launchHTML = '';
    launchPool.forEach((p, idx) => {
        const activeClass = idx === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none';
        const isCustomLaunch = !!p.launchBannerUrl;
        const launchImgWeb = p.launchBannerUrl || p.mainImage || p.image;
        
        let slideContent = '';
        if (isCustomLaunch) {
            slideContent = `<img src="${launchImgWeb}" class="absolute inset-0 w-full h-full object-fill transition duration-500 group-hover:scale-[1.02]">`;
        } else {
            slideContent = `
                <div class="absolute inset-0 bg-gradient-to-br from-[#1c1c1f] via-brand-black to-black p-5 flex flex-row items-center justify-between gap-3">
                    <div class="w-[58%] flex flex-col justify-center text-left relative z-10 min-w-0">
                        <span class="text-brand-orange text-[9px] font-black uppercase tracking-[0.15em] mb-1.5 bg-brand-orange/10 px-2 py-0.5 rounded border border-brand-orange/20 w-max shrink-0">[LANZAMIENTO]</span>
                        <h3 class="text-white font-black text-xs md:text-sm uppercase leading-tight line-clamp-2 mb-3 tracking-tight">${p.name}</h3>
                        <button class="bg-brand-orange text-white font-black uppercase tracking-widest text-[8px] md:text-[9px] px-4 py-2 rounded-xl w-max shadow-md hover:bg-orange-600 transition duration-300 shrink-0">Comprar Ahora</button>
                    </div>
                    <div class="w-[42%] h-full flex items-center justify-center relative z-0 shrink-0">
                        <div class="absolute w-20 h-20 bg-brand-orange/20 rounded-full blur-xl pointer-events-none animate-pulse"></div>
                        <img src="${launchImgWeb}" class="max-h-[85%] object-contain drop-shadow-[0_8px_20px_rgba(240,90,40,0.4)] transform group-hover:scale-105 transition duration-500 relative z-10 filter brightness-105">
                    </div>
                </div>`;
        }
        launchHTML += `<div class="absolute inset-0 w-full h-full triple-slide-launch transition-opacity duration-1000 ${activeClass}" data-idx="${idx}">${slideContent}</div>`;
    });

    let offerHTML = '';
    offerPool.forEach((p, idx) => {
        const activeClass = idx === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none';
        const isPromo = p.originalPrice && p.originalPrice > p.price;
        const disc = isPromo ? Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100) : 0;
        const isCustomPromo = !!p.promoBannerUrl;
        const promoImgWeb = p.promoBannerUrl || p.mainImage || p.image;
        
        let slideContent = '';
        if (isCustomPromo) {
            slideContent = `<img src="${promoImgWeb}" class="absolute inset-0 w-full h-full object-fill transition duration-500 group-hover:scale-[1.02]">`;
        } else {
            const labelText = isPromo ? `OBTÉN ${disc}% DTO` : `IMPERDIBLE`;
            const badgeColorClass = isPromo ? 'text-brand-red bg-brand-red/10 border-brand-red/20' : 'text-brand-orange bg-brand-orange/10 border-brand-orange/20';
            
            slideContent = `
                <div class="absolute inset-0 bg-gradient-to-br from-[#1c1c1f] via-brand-black to-black p-5 flex flex-row items-center justify-between gap-3">
                    <div class="w-[58%] flex flex-col justify-center text-left relative z-10 min-w-0">
                        <span class="text-[9px] font-black uppercase tracking-[0.15em] mb-1.5 px-2 py-0.5 rounded border w-max shrink-0 ${badgeColorClass}">[${labelText}]</span>
                        <h3 class="text-white font-black text-xs md:text-sm uppercase leading-tight line-clamp-2 mb-3 tracking-tight">${p.name}</h3>
                        <button class="bg-white text-brand-black font-black uppercase tracking-widest text-[8px] md:text-[9px] px-4 py-2 rounded-xl w-max shadow-md hover:bg-gray-100 transition duration-300 shrink-0">Comprar Ahora</button>
                    </div>
                    <div class="w-[42%] h-full flex items-center justify-center relative z-0 shrink-0">
                        <div class="absolute w-20 h-20 bg-brand-orange/15 rounded-full blur-xl pointer-events-none animate-pulse"></div>
                        <img src="${p.mainImage || p.image}" class="max-h-[85%] object-contain drop-shadow-[0_8px_20px_rgba(240,90,40,0.35)] transform group-hover:scale-105 transition duration-500 relative z-10 filter brightness-105">
                    </div>
                </div>`;
        }
        offerHTML += `<div class="absolute inset-0 w-full h-full triple-slide-offer transition-opacity duration-1000 ${activeClass}" data-idx="${idx}">${slideContent}</div>`;
    });

    const bannerImages = ['/img/banners/triple1.webp', '/img/banners/triple2.webp', '/img/banners/triple3.webp'];
    const randomBanner = bannerImages[Math.floor(Math.random() * bannerImages.length)];

    const arrowLeftHTML = (type) => `<button onclick="event.stopPropagation(); window.moveTripleSlide('${type}', -1)" class="absolute left-3 top-1/2 -translate-y-1/2 z-30 w-7 h-7 bg-black/40 backdrop-blur-md hover:bg-brand-orange border border-white/10 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all active:scale-90 shadow-md"><i class="fa-solid fa-chevron-left text-[9px]"></i></button>`;
    const arrowRightHTML = (type) => `<button onclick="event.stopPropagation(); window.moveTripleSlide('${type}', 1)" class="absolute right-3 top-1/2 -translate-y-1/2 z-30 w-7 h-7 bg-black/40 backdrop-blur-md hover:bg-brand-orange border border-white/10 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all active:scale-90 shadow-md"><i class="fa-solid fa-chevron-right text-[9px]"></i></button>`;

    container.innerHTML = `
        <div id="card-triple-launch" class="w-full md:w-auto shrink-0 snap-center rounded-[1.5rem] cursor-pointer group hover:shadow-lg transition-all relative overflow-hidden h-40 bg-brand-black border border-white/5" data-active-idx="0" onclick="window.redirectToTripleActiveProduct('launch')">
            ${arrowLeftHTML('launch')} ${launchHTML} ${arrowRightHTML('launch')}
        </div>

        <div id="card-triple-offer" class="w-full md:w-auto shrink-0 snap-center rounded-[1.5rem] cursor-pointer group hover:shadow-lg transition-all relative overflow-hidden h-40 bg-brand-black border border-white/5" data-active-idx="0" onclick="window.redirectToTripleActiveProduct('offer')">
            ${arrowLeftHTML('offer')} ${offerHTML} ${arrowRightHTML('offer')}
        </div>

        <div class="w-full md:w-auto shrink-0 snap-center rounded-[1.5rem] cursor-pointer group hover:shadow-[0_15px_35px_rgba(240,90,40,0.25)] transition-all relative overflow-hidden h-40 bg-brand-black" onclick="window.location.href='/shop/catalog.html?mode=promos'">
            <img src="${randomBanner}" class="absolute inset-0 w-full h-full object-fill transition duration-500 group-hover:scale-[1.02] z-0" alt="Promociones Especiales">
        </div>
    `;

    window.redirectToTripleActiveProduct = (type) => {
        const card = document.getElementById(`card-triple-${type}`);
        if (!card) return;
        const currentIdx = parseInt(card.dataset.activeIdx || 0);
        const currentPool = type === 'launch' ? launchPool : offerPool;
        if (currentPool[currentIdx]) {
            window.location.href = `/shop/product.html?id=${currentPool[currentIdx].id}`;
        }
    };

    window.tripleAutoplayTimers = window.tripleAutoplayTimers || { launch: null, offer: null };
    window.tripleInactivityTimers = window.tripleInactivityTimers || { launch: null, offer: null };

    window.startTripleCardAutoplay = (type) => {
        if (window.tripleAutoplayTimers[type]) clearInterval(window.tripleAutoplayTimers[type]);
        window.tripleAutoplayTimers[type] = setInterval(() => {
            window.rotateTripleCard(type, 1);
        }, 5000);
    };

    window.rotateTripleCard = (type, direction) => {
        const card = document.getElementById(`card-triple-${type}`);
        if (!card) return;
        const slides = card.querySelectorAll(`.triple-slide-${type}`);
        if (slides.length <= 1) return;

        const current = parseInt(card.dataset.activeIdx || 0);
        let next = current + direction;
        if (next < 0) next = slides.length - 1;
        if (next >= slides.length) next = 0;

        slides[current].classList.replace('opacity-100', 'opacity-0');
        slides[current].classList.replace('z-10', 'z-0');
        slides[current].classList.add('pointer-events-none');
        
        slides[next].classList.replace('opacity-0', 'opacity-100');
        slides[next].classList.replace('z-0', 'z-10');
        slides[next].classList.remove('pointer-events-none');
        
        card.dataset.activeIdx = next;
    };

    window.moveTripleSlide = (type, direction) => {
        clearInterval(window.tripleAutoplayTimers[type]);
        clearTimeout(window.tripleInactivityTimers[type]);
        window.rotateTripleCard(type, direction);
        window.tripleInactivityTimers[type] = setTimeout(() => {
            window.startTripleCardAutoplay(type);
        }, 5000);
    };

    window.startTripleCardAutoplay('launch');
    window.startTripleCardAutoplay('offer');

    window.startMasterTripleAutoplay = () => {
        if(window.triplePromoInterval) clearInterval(window.triplePromoInterval);
        window.triplePromoInterval = setInterval(() => {
            if (window.innerWidth < 768 && container) {
                let maxScroll = container.scrollWidth - container.clientWidth;
                if (container.scrollLeft >= maxScroll - 10) {
                    container.scrollTo({ left: 0, behavior: 'smooth' });
                } else {
                    container.scrollBy({ left: container.clientWidth, behavior: 'smooth' });
                }
            }
        }, 5000);
    };

    window.startMasterTripleAutoplay();

    const originalScrollCarousel = window.scrollCarousel;
    window.scrollCarousel = (trackId, offset, isVertical = false) => {
        if (trackId === 'triple-promo-grid') {
            clearInterval(window.triplePromoInterval);
            if (window.masterTripleTimeout) clearTimeout(window.masterTripleTimeout);
            window.masterTripleTimeout = setTimeout(window.startMasterTripleAutoplay, 5000);
        }
        originalScrollCarousel(trackId, offset, isVertical);
    };
}

window.initMasterSliders = function() {
    if (window.masterSliderInterval) clearInterval(window.masterSliderInterval);
    window.masterSliderInterval = setInterval(() => {
        const promoContainer = document.getElementById('main-hero-banner'); 
        if (promoContainer) {
            const pSlides = promoContainer.querySelectorAll('.promo-slide');
            if (pSlides.length > 1) {
                const currentIdx = parseInt(promoContainer.dataset.activeIdx || 0);
                const nextIdx = (currentIdx + 1) % pSlides.length;
                pSlides[currentIdx].classList.remove('opacity-100', 'z-10');
                pSlides[currentIdx].classList.add('opacity-0', 'z-0', 'pointer-events-none');
                pSlides[nextIdx].classList.remove('opacity-0', 'z-0', 'pointer-events-none');
                pSlides[nextIdx].classList.add('opacity-100', 'z-10');
                promoContainer.dataset.activeIdx = nextIdx;
            }
        }
    }, 5000); 
};

window.moveSlider = (containerId, direction) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    const slides = container.querySelectorAll('.promo-slide');
    if (slides.length <= 1) return;

    const currentIdx = parseInt(container.dataset.activeIdx || 0);
    let nextIdx = currentIdx + direction;
    if (nextIdx < 0) nextIdx = slides.length - 1;
    if (nextIdx >= slides.length) nextIdx = 0;

    slides[currentIdx].classList.remove('opacity-100', 'z-10');
    slides[currentIdx].classList.add('opacity-0', 'z-0', 'pointer-events-none');
    slides[nextIdx].classList.remove('opacity-0', 'z-0', 'pointer-events-none');
    slides[nextIdx].classList.add('opacity-100', 'z-10');

    container.dataset.activeIdx = nextIdx;
    if (window.initMasterSliders) window.initMasterSliders();
};

/* ==========================================================================
   GENERADOR DE INTERFAZ DE COMPRA INTEGRADO A ATRIBUTOS (DOM IN-PLACE)
   ========================================================================== */
function getCardActionBtnHTML(p, style, cardToken) {
    const isOutOfStock = (p.stock || 0) <= 0;
    const hasVariants = (p.hasVariants && p.variants?.length > 0) || (p.hasCapacities && p.capacities?.length > 0);
    const qtyInCart = getProductQtyInCart(p.id);

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

    const actionContainerHTML = `<div class="product-action-container flex justify-end" data-product-id="${p.id}" data-card-style="${style}" data-card-token="${cardToken}">${getCardActionBtnHTML(p, style, cardToken)}</div>`;
    const overlayHTML = `<div id="overlay-${cardToken}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

    if (style === "compact") {
        containerClasses = "p-5 border-b lg:border-b-0 lg:border-r last:border-r-0 border-gray-200 hover:shadow-[0_0_20px_rgba(0,0,0,0.08)] hover:z-10 transition duration-300 flex flex-col justify-between bg-white relative group cursor-pointer h-full";
        
        let badge = hasDiscount ? `<span class="absolute top-4 left-4 bg-brand-red text-white text-[10px] font-black px-2 py-1 rounded shadow-sm z-10">-${Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)}%</span>` : '';
        if(isOutOfStock) badge = `<span class="absolute top-4 left-4 bg-gray-400 text-white text-[10px] font-black px-2 py-1 rounded shadow-sm z-10">Agotado</span>`;

        contentHTML = `
            ${badge}
            ${overlayHTML}
            <div>
                <div class="relative w-full h-32 mb-4 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform duration-500">
                    <img src="${p.mainImage || p.image || 'https://placehold.co/200'}" class="max-h-full max-w-full object-contain mix-blend-multiply">
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
    else {
        containerClasses = "border border-gray-100 rounded-2xl p-3 flex gap-4 items-center hover:shadow-lg hover:border-brand-orange/30 transition bg-white relative cursor-pointer group h-full";
        
        let badge = hasDiscount ? `<span class="absolute top-2 left-2 bg-brand-red text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm z-10">-${Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)}%</span>` : '';

        contentHTML = `
            ${badge}
            ${overlayHTML}
            <div class="w-1/3 h-24 shrink-0 bg-gray-50 rounded-xl p-2 flex items-center justify-center group-hover:bg-brand-orange/5 transition-colors border border-gray-50 overflow-hidden">
                <img src="${p.mainImage || p.image}" class="max-h-full max-w-full object-contain group-hover:scale-110 transition duration-500 mix-blend-multiply">
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

    return `<div class="${containerClasses}" onclick="window.location.href='/shop/product.html?id=${p.id}'">${contentHTML}</div>`;
}

function renderBigPromoRandom() {
    const container = document.getElementById('big-promo-random-section');
    if (!container) return;

    const allProductsCache = SmartCache.getAllProducts();
    const offers = allProductsCache.filter(p => p.stock > 0 && p.originalPrice > p.price);
    
    if (offers.length === 0) {
        container.innerHTML = `
            <div class="w-full h-[300px] md:h-[450px] bg-slate-50 rounded-[2rem] flex items-center justify-center border border-gray-100">
                <p class="text-gray-400 font-black uppercase tracking-widest text-xs">Preparando nuevas ofertas relámpago...</p>
            </div>`;
        return;
    }

    const p = offers[Math.floor(Math.random() * offers.length)];
    const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);

    const now = new Date();
    const initHours = String(23 - now.getHours()).padStart(2, '0');
    const initMins = String(59 - now.getMinutes()).padStart(2, '0');
    const initSecs = String(59 - now.getSeconds()).padStart(2, '0');

    container.innerHTML = `
        <div class="bg-gradient-to-br from-gray-900 via-[#111111] to-black rounded-[2rem] md:rounded-[3rem] p-8 md:p-12 flex flex-col md:flex-row items-center justify-between relative overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.4)] border border-white/10 cursor-pointer group" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            <div class="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div class="absolute -top-[20%] -right-[10%] w-[70%] h-[70%] bg-brand-orange/30 rounded-full blur-[100px] mix-blend-screen group-hover:bg-brand-orange/50 transition-all duration-700 ease-out"></div>
                <div class="absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] bg-purple-600/20 rounded-full blur-[100px] mix-blend-screen"></div>
            </div>
            <div class="md:w-1/2 z-10 relative flex flex-col justify-center w-full order-2 md:order-1 mt-6 md:mt-0 text-center md:text-left items-center md:items-start">
                <div class="flex flex-wrap justify-center md:justify-start items-center gap-3 mb-5">
                    <div class="inline-flex items-center gap-1.5 bg-red-500/10 text-red-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-full border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                        <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span> Termina en:
                    </div>
                    <div class="flex items-center gap-1 font-black text-white text-sm md:text-base">
                        <div class="bg-white/10 backdrop-blur-md px-2 py-1 rounded-lg border border-white/5 w-9 text-center shadow-inner" id="bp-hours">${initHours}</div>
                        <span class="text-gray-500 animate-pulse">:</span>
                        <div class="bg-white/10 backdrop-blur-md px-2 py-1 rounded-lg border border-white/5 w-9 text-center shadow-inner" id="bp-mins">${initMins}</div>
                        <span class="text-gray-500 animate-pulse">:</span>
                        <div class="bg-white/10 backdrop-blur-md px-2 py-1 rounded-lg border border-white/5 w-9 text-center shadow-inner text-brand-orange" id="bp-secs">${initSecs}</div>
                    </div>
                </div>
                <h2 class="text-3xl md:text-4xl lg:text-6xl font-black mb-4 text-white leading-[1.1] tracking-tighter group-hover:text-brand-orange transition-colors duration-500 line-clamp-3">
                    ${p.name}
                </h2>
                <div class="flex items-end gap-3 mb-8">
                    <div class="flex flex-col items-center md:items-start">
                        <span class="text-gray-400 line-through text-sm md:text-base font-medium mb-1 tracking-wide">Antes $${p.originalPrice.toLocaleString('es-CO')}</span>
                        <span class="text-4xl md:text-5xl lg:text-6xl font-black text-white tracking-tighter leading-none drop-shadow-md">$${p.price.toLocaleString('es-CO')}</span>
                    </div>
                    <div class="bg-gradient-to-r from-brand-orange to-red-500 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-black text-lg md:text-2xl shadow-lg transform -rotate-3 border border-white/20 mb-1 ml-2">
                        -${disc}%
                    </div>
                </div>
                <button class="relative overflow-hidden bg-brand-orange text-white font-black uppercase tracking-[0.2em] text-[11px] py-4 px-8 rounded-2xl transition-all duration-300 hover:scale-105 active:scale-95 shadow-[0_15px_30px_rgba(240,90,40,0.3)] w-full md:w-max flex items-center justify-center gap-3 group/btn">
                    <span class="relative z-10">Aprovechar Oferta</span> 
                    <i class="fa-solid fa-arrow-right relative z-10 group-hover/btn:translate-x-1 transition-transform"></i>
                    <div class="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 ease-in-out"></div>
                </button>
            </div>
            <div class="md:w-1/2 relative z-10 flex justify-center items-center w-full h-[220px] md:h-[400px] order-1 md:order-2">
                <img src="${p.mainImage || p.image}" alt="${p.name}" class="w-full h-full object-contain drop-shadow-[0_30px_50px_rgba(0,0,0,0.6)] transform group-hover:scale-110 group-hover:-translate-y-4 group-hover:-rotate-3 transition-all duration-700 ease-out relative z-20">
            </div>
        </div>
    `;

    if (window.bigPromoInterval) clearInterval(window.bigPromoInterval);
    window.bigPromoInterval = setInterval(() => {
        const timeNow = new Date();
        const hours = String(23 - timeNow.getHours()).padStart(2, '0');
        const mins = String(59 - timeNow.getMinutes()).padStart(2, '0');
        const secs = String(59 - timeNow.getSeconds()).padStart(2, '0');
        const elHours = document.getElementById('bp-hours');
        const elMins = document.getElementById('bp-mins');
        const elSecs = document.getElementById('bp-secs');
        if (elHours && elMins && elSecs) {
            elHours.textContent = hours; elMins.textContent = mins; elSecs.textContent = secs;
        } else {
            clearInterval(window.bigPromoInterval);
        }
    }, 1000);
}

function loadPromotionsGrid() {
    const track = document.getElementById('promo-track');
    if (!track) return;

    const allProductsCache = SmartCache.getAllProducts();
    let flashOffers = allProductsCache.filter(p => p.stock > 0 && p.originalPrice > p.price && (p.isFlashOffer === true || p.offerType === 'flash'));
    if (flashOffers.length === 0) flashOffers = allProductsCache.filter(p => p.stock > 0 && p.originalPrice > p.price);
    if (flashOffers.length === 0) {
        track.innerHTML = `<div class="flex items-center justify-center h-full"><p class="text-[10px] text-gray-400 font-black uppercase tracking-widest">Sin ofertas activas</p></div>`;
        return;
    }

    flashOffers.sort(() => 0.5 - Math.random());
    const p = flashOffers[0];
    if(!p) return;

    const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
    const actionContainerHTML = `<div class="product-action-container w-full mt-auto flex items-center justify-center" data-product-id="${p.id}" data-card-style="promo" data-card-prefix="promo">${getCardActionBtnHTML(p, "promo", "promo")}</div>`;
    const overlayHTML = `<div id="overlay-promo-${p.id}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

    track.innerHTML = `
        <div class="relative flex flex-col group cursor-pointer bg-white rounded-[1.5rem] shadow-sm hover:shadow-[0_20px_40px_rgba(240,90,40,0.15)] border border-gray-100 transition-all duration-500 h-full w-full overflow-hidden" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            <div class="absolute top-4 left-4 bg-gradient-to-r from-red-600 to-red-500 text-white text-[9px] font-black px-3 py-1.5 rounded-full shadow-lg z-10 uppercase tracking-widest flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> Solo Hoy</div>
            <div class="absolute top-4 right-4 bg-brand-black text-brand-orange text-[10px] font-black px-2 py-1 rounded-lg z-10">-${disc}%</div>
            ${overlayHTML}
            <div class="w-full h-40 relative mt-12 mb-2 px-4 flex justify-center items-center">
                <div class="absolute inset-0 bg-brand-orange/5 rounded-full blur-2xl group-hover:bg-brand-orange/20 transition-all duration-500"></div>
                <img src="${p.mainImage || p.image}" class="max-h-full max-w-full object-contain group-hover:scale-110 group-hover:-translate-y-2 transition-all duration-500 drop-shadow-md relative z-10">
            </div>
            <div class="w-full flex-1 flex flex-col p-5 pt-0">
                <h4 class="font-black text-sm text-brand-black leading-tight mb-4 line-clamp-2 group-hover:text-brand-orange transition-colors">${p.name}</h4>
                <div class="flex items-end gap-2 mb-6">
                    <span class="text-2xl font-black text-brand-orange leading-none tracking-tighter">$${p.price.toLocaleString('es-CO')}</span>
                    <span class="line-through text-gray-400 text-[10px] font-bold mb-1">$${p.originalPrice.toLocaleString('es-CO')}</span>
                </div>
                <div class="flex justify-center gap-2 mb-6 text-center">
                    <div class="bg-gray-50 border border-gray-100 rounded-lg py-1.5 w-12 shadow-inner"><span class="block font-black text-sm text-brand-black leading-none" id="mini-hours">00</span><span class="text-[7px] font-bold text-gray-400 uppercase">Hrs</span></div>
                    <span class="text-gray-300 font-bold self-start mt-1 animate-pulse">:</span>
                    <div class="bg-gray-50 border border-gray-100 rounded-lg py-1.5 w-12 shadow-inner"><span class="block font-black text-sm text-brand-black leading-none" id="mini-mins">00</span><span class="text-[7px] font-bold text-gray-400 uppercase">Min</span></div>
                    <span class="text-gray-300 font-bold self-start mt-1 animate-pulse">:</span>
                    <div class="bg-red-50 border border-red-100 rounded-lg py-1.5 w-12 shadow-sm"><span class="block font-black text-sm text-brand-red leading-none" id="mini-secs">00</span><span class="text-[7px] font-bold text-red-400 uppercase">Seg</span></div>
                </div>
                ${actionContainerHTML}
            </div>
        </div>
    `;

    if (window.miniPromoInterval) clearInterval(window.miniPromoInterval);
    const updateMiniTimer = () => {
        const timeNow = new Date();
        const h = String(23 - timeNow.getHours()).padStart(2, '0');
        const m = String(59 - timeNow.getMinutes()).padStart(2, '0');
        const s = String(59 - timeNow.getSeconds()).padStart(2, '0');
        const eH = document.getElementById('mini-hours');
        const eM = document.getElementById('mini-mins');
        const eS = document.getElementById('mini-secs');
        if (eH && eM && eS) {
            eH.textContent = h; eM.textContent = m; eS.textContent = s;
        } else {
            clearInterval(window.miniPromoInterval);
        }
    };
    updateMiniTimer();
    window.miniPromoInterval = setInterval(updateMiniTimer, 1000);
}

function loadBestSellers() {
    const grid = document.getElementById('dynamic-grid');
    if (!grid) return;
    const allProductsCache = SmartCache.getAllProducts();
    let best = allProductsCache.filter(p => p.stock > 0);
    best.sort(() => 0.5 - Math.random());
    grid.innerHTML = best.slice(0, 9).map(p => createProductCard(p, "normal", "best")).join('');
}

/* ==========================================================================
   SECCIÓN: EXPLORA POR CATEGORÍA (Con memoria de estado)
   ========================================================================== */
window.currentExploreCategory = null;

function loadExploreSection() {
    const catListContainer = document.getElementById('explore-categories-list');
    if (!catListContainer) return;

    const categories = SmartCache.getCategories();
    if (categories.length === 0) return;

    let activeIdx = 0;
    if (window.currentExploreCategory) {
        const foundIdx = categories.findIndex(c => c.name === window.currentExploreCategory);
        if (foundIdx !== -1) activeIdx = foundIdx;
    }

    catListContainer.innerHTML = categories.map((cat, idx) => `
        <button onclick="window.selectExploreCategory('${cat.name}', this)" class="explore-cat-btn ${idx === activeIdx ? 'bg-brand-orange text-white shadow-md' : 'bg-transparent text-gray-500 hover:bg-white border border-transparent hover:border-gray-200'} px-5 py-3.5 rounded-xl text-left text-[11px] font-black uppercase tracking-widest transition-all duration-300 shrink-0 lg:w-full flex items-center justify-between group">
            <span class="truncate">${cat.name}</span>
            <i class="fa-solid fa-chevron-right text-[10px] ${idx === activeIdx ? 'text-white' : 'text-gray-300 group-hover:text-brand-orange'} hidden lg:block transition-colors"></i>
        </button>
    `).join('');

    window.selectExploreCategory(categories[activeIdx].name, catListContainer.children[activeIdx]);
}

window.selectExploreCategory = (categoryName, btn) => {
    window.currentExploreCategory = categoryName;
    
    // ✅ CORRECCIÓN PROTEGIDA: Métodos nativos seguros sin interferencia para evitar pantallazo blanco
    document.querySelectorAll('.explore-cat-btn').forEach(b => {
        b.classList.remove('bg-brand-orange', 'text-white', 'shadow-md');
        b.classList.add('bg-transparent', 'text-gray-500', 'hover:bg-white', 'border', 'border-transparent', 'hover:border-gray-200');
        const icon = b.querySelector('i');
        if (icon) {
            icon.classList.remove('text-white');
            icon.classList.add('text-gray-300');
        }
    });

    if (btn) {
        btn.classList.remove('bg-transparent', 'text-gray-500', 'hover:bg-white', 'border', 'border-transparent', 'hover:border-gray-200');
        btn.classList.add('bg-brand-orange', 'text-white', 'shadow-md');
        const icon = btn.querySelector('i');
        if (icon) {
            icon.classList.remove('text-gray-300');
            icon.classList.add('text-white');
        }
    }

    const grid = document.getElementById('explore-products-grid');
    if (!grid) return;
    grid.className = "relative w-full flex-grow group/explorecontainer";

    const allProductsCache = SmartCache.getAllProducts();
    const filtered = allProductsCache.filter(p => p.category === categoryName && p.stock > 0);
    if (filtered.length === 0) {
        grid.innerHTML = `<div class="w-full flex items-center justify-center h-40"><p class="text-[10px] text-gray-400 font-black uppercase tracking-widest">Aún no hay productos en esta categoría</p></div>`;
        return;
    }

    const trackId = `explore-track-${categoryName.replace(/\s+/g, '-')}`;
    const cardsHTML = filtered.slice(0, 12).map(p => `
        <div class="w-[72vw] sm:w-[45vw] md:w-[30vw] lg:w-[23.8%] shrink-0 snap-start bg-white rounded-[1.5rem] border border-gray-100 overflow-hidden transition-all duration-300 hover:border-brand-orange/20">
            ${createProductCard(p, "compact", "explore").replace(/lg:border-r|border-b|last:border-r-0/g, '')}
        </div>
    `).join('');

    grid.innerHTML = `
        <button onclick="event.stopPropagation(); window.scrollCarousel('${trackId}', -320)" class="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-40 w-10 h-10 bg-white border border-gray-100 rounded-full shadow-lg flex items-center justify-center text-gray-500 hover:text-brand-orange opacity-0 group-hover/explorecontainer:opacity-100 transition-all duration-300 active:scale-95"><i class="fa-solid fa-chevron-left text-xs"></i></button>
        <div id="${trackId}" class="flex flex-row gap-4 overflow-x-auto no-scrollbar scroll-smooth w-full snap-x snap-mandatory py-3 px-1">${cardsHTML}</div>
        <button onclick="event.stopPropagation(); window.scrollCarousel('${trackId}', 320)" class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-40 w-10 h-10 bg-white border border-gray-100 rounded-full shadow-lg flex items-center justify-center text-gray-500 hover:text-brand-orange opacity-0 group-hover/explorecontainer:opacity-100 transition-all duration-300 active:scale-95"><i class="fa-solid fa-chevron-right text-xs"></i></button>
    `;
};

/* ==========================================================================
   LÓGICA GENÉRICA DE CARRUSELES INFINITOS
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

// ✅ CORRECCIÓN CENTRAL: Motor matemático elástico con offset relativo para bucle infinito real sin cortes
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

function loadCategoriesBar() {
    const track = document.getElementById('categories-track');
    if (!track) return;
    
    const categories = SmartCache.getCategories();
    if (categories.length === 0) return; 

    const displayCats = [...categories, ...categories, ...categories, ...categories];
    
    track.innerHTML = displayCats.map(cat => {
        const imgUrl = cat.image || `https://placehold.co/100x100/transparent/111111?text=${encodeURIComponent(cat.name)}`;
        return `
        <div onclick="window.location.href='/shop/catalog.html?category=${encodeURIComponent(cat.name)}'" class="w-28 md:w-40 h-32 md:h-44 shrink-0 bg-gray-50/80 rounded-[1.5rem] p-3 md:p-4 flex flex-col items-center justify-start text-center hover:shadow-[0_10px_20px_rgba(240,90,40,0.15)] hover:bg-white border border-transparent hover:border-brand-orange/30 transition-all duration-300 cursor-pointer group hover:-translate-y-2 overflow-hidden">
            
            <div class="h-20 md:h-28 w-full flex items-center justify-center overflow-hidden p-1 shrink-0">
                <img src="${imgUrl}" alt="${cat.name}" class="max-h-full max-w-full object-contain group-hover:scale-110 transition-all duration-500 mix-blend-multiply drop-shadow-sm group-hover:drop-shadow-xl">
            </div>
            
            <div class="flex-1 flex items-center justify-center w-full mt-1 overflow-hidden">
                <h3 class="font-black text-[9px] md:text-[11px] text-brand-black group-hover:text-brand-orange transition leading-tight line-clamp-2 uppercase tracking-wider w-full">${cat.name}</h3>
            </div>
            
        </div>`;
    }).join('');

    initAutoScroll('categories-track', 1);
}

function loadFeatured() {
    const track = document.getElementById('featured-track');
    if (!track) return;
    const allProductsCache = SmartCache.getAllProducts();
    const pool = allProductsCache.filter(p => p.stock > 0);
    pool.sort(() => 0.5 - Math.random());
    
    const products = pool.slice(0, 8);
    const displayProducts = [...products, ...products, ...products, ...products];

    track.innerHTML = displayProducts.map(p => {
        let cardHTML = createProductCard(p, "compact", "feat").replace(/lg:border-r|border-b|last:border-r-0/g, '');
        return `
        <div class="w-[65vw] sm:w-[45vw] md:w-64 shrink-0 transition-all duration-300 hover:-translate-y-2 hover:z-10 py-4 px-2 group/card">
            <div class="rounded-[1.5rem] overflow-hidden shadow-sm group-hover/card:shadow-[0_15px_30px_rgba(0,0,0,0.1)] h-full border border-gray-100 group-hover/card:border-brand-orange/30 transition-all duration-300 bg-white">
                ${cardHTML}
            </div>
        </div>`;
    }).join('');

    initAutoScroll('featured-track', 1.2);
}

function loadBrandsMarquee() {
    const track = document.getElementById('brands-track-container');
    if (!track) return;
    
    const brands = SmartCache.getBrands();
    if (brands.length === 0) return;

    let displayBrands = [...brands, ...brands, ...brands, ...brands];

    track.innerHTML = displayBrands.map(b => `
        <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="bg-white border border-gray-100 rounded-2xl h-24 w-40 flex items-center justify-center p-4 hover:border-brand-orange hover:shadow-[0_10px_20px_rgba(240,90,40,0.1)] hover:-translate-y-2 transition-all duration-300 cursor-pointer group shrink-0">
            <img src="${b.image || 'https://placehold.co/100'}" class="max-h-full max-w-full object-contain opacity-60 group-hover:opacity-100 group-hover:scale-125 transition duration-500 mix-blend-multiply drop-shadow-sm group-hover:drop-shadow-lg" alt="${b.name}">
        </a>
    `).join('');

    initAutoScroll('brands-track-container', 1.5);
}

/* ==========================================================================
   🔥 BLOQUE DE INICIALIZACIÓN PROTEGIDO CONTRA CARGA ASÍNCRONA
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const checkDOMReady = setInterval(async () => {
        if (!document.getElementById("main-hero-banner")) return;
        clearInterval(checkDOMReady); 

        await SmartCache.init();

        if (SmartCache.getAllProducts().length > 0) {
            updateCartCount();
            loadMainBanner();
            loadTripleBanners();
            loadCategoriesBar();
            loadFeatured();
            renderBigPromoRandom();
            loadPromotionsGrid();
            loadBestSellers();
            loadExploreSection();
            loadBrandsMarquee();
            if (window.populateMegaMenus) window.populateMegaMenus();
            window.initMasterSliders();
        } else {
            updateCartCount();
            const loadChunks = [
                () => { loadMainBanner(); loadTripleBanners(); },
                () => { loadCategoriesBar(); loadFeatured(); },
                () => { renderBigPromoRandom(); loadPromotionsGrid(); },
                () => { loadBestSellers(); loadExploreSection(); },
                () => { loadBrandsMarquee(); window.initMasterSliders(); if (window.populateMegaMenus) window.populateMegaMenus(); } 
            ];
            let chunkIndex = 0;
            const processChunks = () => {
                if (chunkIndex < loadChunks.length) {
                    loadChunks[chunkIndex]();
                    chunkIndex++;
                    if ('requestIdleCallback' in window) requestIdleCallback(() => setTimeout(processChunks, 50));
                    else setTimeout(processChunks, 100);
                }
            };
            if ('requestIdleCallback' in window) requestIdleCallback(processChunks);
            else setTimeout(processChunks, 100);
        }

        window.addEventListener('catalogUpdated', () => {
            const updateEverything = () => {
                loadMainBanner();
                loadTripleBanners();
                loadFeatured();
                renderBigPromoRandom();
                loadPromotionsGrid();
                loadExploreSection();
                loadBestSellers();
            };
            if ('requestIdleCallback' in window) requestIdleCallback(updateEverything);
            else setTimeout(updateEverything, 100);
        });

        window.addEventListener('categoriesUpdated', () => {
            loadCategoriesBar();
            loadExploreSection();
            if (window.populateMegaMenus) window.populateMegaMenus();
        });

        window.addEventListener('brandsUpdated', () => {
            loadBrandsMarquee();
            if (window.populateMegaMenus) window.populateMegaMenus();
        });

        window.addEventListener('cartUpdated', () => {
            window.updateAllProductCardsUI(); 
        });
        
    }, 100);
});