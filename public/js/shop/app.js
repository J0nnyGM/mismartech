import { auth, db, onAuthStateChanged, collection, getDocs, query, orderBy, doc, getDoc } from "../firebase-init.js";
import { addToCart, updateCartCount, removeOneUnit } from "./cart.js";
import { SmartCache } from "./cache-service.js"; // <--- CEREBRO CONECTADO

console.log("🚀 Smartech Store Iniciada - Modo Real-Time Total");

/* ==========================================================================
   🔥 MANEJO DE USUARIO (Header UI)
   ========================================================================== */
let currentAuthUser = null;

onAuthStateChanged(auth, async (user) => {
    currentAuthUser = user;
    updateUserHeaderUI();
});

async function updateUserHeaderUI() {
    const userInfo = document.getElementById("user-info-global");
    
    if (!userInfo) {
        setTimeout(updateUserHeaderUI, 100);
        return;
    }

    if (currentAuthUser) {
        const cachedRole = sessionStorage.getItem(`role_${currentAuthUser.uid}`);
        if (cachedRole) {
            renderUserButton(cachedRole === 'admin', userInfo);
        } else {
            try {
                const userDoc = await getDoc(doc(db, "users", currentAuthUser.uid));
                const isAdmin = userDoc.exists() && userDoc.data().role === 'admin';
                sessionStorage.setItem(`role_${currentAuthUser.uid}`, isAdmin ? 'admin' : 'customer');
                renderUserButton(isAdmin, userInfo);
            } catch (e) {}
        }
    } else {
        userInfo.innerHTML = `
            <a href="auth/login.html" class="flex flex-col items-center gap-1 group w-14 cursor-pointer">
                <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center group-hover:bg-brand-orange transition duration-300 shadow-sm">
                    <i class="fa-regular fa-user text-lg text-gray-500 group-hover:text-white"></i>
                </div>
                <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-orange text-center">Ingresar</span>
            </a>`;
    }
}

function renderUserButton(isAdmin, userInfoNode) {
    const targetPath = isAdmin ? '/admin/products.html' : '/profile.html';
    const label = isAdmin ? 'Admin' : 'Cuenta';
    userInfoNode.innerHTML = `
        <a href="${targetPath}" class="flex flex-col items-center gap-1 group w-14">
            <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-brand-orange text-white flex items-center justify-center shadow-md transition duration-300 hover:shadow-lg hover:-translate-y-1">
                <i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'} text-lg"></i>
            </div>
            <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-brand-orange text-center">${label}</span>
        </a>`;
}

/* ==========================================================================
   LÓGICA HÍBRIDA: MODAL GLOBAL + OVERLAY EN TARJETA
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
    return colorMap[name.toLowerCase()] || name;
}

function getGlobalModal() {
    let modal = document.getElementById('global-variant-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-variant-modal';
        modal.className = "fixed inset-0 z-[100] hidden items-center justify-center p-4 bg-brand-black/60 backdrop-blur-sm transition-all duration-300 opacity-0";
        modal.onclick = (e) => { if (e.target === modal) window.closeGlobalModal(); };
        modal.innerHTML = `<div id="global-modal-content" class="bg-white w-full max-w-[320px] rounded-[2rem] shadow-2xl overflow-hidden transform scale-95 transition-all duration-300 relative flex flex-col max-h-[90vh]"></div>`;
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
    <div class="p-6 pb-2 text-center bg-slate-50 border-b border-gray-100 relative">
        <button onclick="window.closeGlobalModal()" class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-gray-400 hover:text-brand-red transition"><i class="fa-solid fa-xmark"></i></button>
        <div class="w-24 h-24 mx-auto bg-white rounded-xl p-2 shadow-sm mb-3 flex items-center justify-center"><img src="${img}" class="max-w-full max-h-full object-contain" id="modal-product-img"></div>
        <h3 class="font-black text-sm uppercase text-brand-black leading-tight mb-1">${p.name}</h3>
        <p class="text-lg font-black text-brand-orange mt-2" id="modal-price-display">$${initialPrice.toLocaleString('es-CO')}</p>
    </div>
    <div class="p-6 overflow-y-auto no-scrollbar space-y-5" id="modal-options-container" data-id="${id}">`;

    if (p.hasVariants && p.variants?.length > 0) {
        html += `<div><p class="text-[10px] font-black text-brand-black uppercase tracking-widest mb-3">Color</p><div class="flex flex-wrap justify-center gap-3">`;
        p.variants.forEach((v, idx) => {
            html += `<button onclick="window.selectVariantOption('modal', 'color', '${v.color}', this)" class="w-10 h-10 rounded-full shadow-sm hover:scale-110 transition-all var-btn-color relative ring-2 ${idx === 0 ? '!ring-brand-orange scale-110' : 'ring-gray-100'}" style="background-color: ${getColorHex(v.color)}" data-val="${v.color}" data-img="${v.images?.[0] || ''}"></button>`;
        });
        html += `</div></div>`;
    }
    if (p.hasCapacities && p.capacities?.length > 0) {
        html += `<div><p class="text-[10px] font-black text-brand-black uppercase tracking-widest mb-3">Capacidad</p><div class="flex flex-wrap justify-center gap-2">`;
        p.capacities.forEach((c, idx) => {
            html += `<button onclick="window.selectVariantOption('modal', 'capacity', '${c.label}', this)" class="px-4 py-2 rounded-xl border-2 text-[10px] font-black uppercase transition-all var-btn-cap ${idx === 0 ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-gray-400 border-gray-100 hover:border-brand-orange hover:text-brand-orange'}" data-val="${c.label}">${c.label}</button>`;
        });
        html += `</div></div>`;
    }

    html += `</div>
    <div class="p-6 pt-0 mt-auto"><button onclick="window.confirmAdd('modal')" class="w-full bg-brand-orange text-white font-black py-4 rounded-2xl uppercase text-xs tracking-[0.25em] shadow-lg hover:-translate-y-1 transition-all active:scale-95 flex items-center justify-center gap-3 hover:bg-orange-700"><span>Agregar</span> <i class="fa-solid fa-cart-plus"></i></button></div>`;

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

window.openCardOverlay = (id, prefix) => {
    event.stopPropagation();
    const p = SmartCache.getProduct(id); 
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
    <div class="absolute inset-0 z-50 bg-white flex flex-col h-full w-full p-4 rounded-[inherit]" onclick="event.stopPropagation()">
        
        <div class="flex justify-between items-center border-b border-gray-100 pb-2 mb-2 shrink-0">
            <h4 class="text-[10px] font-black uppercase text-brand-black tracking-widest">Personalizar</h4>
            <button onclick="window.closeCardOverlay('${uniqueId}')" class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-brand-red transition rounded-full bg-gray-50">
                <i class="fa-solid fa-xmark text-xs"></i>
            </button>
        </div>
        
        <div class="flex-grow flex flex-col justify-center gap-4 overflow-y-auto no-scrollbar py-2" id="overlay-opts-${uniqueId}" data-id="${id}">`;

    if (p.hasVariants && p.variants?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-2 text-center">Selecciona Color</p>
            <div class="flex flex-wrap gap-2 justify-center">`;
        p.variants.forEach((v, idx) => {
            const isLight = ['blanco', 'white', 'plateado', 'silver'].includes(v.color.toLowerCase());
            html += `
                <button onclick="window.selectVariantOption('${uniqueId}', 'color', '${v.color}', this)" 
                    class="w-7 h-7 rounded-full shadow-sm hover:scale-110 transition-all var-btn-color ring-2 ${idx===0 ? 'ring-brand-orange scale-110' : 'ring-gray-200'} ${isLight ? 'border border-gray-300' : ''}" 
                    style="background-color: ${getColorHex(v.color)}" 
                    data-val="${v.color}">
                </button>`;
        });
        html += `</div></div>`;
    }

    if (p.hasCapacities && p.capacities?.length > 0) {
        html += `
        <div class="w-full">
            <p class="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-2 text-center">Selecciona Capacidad</p>
            <div class="flex flex-wrap gap-2 justify-center">`;
        p.capacities.forEach((c, idx) => {
            html += `
                <button onclick="window.selectVariantOption('${uniqueId}', 'capacity', '${c.label}', this)" 
                    class="px-3 py-1.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-wider transition-all var-btn-cap ${idx===0 ? 'bg-brand-black text-white border-brand-black' : 'bg-white text-gray-500 border-gray-200 hover:border-brand-orange'}" 
                    data-val="${c.label}">
                    ${c.label}
                </button>`;
        });
        html += `</div></div>`;
    }

    html += `</div>
        
        <div class="mt-auto shrink-0 pt-2 border-t border-dashed border-gray-100">
            <div class="flex justify-between items-center mb-3 px-1">
                <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total:</span>
                <span class="text-sm font-black text-brand-orange" id="overlay-price-${uniqueId}">$${initialPrice.toLocaleString('es-CO')}</span>
            </div>
            <button onclick="window.confirmAdd('${uniqueId}')" class="w-full bg-brand-orange text-white font-black py-3 rounded-xl uppercase text-[10px] tracking-[0.2em] hover:bg-orange-700 transition shadow-lg active:scale-95 flex items-center justify-center gap-2">
                <span>Al Carrito</span> <i class="fa-solid fa-cart-plus"></i>
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
        parent.querySelectorAll('.var-btn-color').forEach(b => b.classList.remove('!ring-brand-orange', 'ring-brand-orange', 'scale-110'));
        parent.querySelectorAll('.var-btn-color').forEach(b => b.classList.add('ring-gray-100', 'ring-gray-200')); 
        btn.classList.remove('ring-gray-100', 'ring-gray-200');
        btn.classList.add(context === 'modal' ? '!ring-brand-orange' : 'ring-brand-orange', 'scale-110');
        if (context === 'modal' && btn.dataset.img) document.getElementById('modal-product-img').src = btn.dataset.img;
    }
    if (type === 'capacity') {
        container.dataset.selCap = val;
        const parent = btn.parentElement;
        parent.querySelectorAll('.var-btn-cap').forEach(b => {
            b.className = context === 'modal'
                ? "px-4 py-2 rounded-xl border-2 border-gray-100 text-gray-400 text-[10px] font-black uppercase transition-all var-btn-cap hover:border-brand-orange hover:text-brand-orange"
                : "px-3 py-1.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-wider transition-all var-btn-cap border-gray-200 text-gray-500 hover:border-brand-orange";
        });
        btn.className = context === 'modal'
            ? "px-4 py-2 rounded-xl border-2 border-brand-black bg-brand-black text-white text-[10px] font-black uppercase transition-all var-btn-cap shadow-lg"
            : "px-3 py-1.5 rounded-lg border-2 text-[9px] font-black uppercase tracking-wider transition-all var-btn-cap bg-brand-black text-white border-brand-black shadow-sm";
    }

    const curColor = container.dataset.selColor;
    const curCap = container.dataset.selCap;
    let newPrice = p.price;

    if (p.combinations && p.combinations.length > 0) {
        const combo = p.combinations.find(c => (c.color === curColor || !c.color) && (c.capacity === curCap || !c.capacity));
        if (combo) newPrice = combo.price;
    } else if (p.capacities && curCap) {
        const c = p.capacities.find(x => x.label === curCap);
        if (c) newPrice = c.price;
    }

    let priceEl = context === 'modal' ? document.getElementById('modal-price-display') : document.getElementById(`overlay-price-${context}`);
    if (priceEl) {
        priceEl.style.opacity = '0.5';
        setTimeout(() => {
            priceEl.textContent = `$${newPrice.toLocaleString('es-CO')}`;
            priceEl.style.opacity = '1';
        }, 150);
    }
};

window.confirmAdd = (context) => {
    event.stopPropagation();
    const container = context === 'modal' ? document.getElementById('modal-options-container') : document.getElementById(`overlay-opts-${context}`);
    const id = container.dataset.id;
    const p = SmartCache.getProduct(id); 

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
        id: p.id, name: p.name, price: finalPrice, originalPrice: p.originalPrice || 0,
        image: finalImage, color: selColor, capacity: selCap, quantity: 1
    });

    if (context === 'modal') window.closeGlobalModal();
    else window.closeCardOverlay(context);

    updateCartCount();
    refreshAllGrids();
};

window.quickAdd = (id) => {
    event.stopPropagation();
    const p = SmartCache.getProduct(id); 
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
        if (p.variants[0].images && p.variants[0].images.length > 0) {
            finalImage = p.variants[0].images[0];
        }
    }

    addToCart({
        id: p.id, name: p.name, price: finalPrice, originalPrice: p.originalPrice || 0,
        image: finalImage, color: selectedColor, capacity: selectedCapacity, quantity: 1
    });

    updateCartCount();
    refreshAllGrids();
};

window.updateCardQty = (id, delta) => {
    event.stopPropagation();
    if (delta > 0) window.quickAdd(id);
    else removeOneUnit(id);
    updateCartCount();
    refreshAllGrids();
};

function refreshAllGrids() {
    loadMainBanner();
    loadTripleBanners();
    renderBigPromoRandom();
    if (document.getElementById('featured-grid')) loadFeatured();
    loadExploreSection();
    loadPromotionsGrid();
    loadBestSellers();
    populateNavDropdowns(); // Actualiza el Header dinámicamente
}

/* ==========================================================================
   NUEVA FUNCIÓN: LLENAR LOS DROPDOWNS DEL HEADER
   ========================================================================== */
function populateNavDropdowns() {
    const catDropdown = document.getElementById('nav-categories-dropdown');
    const brandDropdown = document.getElementById('nav-brands-dropdown');

    if (catDropdown) {
        const categories = SmartCache.getCategories();
        if (categories.length > 0) {
            catDropdown.innerHTML = categories.map(cat => `
                <a href="/shop/catalog.html?category=${encodeURIComponent(cat.name)}" class="px-5 py-3 text-xs font-bold text-gray-600 hover:text-brand-orange hover:bg-orange-50 border-b border-gray-50 last:border-0 transition flex items-center gap-3">
                    <img src="${cat.image || 'https://placehold.co/50'}" class="w-6 h-6 object-contain mix-blend-multiply">
                    ${cat.name}
                </a>
            `).join('');
        }
    }

    if (brandDropdown) {
        const brands = SmartCache.getBrands();
        if (brands.length > 0) {
            brandDropdown.innerHTML = brands.map(b => `
                <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="px-5 py-3 text-xs font-bold text-gray-600 hover:text-brand-orange hover:bg-orange-50 border-b border-gray-50 last:border-0 transition flex items-center gap-3">
                    <img src="${b.image || 'https://placehold.co/50'}" class="w-8 h-4 object-contain mix-blend-multiply">
                    ${b.name}
                </a>
            `).join('');
        }
    }
}

/* ==========================================================================
   CARGADORES Y UI SMARTECH (DATOS DESDE SMARTCACHE)
   ========================================================================== */

function loadMainBanner() {
    const container = document.getElementById('main-hero-banner');
    if (!container) return;

    const allProductsCache = SmartCache.getAllProducts();
    let promos = allProductsCache.filter(p => p.isHeroPromo === true && p.stock > 0);
    if (promos.length === 0) promos = allProductsCache.filter(p => p.stock > 0).slice(0,3);
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
                        <img src="${bgImageWeb}" class="w-full h-full object-fill transition duration-700 group-hover:scale-[1.02]">
                    </picture>
                </div>
            `;
        } else {
            contentHTML = `
                <div class="absolute inset-0 bg-[#111111] cursor-pointer group overflow-hidden" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                    <div class="absolute right-0 top-0 w-[50%] h-[150%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-brand-orange/20 via-transparent to-transparent -translate-y-1/4 translate-x-1/4 z-0"></div>
                    <div class="absolute inset-0 z-0 opacity-20" style="background-image: radial-gradient(circle, #ffffff 1px, transparent 1px); background-size: 24px 24px;"></div>
                    <div class="absolute inset-0 bg-gradient-to-r from-[#111111] via-[#111111]/90 to-transparent z-0"></div>

                    <div class="flex w-full h-full relative z-10">
                        <div class="w-full md:w-[60%] p-8 md:p-14 flex flex-col justify-center text-left">
                            <span class="text-gray-300 text-[10px] font-black uppercase tracking-[0.2em] mb-3 inline-flex items-center gap-2">
                                <span class="w-6 h-px bg-brand-orange"></span> [OFERTA INCREÍBLE]
                            </span>
                            
                            <h2 class="text-3xl md:text-4xl lg:text-5xl font-black text-white leading-tight uppercase tracking-tighter mb-4 group-hover:text-brand-orange transition-colors duration-500 drop-shadow-lg max-w-2xl">
                                ${p.name}
                            </h2>
                            
                            <p class="text-gray-400 text-xs md:text-sm font-medium mb-8 uppercase tracking-wide">
                                [LA NUEVA GENERACIÓN EN TECNOLOGÍA ESTÁ AQUÍ]
                            </p>
                            
                            <button class="bg-brand-orange text-white font-black uppercase tracking-widest text-[10px] px-8 py-3.5 rounded-full w-max hover:bg-white hover:text-brand-orange transition-all flex items-center gap-3 group/btn">
                                Más Información <i class="fa-solid fa-chevron-right group-hover/btn:translate-x-1 transition-transform"></i>
                            </button>
                        </div>
                        
                        <div class="hidden md:flex w-[40%] p-8 items-center justify-center relative">
                            <div class="absolute w-64 h-64 bg-brand-orange/10 rounded-full blur-3xl group-hover:bg-brand-orange/20 transition duration-700"></div>
                            <img src="${p.mainImage || p.image}" class="max-h-[90%] object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.8)] transform group-hover:scale-110 transition duration-700 relative z-10">
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
    let launchProduct = allProductsCache.find(p => p.isNewLaunch === true && p.stock > 0);
    if (!launchProduct) launchProduct = allProductsCache.find(p => p.stock > 0); 

    const offers = allProductsCache.filter(p => p.stock > 0 && p.originalPrice > p.price && p.id !== launchProduct?.id).sort(() => 0.5 - Math.random()).slice(0, 2);

    let html = '';

    if (launchProduct) {
        const isCustomLaunch = !!launchProduct.launchBannerUrl;
        const launchImgWeb = launchProduct.launchBannerUrl || launchProduct.mainImage || launchProduct.image;

        if (isCustomLaunch) {
            html += `
            <div class="rounded-2xl cursor-pointer group hover:shadow-lg transition relative overflow-hidden h-40 bg-white" onclick="window.location.href='/shop/product.html?id=${launchProduct.id}'">
                <img src="${launchImgWeb}" class="absolute inset-0 w-full h-full object-fill transition duration-500 group-hover:scale-[1.02] z-0">
            </div>`;
        } else {
            html += `
            <div class="bg-brand-orange rounded-2xl p-6 flex flex-col justify-center cursor-pointer group hover:shadow-lg transition relative overflow-hidden h-40" onclick="window.location.href='/shop/product.html?id=${launchProduct.id}'">
                <span class="text-white/80 text-[9px] font-black uppercase tracking-widest mb-1 relative z-10">[NUEVO LANZAMIENTO]</span>
                <h3 class="text-white font-black text-base md:text-lg uppercase leading-tight line-clamp-2 mb-4 relative z-10 group-hover:opacity-80 transition">${launchProduct.name}</h3>
                <button class="bg-white text-brand-orange font-bold text-[10px] px-4 py-1.5 rounded-full w-max shadow-sm relative z-10 hover:scale-105 transition">Comprar Ahora</button>
                <img src="${launchImgWeb}" class="absolute -right-4 -bottom-4 h-32 object-contain opacity-50 group-hover:scale-110 transition duration-500 z-0 mix-blend-luminosity">
            </div>`;
        }
    }

    const styles = [
        { bg: 'bg-orange-50', textMain: 'text-brand-black', textSub: 'text-gray-500', btnBg: 'bg-brand-black', btnText: 'text-white' },
        { bg: 'bg-brand-black', textMain: 'text-white', textSub: 'text-gray-400', btnBg: 'bg-white', btnText: 'text-brand-black' }
    ];

    offers.forEach((p, i) => {
        const s = styles[i] || styles[0];
        const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
        html += `
        <div class="${s.bg} rounded-2xl p-6 flex flex-col justify-center cursor-pointer group hover:shadow-lg transition relative overflow-hidden h-40" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            <span class="${s.textSub} text-[9px] font-black uppercase tracking-widest mb-1 relative z-10">[OBTÉN ${disc}% DTO]</span>
            <h3 class="${s.textMain} font-black text-base md:text-lg uppercase leading-tight line-clamp-2 mb-4 relative z-10 group-hover:opacity-80 transition">${p.name}</h3>
            <button class="${s.btnBg} ${s.btnText} font-bold text-[10px] px-4 py-1.5 rounded-full w-max shadow-sm relative z-10 hover:scale-105 transition">Comprar Ahora</button>
            <img src="${p.mainImage || p.image}" class="absolute -right-4 -bottom-4 h-32 object-contain opacity-50 group-hover:scale-110 transition duration-500 z-0 mix-blend-luminosity">
        </div>`;
    });

    const totalRendered = (launchProduct ? 1 : 0) + offers.length;
    for(let i = totalRendered; i < 3; i++) {
         const s = styles[i-1] || styles[0];
         html += `
         <div class="${s.bg} rounded-2xl p-6 flex flex-col justify-center relative overflow-hidden h-40">
            <span class="${s.textSub} text-[9px] font-black uppercase tracking-widest mb-1">[PRÓXIMAMENTE]</span>
            <h3 class="${s.textMain} font-black text-base md:text-lg uppercase leading-tight line-clamp-2 mb-4 relative z-10">Nuevas Ofertas <br> en Camino</h3>
         </div>`;
    }

    container.innerHTML = html;
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

function createProductCard(p, style = "normal", prefix = "grid") {
    const isOutOfStock = (p.stock || 0) <= 0;
    const hasDiscount = !isOutOfStock && (p.originalPrice && p.originalPrice > p.price);
    const hasVariants = (p.hasVariants && p.variants?.length > 0) || (p.hasCapacities && p.capacities?.length > 0);
    
    let containerClasses = "";
    let contentHTML = "";

    let actionBtnHTML = "";
    if(!isOutOfStock) {
        if(hasVariants) {
            actionBtnHTML = `<button onclick="event.stopPropagation(); window.openCardOverlay('${p.id}', '${prefix}')" class="w-8 h-8 rounded-full bg-gray-50 border border-gray-100 text-gray-500 hover:bg-brand-orange hover:text-white transition flex items-center justify-center shadow-sm hover:shadow-md hover:-translate-y-0.5" title="Ver Opciones"><i class="fa-solid fa-list-ul text-[10px]"></i></button>`;
        } else {
            actionBtnHTML = `<button onclick="event.stopPropagation(); window.quickAdd('${p.id}')" class="w-8 h-8 rounded-full bg-gray-50 border border-gray-100 text-gray-500 hover:bg-brand-orange hover:text-white transition flex items-center justify-center shadow-sm hover:shadow-md hover:-translate-y-0.5" title="Agregar"><i class="fa-solid fa-cart-plus text-[10px]"></i></button>`;
        }
    }

    const overlayHTML = `<div id="overlay-${prefix}-${p.id}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

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
                <h3 class="text-sm text-gray-700 leading-tight mb-2 h-10 overflow-hidden group-hover:text-brand-orange transition">${p.name}</h3>
            </div>
            <div>
                <div class="flex text-yellow-400 text-[10px] mb-2">
                    <i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star-half-stroke"></i>
                </div>
                <div class="font-bold text-lg text-brand-orange flex items-center justify-between">
                    <div>
                        ${hasDiscount ? `<span class="line-through text-gray-400 text-xs font-normal mr-2">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                        $${p.price.toLocaleString('es-CO')}
                    </div>
                    ${actionBtnHTML}
                </div>
            </div>`;
    } 
    else {
        containerClasses = "border border-gray-100 rounded-2xl p-3 flex gap-4 items-center hover:shadow-lg hover:border-brand-orange/30 transition bg-white relative cursor-pointer group h-full";
        
        let badge = hasDiscount ? `<span class="absolute top-2 left-2 bg-brand-red text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm z-10">-${Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100)}%</span>` : '';

        let actionBtnMini = "";
        if(!isOutOfStock) {
            if(hasVariants) {
                actionBtnMini = `<button onclick="event.stopPropagation(); window.openCardOverlay('${p.id}', '${prefix}')" class="text-[9px] font-black text-gray-400 hover:text-brand-orange flex items-center gap-1 uppercase tracking-widest transition"><i class="fa-solid fa-list-ul"></i> Opciones</button>`;
            } else {
                actionBtnMini = `<button onclick="event.stopPropagation(); window.quickAdd('${p.id}')" class="text-[9px] font-black text-gray-400 hover:text-brand-orange flex items-center gap-1 uppercase tracking-widest transition"><i class="fa-solid fa-cart-plus"></i> Agregar</button>`;
            }
        } else {
            actionBtnMini = `<span class="text-[9px] text-red-500 font-black uppercase tracking-widest">Agotado</span>`;
        }

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
                <div class="flex items-center justify-between">
                     ${actionBtnMini}
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
            <div class="w-full h-[450px] bg-slate-50 rounded-[2.5rem] flex items-center justify-center border border-gray-100">
                <p class="text-gray-400 font-black uppercase tracking-widest text-xs">Preparando nuevas ofertas relámpago...</p>
            </div>`;
        return;
    }

    const p = offers[Math.floor(Math.random() * offers.length)];
    const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);

    container.innerHTML = `
        <div class="bg-slate-950 rounded-[2.5rem] p-8 md:p-14 flex flex-col md:flex-row items-center justify-between relative overflow-hidden shadow-[0_30px_60px_-15px_rgba(240,90,40,0.3)] border border-white/5 cursor-pointer group lg:h-[450px]" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            
            <div class="absolute top-0 right-0 w-96 h-96 bg-brand-orange/20 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
            <div class="absolute bottom-0 left-0 w-80 h-80 bg-purple-600/10 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>

            <div class="md:w-1/2 z-10 relative flex flex-col justify-center h-full">
                <div class="inline-flex items-center gap-2 bg-brand-red text-white text-[10px] font-black uppercase tracking-[0.2em] px-5 py-2.5 rounded-full mb-6 w-max shadow-xl animate-bounce">
                    <i class="fa-solid fa-bolt-lightning"></i> Oferta Relámpago
                </div>
                
                <h2 class="text-3xl md:text-4xl lg:text-5xl font-black mb-6 text-white leading-tight uppercase tracking-tighter group-hover:text-brand-orange transition-colors duration-500 line-clamp-3">
                    ${p.name}
                </h2>
                
                <div class="flex items-center gap-6 mb-8 mt-auto">
                    <div class="flex flex-col">
                        <span class="text-gray-500 line-through text-sm font-bold mb-1">Antes $${p.originalPrice.toLocaleString('es-CO')}</span>
                        <span class="text-4xl md:text-5xl font-black text-white tracking-tighter leading-none">$${p.price.toLocaleString('es-CO')}</span>
                    </div>
                    <div class="bg-brand-orange text-white px-4 py-2 rounded-xl font-black text-xl shadow-2xl transform -rotate-6 border-2 border-white/10">
                        -${disc}%
                    </div>
                </div>

                <button class="group/btn relative overflow-hidden bg-white text-brand-black font-black uppercase tracking-[0.2em] text-[10px] py-4 px-10 rounded-xl transition-all hover:scale-105 active:scale-95 shadow-[0_20px_40px_rgba(255,255,255,0.1)] w-max">
                    <span class="relative z-10 flex items-center gap-3">¡Aprovechar Ahora! <i class="fa-solid fa-arrow-right"></i></span>
                </button>
            </div>

            <div class="md:w-1/2 mt-10 md:mt-0 relative z-10 flex justify-center md:justify-end h-48 md:h-full w-full items-center">
                <div class="absolute inset-0 bg-brand-orange/30 rounded-full blur-[100px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
                <img src="${p.mainImage || p.image}" alt="${p.name}" 
                    class="relative z-10 w-full h-full max-h-[250px] lg:max-h-[350px] object-contain drop-shadow-[0_45px_45px_rgba(0,0,0,0.6)] transform group-hover:scale-110 group-hover:-rotate-3 transition-all duration-1000">
            </div>
        </div>
    `;
}

function loadPromotionsGrid() {
    const track = document.getElementById('promo-track');
    if (!track) return;

    const allProductsCache = SmartCache.getAllProducts();
    let flashOffers = allProductsCache.filter(p => p.stock > 0 && p.originalPrice > p.price && (p.isFlashOffer === true || p.offerType === 'flash'));
    
    if (flashOffers.length === 0) {
        flashOffers = allProductsCache.filter(p => p.stock > 0 && p.originalPrice > p.price);
    }

    if (flashOffers.length === 0) {
        track.innerHTML = `<div class="flex items-center justify-center h-full"><p class="text-[10px] text-gray-400 font-black uppercase tracking-widest">Sin ofertas activas</p></div>`;
        return;
    }

    flashOffers.sort(() => 0.5 - Math.random());
    let promoData = flashOffers; 
    
    const p = promoData[0];
    if(!p) return;

    const disc = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
    const hasVariants = (p.hasVariants && p.variants?.length > 0) || (p.hasCapacities && p.capacities?.length > 0);
    const actionAttr = hasVariants ? `window.openCardOverlay('${p.id}', 'promo')` : `window.quickAdd('${p.id}')`;

    const now = new Date();
    const hoursLeft = 23 - now.getHours();
    const minsLeft = 59 - now.getMinutes();

    const overlayHTML = `<div id="overlay-promo-${p.id}" class="absolute inset-0 bg-white/95 backdrop-blur-sm z-30 hidden flex-col justify-center p-3 transition-all duration-300 opacity-0 transform scale-95 pointer-events-none rounded-[inherit]"></div>`;

    track.innerHTML = `
        <div class="relative flex flex-col items-center text-center group cursor-pointer bg-white rounded-2xl p-4 shadow-sm border border-brand-orange/10 hover:shadow-xl transition-all duration-300 h-full w-full overflow-hidden" onclick="window.location.href='/shop/product.html?id=${p.id}'">
            <span class="absolute top-3 left-3 bg-brand-red text-white text-[8px] font-black px-2 py-1 rounded shadow-md z-10 uppercase tracking-widest animate-pulse">OFERTA ÚNICA</span>
            ${overlayHTML}
            
            <div class="w-full flex-1 relative my-4 min-h-[100px]">
                <img src="${p.mainImage || p.image}" class="absolute inset-0 w-full h-full object-contain group-hover:scale-110 transition duration-500 drop-shadow-md mix-blend-multiply">
            </div>

            <div class="w-full shrink-0">
                <div class="flex justify-center gap-2 mb-4 text-center text-[8px] text-brand-red uppercase font-black tracking-widest">
                    <div class="bg-red-50 rounded-lg border border-red-100 py-1 flex-1 shadow-inner"><span class="block font-black text-sm text-brand-black">${hoursLeft.toString().padStart(2, '0')}</span>HRS</div>
                    <div class="bg-red-50 rounded-lg border border-red-100 py-1 flex-1 shadow-inner"><span class="block font-black text-sm text-brand-black">${minsLeft.toString().padStart(2, '0')}</span>MIN</div>
                </div>

                <h4 class="font-black text-[11px] text-brand-black uppercase mb-1 line-clamp-2 group-hover:text-brand-orange transition min-h-[32px]">${p.name}</h4>
                
                <div class="font-black text-xl text-brand-orange mb-4">
                    <div class="flex items-center justify-center gap-2 leading-none">
                        <div class="text-right">
                            <span class="block line-through text-gray-400 text-[9px] font-bold mb-0.5">$${p.originalPrice.toLocaleString('es-CO')}</span>
                            $${p.price.toLocaleString('es-CO')}
                        </div>
                        <div class="bg-brand-red text-white text-[9px] px-1.5 py-0.5 rounded shadow-sm">-${disc}%</div>
                    </div>
                </div>
                
                <button onclick="event.stopPropagation(); ${actionAttr}" class="w-full bg-brand-black hover:bg-brand-orange text-white font-black uppercase tracking-widest text-[9px] py-3.5 rounded-xl transition shadow-lg flex items-center justify-center gap-2 group-hover:-translate-y-1">
                    <i class="fa-solid ${hasVariants ? 'fa-list-ul' : 'fa-cart-plus'}"></i> ${hasVariants ? 'OPCIONES' : 'AL CARRITO'}
                </button>
            </div>
        </div>
    `;
}

function loadBestSellers() {
    const grid = document.getElementById('dynamic-grid');
    const title = document.getElementById('section-title');
    if (!grid) return;

    if (title) title.innerHTML = `Los Más <span class="text-gray-400">Vendidos</span>`;

    const allProductsCache = SmartCache.getAllProducts();
    let best = allProductsCache.filter(p => p.stock > 0);
    best.sort(() => 0.5 - Math.random());

    const bestSellersData = best.slice(0, 9); 
    grid.innerHTML = bestSellersData.map(p => createProductCard(p, "normal", "best")).join('');
}

function loadFeatured() {
    const grid = document.getElementById('featured-grid');
    if (!grid) return;
    const allProductsCache = SmartCache.getAllProducts();
    const pool = allProductsCache.filter(p => p.stock > 0);
    pool.sort(() => 0.5 - Math.random());
    grid.innerHTML = pool.slice(0, 5).map(p => createProductCard(p, "compact", "feat")).join('');
}

function loadCategoriesBar() {
    const bar = document.getElementById('categories-bar');
    if (!bar) return;
    
    const categories = SmartCache.getCategories();
    if (categories.length === 0) return; 

    const displayCats = categories.slice(0, 6);
    bar.innerHTML = displayCats.map(cat => {
        const imgUrl = cat.image || `https://placehold.co/100x100/transparent/111111?text=${encodeURIComponent(cat.name)}`;
        return `
        <div onclick="window.location.href='/shop/catalog.html?category=${encodeURIComponent(cat.name)}'" class="bg-gray-50 rounded-xl p-6 flex flex-col items-center justify-center text-center hover:shadow-md hover:bg-white border border-transparent hover:border-brand-orange/20 transition cursor-pointer group">
            <img src="${imgUrl}" alt="${cat.name}" class="h-20 object-contain mb-4 group-hover:scale-110 transition duration-300 mix-blend-multiply">
            <h3 class="font-bold text-sm mb-1 text-brand-black group-hover:text-brand-orange transition">${cat.name}</h3>
            <span class="text-xs text-gray-500 underline decoration-gray-300 group-hover:text-brand-orange transition">Ver Más</span>
        </div>`;
    }).join('');
}

function loadExploreSection() {
    const catListContainer = document.getElementById('explore-categories-list');
    const gridContainer = document.getElementById('explore-products-grid');
    if (!catListContainer || !gridContainer) return;

    const categories = SmartCache.getCategories();
    if (categories.length === 0) return;

    catListContainer.innerHTML = categories.map((cat, idx) => `
        <button onclick="window.selectExploreCategory('${cat.name}', this)" class="explore-cat-btn ${idx === 0 ? 'bg-brand-orange text-white shadow-md' : 'bg-transparent text-gray-500 hover:bg-white border border-transparent hover:border-gray-200'} px-5 py-3.5 rounded-xl text-left text-[11px] font-black uppercase tracking-widest transition-all duration-300 shrink-0 lg:w-full flex items-center justify-between group">
            <span class="truncate">${cat.name}</span>
            <i class="fa-solid fa-chevron-right text-[10px] ${idx === 0 ? 'text-white' : 'text-gray-300 group-hover:text-brand-orange'} hidden lg:block transition-colors"></i>
        </button>
    `).join('');

    window.selectExploreCategory(categories[0].name, catListContainer.firstElementChild);
}

window.selectExploreCategory = (categoryName, btn) => {
    document.querySelectorAll('.explore-cat-btn').forEach(b => {
        b.classList.remove('bg-brand-orange', 'text-white', 'shadow-md');
        b.classList.add('bg-transparent', 'text-gray-500', 'hover:bg-white', 'border', 'border-transparent', 'hover:border-gray-200');
        const icon = b.querySelector('i');
        if (icon) {
            icon.classList.remove('text-white');
            icon.classList.add('text-gray-300', 'group-hover:text-brand-orange');
        }
    });

    if (btn) {
        btn.classList.remove('bg-transparent', 'text-gray-500', 'hover:bg-white', 'border', 'border-transparent', 'hover:border-gray-200');
        btn.classList.add('bg-brand-orange', 'text-white', 'shadow-md');
        const icon = btn.querySelector('i');
        if (icon) {
            icon.classList.remove('text-gray-300', 'group-hover:text-brand-orange');
            icon.classList.add('text-white');
        }
    }

    const grid = document.getElementById('explore-products-grid');
    const allProductsCache = SmartCache.getAllProducts();
    const filtered = allProductsCache.filter(p => p.category === categoryName && p.stock > 0);
    
    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-span-full flex items-center justify-center h-40"><p class="text-[10px] text-gray-400 font-black uppercase tracking-widest">Aún no hay productos en esta categoría</p></div>`;
        return;
    }

    const productsToShow = filtered.slice(0, 10);
    grid.innerHTML = productsToShow.map(p => createProductCard(p, "compact", "explore")).join('');
};

window.scrollBrands = (offset) => {
    const track = document.getElementById('brands-track-container');
    if (track) {
        track.scrollBy({ left: offset, behavior: 'smooth' });
    }
};

function loadBrandsMarquee() {
    const track = document.getElementById('brands-track-container');
    if (!track) return;
    
    const brands = SmartCache.getBrands();
    if (brands.length === 0) return;

    let displayBrands = [...brands, ...brands, ...brands, ...brands, ...brands];

    track.innerHTML = displayBrands.map(b => `
        <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="bg-white border border-gray-100 rounded-2xl h-24 w-36 flex items-center justify-center p-4 hover:border-brand-orange hover:shadow-lg transition-all duration-300 cursor-pointer group shrink-0">
            <img src="${b.image || 'https://placehold.co/100'}" class="max-h-full max-w-full object-contain opacity-60 group-hover:opacity-100 group-hover:scale-110 transition duration-500 mix-blend-multiply" alt="${b.name}">
        </a>
    `).join('');

    let isHovered = false;
    track.addEventListener('mouseenter', () => isHovered = true);
    track.addEventListener('mouseleave', () => isHovered = false);
    track.addEventListener('touchstart', () => isHovered = true);
    track.addEventListener('touchend', () => isHovered = false);

    function step() {
        if (!isHovered && track) {
            track.scrollLeft += 1.5; 
            if (track.scrollLeft >= (track.scrollWidth / 2)) {
                track.scrollLeft = 0;
            }
        }
        if (window.brandsAnimationFrame) cancelAnimationFrame(window.brandsAnimationFrame);
        window.brandsAnimationFrame = requestAnimationFrame(step);
    }
    
    if (window.brandsAnimationFrame) cancelAnimationFrame(window.brandsAnimationFrame);
    window.brandsAnimationFrame = requestAnimationFrame(step);
}

/* ==========================================================================
   🔥 BLOQUE DE INICIALIZACIÓN PROTEGIDO CONTRA CARGA ASÍNCRONA
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const checkDOMReady = setInterval(async () => {
        if (!document.getElementById("user-info-global") && !document.getElementById("main-hero-banner")) return;
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
            populateNavDropdowns();
            window.initMasterSliders();
        } else {
            updateCartCount();
            const loadChunks = [
                () => { loadMainBanner(); loadTripleBanners(); },
                () => { loadCategoriesBar(); loadFeatured(); },
                () => { renderBigPromoRandom(); loadPromotionsGrid(); },
                () => { loadBestSellers(); loadExploreSection(); },
                () => { loadBrandsMarquee(); window.initMasterSliders(); populateNavDropdowns(); } 
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
            populateNavDropdowns();
        });

        window.addEventListener('brandsUpdated', () => {
            loadBrandsMarquee();
            populateNavDropdowns();
        });
        
    }, 100);
});