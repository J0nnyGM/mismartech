import { auth, db, onAuthStateChanged, doc, getDoc, collection, getDocs, query, orderBy, where, limit } from "./firebase-init.js";
import { getCart, updateQuantity, removeFromCart } from "./shop/cart.js"; 
import { SmartCache } from "./shop/cache-service.js"; 

async function loadComponent(elementId, componentPath) {
    try {
        const response = await fetch(componentPath);
        if (!response.ok) throw new Error(`Error cargando ${componentPath}`);
        const html = await response.text();
        document.getElementById(elementId).innerHTML = html;
    } catch (error) {
        console.error(error);
    }
}

// --- 🔥 INTERCEPTOR GLOBAL DE USUARIO (Header Sync) ---
const staffRoles = ['admin', 'contabilidad', 'ventas', 'logistica'];

export function initUserHeaderAuth() {
    onAuthStateChanged(auth, async (user) => {
        const userInfo = document.getElementById("user-info-global");
        const mobileProfileLink = document.getElementById("mobile-profile-link");

        const updateMobileLink = (isStaff, isLoggedIn) => {
            if (!mobileProfileLink) return;
            if (isLoggedIn) {
                mobileProfileLink.href = isStaff ? '/admin/index.html' : '/profile.html';
                const labelSpan = mobileProfileLink.querySelector('span');
                const iconI = mobileProfileLink.querySelector('i');
                if (labelSpan) labelSpan.textContent = isStaff ? 'Admin' : 'Perfil';
                if (iconI) {
                    iconI.className = isStaff ? 'fa-solid fa-user-shield text-xl mb-1 text-brand-orange' : 'fa-regular fa-user text-xl mb-1';
                    if (isStaff) {
                        labelSpan.classList.add('text-brand-orange');
                    } else {
                        labelSpan.classList.remove('text-brand-orange');
                    }
                }
            } else {
                mobileProfileLink.href = '/auth/login.html';
                const labelSpan = mobileProfileLink.querySelector('span');
                const iconI = mobileProfileLink.querySelector('i');
                if (labelSpan) labelSpan.textContent = 'Perfil';
                if (iconI) {
                    iconI.className = 'fa-regular fa-user text-xl mb-1';
                    labelSpan.classList.remove('text-brand-orange');
                }
            }
        };

        const updateMobileMenuDrawer = (isStaff) => {
            const drawerLinks = document.getElementById("mobile-user-panel-links");
            if (!drawerLinks) return;
            
            // Remove existing dynamic admin link if any, to avoid duplication
            const existingAdminLink = drawerLinks.querySelector('.dynamic-admin-link');
            if (existingAdminLink) {
                existingAdminLink.remove();
            }
            
            if (isStaff) {
                const adminLink = document.createElement('a');
                adminLink.href = '/admin/index.html';
                adminLink.className = 'dynamic-admin-link flex items-center gap-4 p-3 rounded-xl bg-orange-50 border border-orange-100 hover:border-brand-orange/30 transition group';
                adminLink.innerHTML = `
                    <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-orange shadow-sm border border-gray-50">
                        <i class="fa-solid fa-user-shield text-xs"></i>
                    </div>
                    <span class="font-bold text-xs text-brand-black uppercase tracking-tight group-hover:text-brand-orange transition">Panel Administración</span>
                `;
                
                const titleNode = drawerLinks.querySelector('p');
                if (titleNode && titleNode.nextSibling) {
                    drawerLinks.insertBefore(adminLink, titleNode.nextSibling);
                } else {
                    drawerLinks.appendChild(adminLink);
                }
            }
        };

        if (user) {
            const cachedRole = sessionStorage.getItem(`role_${user.uid}`);
            if (cachedRole) {
                const isStaff = staffRoles.includes(cachedRole);
                if (userInfo) renderUserButton(isStaff, userInfo);
                updateMobileLink(isStaff, true);
                updateMobileMenuDrawer(isStaff);
            } else {
                try {
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    const role = userDoc.exists() ? userDoc.data().role || 'customer' : 'customer';
                    sessionStorage.setItem(`role_${user.uid}`, role);
                    const isStaff = staffRoles.includes(role);
                    if (userInfo) renderUserButton(isStaff, userInfo);
                    updateMobileLink(isStaff, true);
                    updateMobileMenuDrawer(isStaff);
                } catch (e) {
                    if (userInfo) renderUserButton(false, userInfo);
                    updateMobileLink(false, true);
                    updateMobileMenuDrawer(false);
                }
            }
        } else {
            if (userInfo) {
                userInfo.innerHTML = `
                    <a href="/auth/login.html" class="flex flex-col items-center gap-1 group w-14 cursor-pointer">
                        <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center group-hover:bg-brand-orange transition duration-300 shadow-sm">
                            <i class="fa-regular fa-user text-lg text-gray-500 group-hover:text-white"></i>
                        </div>
                        <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-orange text-center">Ingresar</span>
                    </a>`;
            }
            updateMobileLink(false, false);
            updateMobileMenuDrawer(false);
        }
    });
}

function renderUserButton(isStaff, userInfoNode) {
    const targetPath = isStaff ? '/admin/index.html' : '/profile.html';
    const label = isStaff ? 'Admin' : 'Cuenta';
    userInfoNode.innerHTML = `
        <a href="${targetPath}" class="flex flex-col items-center gap-1 group w-14">
            <div class="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-brand-orange text-white flex items-center justify-center shadow-md transition duration-300 hover:shadow-lg hover:-translate-y-1">
                <i class="fa-solid ${isStaff ? 'fa-user-shield' : 'fa-user-check'} text-lg"></i>
            </div>
            <span class="hidden md:block text-[8px] font-black uppercase tracking-widest text-brand-orange text-center">${label}</span>
        </a>`;
}

export async function loadGlobalHeader() {
    // Inyectar estilos globales de componentes del header, buscador y notificaciones toast
    if (!document.getElementById('global-header-component-styles')) {
        const style = document.createElement('style');
        style.id = 'global-header-component-styles';
        style.textContent = `
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            
            .mask-fade {
                -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
                mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
            }

            .drawer-shadow { box-shadow: -10px 0 30px rgba(0,0,0,0.2); }
            .menu-tab-btn.active { border-color: var(--color-brand-orange, #F05A28); color: var(--color-brand-orange, #F05A28); }
            .menu-tab-content.hidden { display: none; }
            .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
            .animate-bounce-slow { animation: bounce 3s infinite; }
            .animate-in-up { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
            @keyframes slideUp { from { transform: translateY(20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
            .smooth-drawer { transition-property: transform, opacity, visibility; transition-duration: 500ms; transition-timing-function: cubic-bezier(0.19, 1, 0.22, 1); will-change: transform; }
            
            #toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
            .toast { pointer-events: auto; background: white; padding: 12px 20px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 12px; transform: translateX(100%); opacity: 0; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); border-left: 4px solid var(--color-brand-orange, #F05A28); max-width: 350px; }
            .toast.show { transform: translateX(0); opacity: 1; }
            .toast.error { border-left-color: #EF4444; }
            .toast-icon { font-size: 18px; }
            .toast-msg { font-size: 12px; font-weight: 800; color: #0F0F0F; text-transform: uppercase; letter-spacing: 0.05em; }

            .search-dropdown { position: absolute; top: 100%; left: 0; width: 100%; background: white; border-radius: 0 0 20px 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); z-index: 50; overflow: hidden; display: none; margin-top: 2px; border: 1px solid #f3f4f6; }
            .search-dropdown.active { display: block; animation: slideDown 0.2s ease-out; }
            @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            .search-result-item { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #f9fafb; cursor: pointer; transition: background 0.2s; }
            .search-result-item:hover { background-color: #fff7ed; } 
            .search-result-item:last-child { border-bottom: none; }
        `;
        document.head.appendChild(style);
    }

    // Inicializar SmartCache globalmente para poblar menús en todas las páginas
    try {
        await SmartCache.init();
    } catch (e) {
        console.warn("⚠️ No se pudo inicializar SmartCache en el header:", e);
    }

    const headerPlaceholder = document.getElementById('header-placeholder');
    if (headerPlaceholder) {
        await loadComponent('header-placeholder', '/includes/header.html');
    }
    
    injectCartDrawerHTML(); // Inyecta el carrito flotante
    initHeaderLogic();
    initSearchLogic();
    populateMegaMenus(); 
    initUserHeaderAuth(); // 🔥 Activado globalmente para todas las páginas de la tienda
}

export async function loadGlobalFooter() {
    const footerPlaceholder = document.getElementById('footer-placeholder');
    if (footerPlaceholder) {
        await loadComponent('footer-placeholder', '/includes/footer.html');
    }
}

window.showToast = (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = '<i class="fa-solid fa-circle-check text-brand-orange toast-icon"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-circle-exclamation text-brand-red toast-icon"></i>';
    toast.innerHTML = `${icon}<span class="toast-msg">${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.classList.add('show'); });
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
};

// --- LÓGICA DE BÚSQUEDA ---
export function initSearchLogic() {
    const setupSearch = (inputId, resultsId) => {
        const input = document.getElementById(inputId);
        const results = document.getElementById(resultsId);
        let debounceTimer;

        if (!input || !results) return;

        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !results.contains(e.target)) {
                results.classList.remove('active');
            }
        });

        input.addEventListener('input', (e) => {
            const term = e.target.value.trim().toLowerCase();
            clearTimeout(debounceTimer);

            if (term.length < 2) {
                results.innerHTML = '';
                results.classList.remove('active');
                return;
            }

            debounceTimer = setTimeout(async () => {
                try {
                    const localProducts = SmartCache.getAllProducts();
                    let resultsArray = [];

                    if (localProducts.length > 0) {
                        resultsArray = localProducts.filter(p => {
                            const name = (p.name || "").toLowerCase();
                            const cat = (p.category || "").toLowerCase();
                            return (name.includes(term) || cat.includes(term)) && p.status === 'active';
                        });
                    } else {
                        const q = query(collection(db, "products"), where("status", "==", "active"), limit(20));
                        const snap = await getDocs(q);
                        const products = [];
                        snap.forEach(d => products.push({ id: d.id, ...d.data() }));

                        resultsArray = products.filter(p => {
                            const name = (p.name || "").toLowerCase();
                            const cat = (p.category || "").toLowerCase();
                            return name.includes(term) || cat.includes(term);
                        });
                    }

                    renderResults(resultsArray.slice(0, 5), term);

                } catch (err) {
                    console.error("Search error", err);
                }
            }, 300);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const term = input.value.trim();
                if (term) window.location.href = `/shop/search.html?q=${encodeURIComponent(term)}`;
            }
        });

        function renderResults(products, term) {
            results.innerHTML = '';

            if (products.length === 0) {
                results.innerHTML = `
                    <div class="p-4 text-center">
                        <p class="text-[10px] font-bold text-gray-400 uppercase">No hay resultados directos</p>
                        <button onclick="window.location.href='/shop/search.html?q=${encodeURIComponent(term)}'" class="text-brand-orange text-xs font-black mt-1 hover:underline">Buscar "${term}" en todo el catálogo</button>
                    </div>`;
            } else {
                products.forEach(p => {
                    const img = p.mainImage || p.image || 'https://placehold.co/50';
                    const price = p.price.toLocaleString('es-CO');

                    results.innerHTML += `
                        <div onclick="window.location.href='/shop/product.html?id=${p.id}'" class="search-result-item hover:bg-orange-50/50">
                            <img src="${img}" class="w-10 h-10 object-contain rounded-lg bg-gray-50 border border-gray-100 p-1">
                            <div class="flex-grow min-w-0">
                                <p class="text-[10px] font-black text-brand-black uppercase truncate group-hover:text-brand-orange transition">${p.name}</p>
                                <p class="text-[9px] font-bold text-gray-400">${p.category || 'Producto'}</p>
                            </div>
                            <span class="text-xs font-black text-brand-orange">$${price}</span>
                        </div>
                    `;
                });

                if (products.length >= 5) {
                    results.innerHTML += `
                        <div onclick="window.location.href='/shop/search.html?q=${encodeURIComponent(term)}'" class="p-3 text-center bg-gray-50 cursor-pointer hover:bg-brand-orange hover:text-white transition group">
                            <span class="text-[9px] font-black uppercase tracking-widest transition">Ver todos los resultados</span>
                        </div>
                    `;
                }
            }
            results.classList.add('active');
        }
    };

    setupSearch('search-desktop', 'search-results-desktop');
    setupSearch('search-mobile', 'search-results-mobile');
}

// --- INYECCIÓN Y LÓGICA DEL CARRITO LATERAL (DRAWER) ---
export function injectCartDrawerHTML() {
    if (document.getElementById('cart-drawer-container')) return;

    const drawerHTML = `
    <div id="cart-drawer-container" class="fixed inset-0 z-[100] pointer-events-none">
        <div id="cart-overlay" class="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 transition-opacity duration-500 pointer-events-auto" style="display: none;" onclick="window.toggleCartDrawer()"></div>
        <div id="cart-drawer" class="absolute right-0 top-0 w-full max-w-[420px] h-full bg-white shadow-2xl flex flex-col drawer-shadow translate-x-full smooth-drawer pointer-events-auto invisible">
            
            <div class="p-6 bg-white flex justify-between items-center z-10 relative border-b border-gray-100">
                <h3 class="font-black text-lg uppercase tracking-tight flex items-center gap-3 text-brand-black">
                    <i class="fa-solid fa-bag-shopping text-brand-orange"></i> MI CARRITO
                </h3>
                <button onclick="window.toggleCartDrawer()" aria-label="Cerrar carrito" class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-gray-200 transition">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div id="cart-shipping-bar" class="px-8 pt-6 pb-2 bg-white hidden">
                <p id="shipping-msg-drawer" class="text-[9px] font-bold text-gray-500 uppercase tracking-wide text-center mb-2">Calculando envío...</p>
                <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div id="shipping-progress-drawer" class="h-full bg-brand-orange transition-all duration-500 w-0"></div>
                </div>
            </div>

            <div id="cart-drawer-items" class="flex-grow overflow-y-auto px-6 py-4 space-y-4 no-scrollbar relative bg-white">
                </div>

            <div class="p-6 border-t border-gray-100 bg-white z-10 relative">
                <div class="flex justify-between items-end mb-6">
                    <span class="text-[10px] font-black uppercase text-gray-400 tracking-widest">SUBTOTAL</span>
                    <span id="cart-drawer-total" class="text-3xl font-black text-brand-black tracking-tighter">$0</span>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <a href="/shop/cart.html" class="py-4 rounded-xl border-2 border-gray-100 text-brand-black font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:border-brand-black transition">VER CARRITO</a>
                    <a href="/shop/checkout.html" class="py-4 rounded-xl bg-brand-black text-white font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:bg-gray-800 transition shadow-xl">PAGAR AHORA</a>
                </div>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', drawerHTML);
}

export async function initHeaderLogic() {
    // Inyectar estilos globales de marquee para evitar duplicación en HTMLs
    if (!document.getElementById('global-marquee-styles')) {
        const style = document.createElement('style');
        style.id = 'global-marquee-styles';
        style.textContent = `
            .animate-marquee { display: flex; width: max-content; animation: marquee 45s linear infinite; }
            .marquee-container:hover .animate-marquee { animation-play-state: paused; }
            @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        `;
        document.head.appendChild(style);
    }

    const topBanner = document.getElementById('top-banner-dynamic');

    if (topBanner) {
        const renderBanner = (data) => {
            let freeHTML = '';
            if (data && data.freeThreshold > 0) {
                freeHTML = `<span class="mx-8 flex items-center gap-2 text-brand-orange"><i class="fa-solid fa-gift animate-pulse"></i> ENVÍO GRATIS DESDE $${parseInt(data.freeThreshold).toLocaleString('es-CO')}</span>`;
            }
            const baseContent = `<span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-truck-fast text-brand-orange"></i> Envíos a toda Colombia</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-hand-holding-dollar text-brand-orange"></i> Contra entrega disponible</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-credit-card text-brand-orange"></i> Paga con MERCADOPAGO o SISTECREDITO</span>${freeHTML}`;
            
            topBanner.innerHTML = `<div class="flex items-center animate-marquee font-black uppercase tracking-[0.3em]">${baseContent} ${baseContent} ${baseContent}</div>`;
        };

        const currentCacheStr = sessionStorage.getItem('mismartech_shipping_config');
        if (currentCacheStr) {
            renderBanner(JSON.parse(currentCacheStr));
        } else {
            topBanner.innerHTML = `<div class="flex items-center justify-center font-black uppercase tracking-[0.3em] h-full"><span class="mx-8">CARGANDO PROMOCIONES... <i class="fa-solid fa-circle-notch fa-spin ml-2"></i></span></div>`;
        }

        const fetchShipping = async () => {
            if (!navigator.onLine) {
                renderBanner(null);
                return;
            }
            try {
                const snap = await getDoc(doc(db, "config", "shipping"));
                if (snap.exists()) {
                    const data = snap.data();
                    const newDataStr = JSON.stringify(data);
                    renderBanner(data);
                    sessionStorage.setItem('mismartech_shipping_config', newDataStr);
                    window.dispatchEvent(new Event('shippingConfigUpdated'));
                } else {
                    renderBanner(null);
                }
            } catch (error) { 
                console.warn("No se pudo cargar la config de envíos, usando default:", error);
                renderBanner(null);
            }
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(fetchShipping);
        } else {
            setTimeout(fetchShipping, 1000); 
        }
    }

    window.toggleWhatsAppModal = () => {
        const modal = document.getElementById('wa-modal');
        const overlay = document.getElementById('wa-overlay');
        if (modal && overlay) {
            modal.classList.toggle('hidden');
            modal.classList.toggle('flex');
            overlay.classList.toggle('hidden');
        }
    };

    let isDrawerAnimating = false;
    window.toggleCartDrawer = (forceOpen = false) => {
        const cartDrawer = document.getElementById('cart-drawer');
        const cartOverlay = document.getElementById('cart-overlay');
        if (!cartDrawer || !cartOverlay || isDrawerAnimating) return;
        
        const isClosed = cartDrawer.classList.contains('translate-x-full');
        isDrawerAnimating = true;

        if (isClosed || forceOpen) {
            cartDrawer.classList.remove('invisible');
            void cartDrawer.offsetWidth; // Force reflow
            cartOverlay.style.display = 'block';
            void cartOverlay.offsetWidth;
            cartOverlay.classList.remove('opacity-0');
            cartOverlay.classList.add('opacity-100');
            cartDrawer.classList.remove('translate-x-full');
            window.renderCartDrawerItems();
            setTimeout(() => { isDrawerAnimating = false; }, 500);
        } else {
            cartDrawer.classList.add('translate-x-full');
            cartOverlay.classList.remove('opacity-100');
            cartOverlay.classList.add('opacity-0');
            setTimeout(() => { 
                cartOverlay.style.display = 'none'; 
                cartDrawer.classList.add('invisible');
                isDrawerAnimating = false; 
            }, 500);
        }
    };

    window.changeDrawerQty = (cartId, currentQty, change) => {
        const newQty = currentQty + change;
        if (newQty < 1) return;
        const result = updateQuantity(cartId, newQty);
        if (!result.success && result.message) {
            window.showToast(result.message, 'error');
        } else {
            window.renderCartDrawerItems();
            window.updateCartCountGlobal();
        }
    };

    window.removeCartItemDrawer = (cartId) => {
        removeFromCart(cartId);
        window.renderCartDrawerItems();
        window.updateCartCountGlobal();
    };

    window.renderCartDrawerItems = () => {
        const container = document.getElementById('cart-drawer-items');
        const totalEl = document.getElementById('cart-drawer-total');
        const shippingBarContainer = document.getElementById('cart-shipping-bar');
        const shippingMsg = document.getElementById('shipping-msg-drawer');
        const shippingBar = document.getElementById('shipping-progress-drawer');
        
        const cart = getCart();

        if (cart.length === 0) {
            container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center opacity-50 py-10"><i class="fa-solid fa-basket-shopping text-6xl text-gray-200 mb-4"></i><p class="text-xs font-bold text-gray-400 uppercase tracking-widest">Tu carrito está vacío</p></div>`;
            totalEl.textContent = "$0";
            shippingBarContainer.classList.add('hidden');
            return;
        }

        let subtotal = 0;
        container.innerHTML = cart.map((item) => {
            const itemSubtotal = item.price * item.quantity;
            subtotal += itemSubtotal;
            
            const hasPromo = item.originalPrice && item.originalPrice > item.price;
            let promoHTML = '';
            let badgePromoHTML = '';
            
            if (hasPromo) {
                const itemOriginalSubtotal = item.originalPrice * item.quantity;
                const discPercent = Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100);
                const savings = (item.originalPrice - item.price) * item.quantity;
                
                promoHTML = `
                    <div class="flex items-center gap-2 mt-1.5">
                        <span class="text-sm font-black text-brand-orange">$${itemSubtotal.toLocaleString('es-CO')}</span>
                        <span class="line-through text-gray-400 text-xs font-semibold">$${itemOriginalSubtotal.toLocaleString('es-CO')}</span>
                    </div>
                    <div class="text-[10px] font-black text-emerald-700 uppercase tracking-wide mt-2 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 w-max flex items-center gap-1 shadow-sm">
                        <i class="fa-solid fa-tags text-[9px]"></i> ¡Ahorras $${savings.toLocaleString('es-CO')}!
                    </div>
                `;
                
                badgePromoHTML = `
                    <span class="absolute -top-1.5 -left-1.5 bg-brand-red text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm z-10 uppercase tracking-wider">
                        -${discPercent}%
                    </span>
                `;
            } else {
                promoHTML = `<div class="text-sm font-black text-brand-black mt-1.5">$${itemSubtotal.toLocaleString('es-CO')}</div>`;
            }
            
            return `
            <div class="bg-white p-4 rounded-2xl border border-gray-100 flex flex-col gap-4 relative group transition hover:border-brand-orange hover:shadow-md">
                <div class="flex gap-4 items-center">
                    <div class="w-20 h-20 bg-gray-50 rounded-xl border border-gray-100 p-1.5 shrink-0 flex items-center justify-center relative">
                        ${badgePromoHTML}
                        <img src="${item.image || 'https://placehold.co/50'}" class="max-h-full max-w-full object-contain mix-blend-multiply">
                    </div>
                    <div class="flex-grow min-w-0 pr-1">
                        <h4 class="text-xs font-bold uppercase text-brand-black leading-snug line-clamp-2 tracking-tight">${item.name}</h4>
                        ${item.capacity || item.color ? `<p class="text-[11px] font-bold text-gray-400 mt-1 uppercase tracking-wide">${item.color || ''} ${item.capacity || ''}</p>` : ''}
                        
                        ${promoHTML}
                    </div>
                </div>
                
                <div class="flex items-center justify-between border-t border-gray-50 pt-3">
                    <div class="flex items-center bg-gray-50 rounded-xl h-8 border border-gray-200 w-24 overflow-hidden">
                        <button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, -1)" class="flex-1 h-full flex items-center justify-center text-gray-400 hover:text-brand-black hover:bg-gray-200 transition font-bold text-xs">-</button>
                        <span class="flex-1 text-center text-xs font-black text-brand-black bg-white h-full flex items-center justify-center border-x border-gray-200 shadow-inner">${item.quantity}</span>
                        <button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, 1)" class="flex-1 h-full flex items-center justify-center text-gray-400 hover:text-brand-black hover:bg-gray-200 transition font-bold text-xs">+</button>
                    </div>
                    <button onclick="window.removeCartItemDrawer('${item.cartId}')" class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 border border-gray-100 transition shadow-sm active:scale-90">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

        totalEl.textContent = `$${subtotal.toLocaleString('es-CO')}`;

        try {
            const cachedConfig = sessionStorage.getItem('mismartech_shipping_config');
            if (cachedConfig) {
                const data = JSON.parse(cachedConfig);
                const threshold = parseInt(data.freeThreshold) || 0;
                if (threshold > 0) {
                    shippingBarContainer.classList.remove('hidden');
                    const diff = threshold - subtotal;
                    let percent = subtotal >= threshold ? 100 : (subtotal / threshold) * 100;
                    shippingBar.style.width = `${percent}%`;
                    
                    if (diff > 0) {
                        shippingMsg.innerHTML = `TE FALTAN <span class="text-brand-orange font-black">$${diff.toLocaleString('es-CO')}</span> PARA ENVÍO GRATIS`;
                        shippingBar.classList.remove('bg-emerald-500'); shippingBar.classList.add('bg-brand-orange');
                    } else {
                        shippingMsg.innerHTML = `<span class="text-emerald-500 font-black"><i class="fa-solid fa-check-circle"></i> ¡TIENES ENVÍO GRATIS!</span>`;
                        shippingBar.classList.remove('bg-brand-orange'); shippingBar.classList.add('bg-emerald-500');
                    }
                } else {
                    shippingBarContainer.classList.add('hidden');
                }
            }
        } catch (e) { console.error(e); }
    };

    window.updateCartCountGlobal = () => {
        const cart = getCart(); 
        const count = cart.reduce((acc, i) => acc + (i.quantity || 1), 0);
        
        const badges = [
            document.getElementById('cart-count-desktop'),
            document.getElementById('cart-count-mobile'),
            document.getElementById('cart-count-mobile-top')
        ];
        
        badges.forEach(badge => {
            if (badge) {
                badge.textContent = count;
                count > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
            }
        });
    };

    // --- EVENT LISTENERS ---
    window.addEventListener('cartItemAdded', (e) => {
        window.updateCartCountGlobal();
        if (e.detail && e.detail.isFirstProduct) {
            window.toggleCartDrawer(true); 
        }
    });

    window.addEventListener('cartUpdated', () => {
        window.updateCartCountGlobal();
        const drawer = document.getElementById('cart-drawer');
        if (drawer && !drawer.classList.contains('translate-x-full')) {
            window.renderCartDrawerItems();
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'smartech_cart') window.updateCartCountGlobal();
    });

    window.updateCartCountGlobal();

    const drawer = document.getElementById('mobile-menu-drawer');
    const overlay = document.getElementById('mobile-menu-overlay');
    const btnClose = document.getElementById('mobile-drawer-close');
    const btnCategories = document.getElementById('mobile-categories-btn');
    const btnMenu = document.getElementById('mobile-menu-btn');
    const tabs = document.querySelectorAll('.menu-tab-btn');

    const openDrawer = (tabName) => {
        if (!drawer) return;
        drawer.classList.remove('translate-x-[-100%]'); drawer.classList.add('translate-x-0'); overlay.classList.remove('opacity-0');
        tabs.forEach(t => {
            if (t.dataset.tab === tabName) { t.classList.add('active'); document.getElementById(tabName).classList.remove('hidden'); }
            else { t.classList.remove('active'); document.getElementById(t.dataset.tab).classList.add('hidden'); }
        });
    };
    const closeDrawer = () => { if (!drawer) return; drawer.classList.add('translate-x-[-100%]'); drawer.classList.remove('translate-x-0'); overlay.classList.add('opacity-0'); };

    if (btnCategories) btnCategories.onclick = () => openDrawer('tab-categories');
    if (btnMenu) btnMenu.onclick = () => openDrawer('tab-menu');
    if (btnClose) btnClose.onclick = closeDrawer;
    if (overlay) overlay.onclick = closeDrawer;

    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active')); tab.classList.add('active');
            document.querySelectorAll('.menu-tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(tab.dataset.tab).classList.remove('hidden');
        };
    });

    const initDelayedTasks = () => {
        syncAllCategories();
    };

    if ('requestIdleCallback' in window) {
        requestIdleCallback(initDelayedTasks);
    } else {
        setTimeout(initDelayedTasks, 1000); 
    }
}

// --- MEGA MENÚS (ESCRITORIO) ---
export function populateMegaMenus() {
    const catDropdown = document.getElementById('nav-categories-dropdown');
    const brandDropdown = document.getElementById('nav-brands-dropdown');

    if (catDropdown) {
        const categories = SmartCache.getCategories();
        if (categories.length > 0) {
            catDropdown.innerHTML = categories.map(cat => `
                <a href="/shop/catalog.html?category=${encodeURIComponent(cat.name)}" class="w-32 md:w-40 bg-white border border-gray-100 rounded-[1.5rem] hover:border-brand-orange hover:shadow-[0_10px_20px_rgba(240,90,40,0.15)] transition-all duration-300 group flex flex-col relative overflow-hidden shrink-0 p-4 items-center text-center hover:-translate-y-1">
                    <div class="h-20 w-full mb-3 flex items-center justify-center rounded-2xl group-hover:bg-orange-50/70 transition-colors duration-300 p-2">
                        <img src="${cat.image || 'https://placehold.co/100'}" class="max-h-full max-w-full object-contain mix-blend-multiply group-hover:scale-125 transition-all duration-300 drop-shadow-sm group-hover:drop-shadow-md">
                    </div>
                    <span class="text-[10px] md:text-[11px] font-black uppercase text-brand-black tracking-widest group-hover:text-brand-orange transition-colors w-full line-clamp-2">
                        ${cat.name}
                    </span>
                </a>
            `).join('');
        }
    }

    if (brandDropdown) {
        const brands = SmartCache.getBrands();
        if (brands.length > 0) {
            brandDropdown.innerHTML = brands.map(b => `
                <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="w-32 md:w-40 bg-white border border-gray-100 rounded-[1.5rem] hover:border-brand-orange hover:shadow-[0_10px_20px_rgba(240,90,40,0.15)] transition-all duration-300 group flex flex-col relative overflow-hidden shrink-0 p-4 items-center text-center hover:-translate-y-1">
                    <div class="h-20 w-full mb-3 flex items-center justify-center rounded-2xl group-hover:bg-orange-50/70 transition-colors duration-300 p-2">
                        <img src="${b.image || 'https://placehold.co/100'}" class="max-h-full max-w-full object-contain mix-blend-multiply opacity-70 group-hover:opacity-100 group-hover:scale-125 transition-all duration-300 drop-shadow-sm group-hover:drop-shadow-md">
                    </div>
                    <span class="text-[10px] md:text-[11px] font-black uppercase text-brand-black tracking-widest group-hover:text-brand-orange transition-colors w-full line-clamp-2">
                        ${b.name}
                    </span>
                </a>
            `).join('');
        }
    }
}

window.addEventListener('categoriesUpdated', populateMegaMenus);
window.addEventListener('brandsUpdated', populateMegaMenus);
window.populateMegaMenus = populateMegaMenus;

// --- CARGA DE CATEGORÍAS (MENÚ MÓVIL) ---
async function syncAllCategories() {
    const mobileList = document.getElementById('categories-mobile-list');
    if (!mobileList) return;

    let categories = SmartCache.getCategories();

    if (categories.length === 0) {
        try {
            const q = query(collection(db, "categories"), orderBy("name", "asc"));
            const snap = await getDocs(q);
            categories = [];
            snap.forEach(doc => categories.push({ id: doc.id, ...doc.data() }));
        } catch (e) {
            mobileList.innerHTML = `<p class="text-xs text-red-400 p-4">Error cargando menú.</p>`;
            return;
        }
    }

    renderMobileMenuHTML(mobileList, categories);
}

function renderMobileMenuHTML(container, categories) {
    container.innerHTML = `
        <a href="/shop/catalog.html" class="group flex items-center gap-3 p-3 mb-2 rounded-xl hover:bg-orange-50 transition-all border border-transparent hover:border-brand-orange/20">
            <div class="w-8 h-8 rounded-lg bg-brand-orange text-white flex items-center justify-center shrink-0 shadow-md group-hover:scale-95 transition-transform"><i class="fa-solid fa-store text-xs"></i></div>
            <div class="flex flex-col"><span class="text-[10px] font-black uppercase tracking-widest text-brand-black group-hover:text-brand-orange transition">Ver Catálogo Completo</span><span class="text-[8px] font-bold text-gray-400">Explorar todos los productos</span></div>
            <i class="fa-solid fa-arrow-right text-gray-300 ml-auto text-xs group-hover:text-brand-orange group-hover:translate-x-1 transition-all"></i>
        </a>
        <div class="h-px w-full bg-gray-100 my-2"></div>
    `;

    categories.forEach(cat => {
        const subcats = cat.subcategories || [];
        const catUrl = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
        const accordionId = `acc-${(cat.id || cat.name).replace(/\s+/g, '-')}`;

        if (subcats.length === 0) {
            container.innerHTML += `
                <a href="${catUrl}" class="flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition duration-300 mb-1 border-b border-gray-50 last:border-0 hover:text-brand-orange">
                    <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                    <i class="fa-solid fa-chevron-right text-[10px] text-gray-300"></i>
                </a>`;
        } else {
            const subListHTML = subcats.map(sub => {
                const subName = typeof sub === 'string' ? sub : sub.name;
                return `<a href="/shop/catalog.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}" class="block py-3 px-4 text-[10px] font-bold text-gray-500 hover:text-brand-orange border-l-2 border-gray-100 hover:border-brand-orange ml-3 transition-all">${subName}</a>`
            }).join('');

            container.innerHTML += `
                <div class="mb-1 border-b border-gray-50 last:border-0 transition-all duration-300 group-accordion">
                    <button class="w-full flex items-center justify-between p-4 text-left focus:outline-none hover:bg-slate-50 hover:text-brand-orange rounded-2xl transition" onclick="window.toggleAccordion('${accordionId}')">
                        <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                        <div class="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 transition-transform duration-300 icon-rotate"><i class="fa-solid fa-chevron-down text-[9px]"></i></div>
                    </button>
                    <div id="${accordionId}" class="hidden bg-white px-2 pb-2">
                        <a href="${catUrl}" class="block py-3 px-4 text-[10px] font-black text-brand-black uppercase tracking-widest border-b border-dashed border-gray-100 mb-1 hover:text-brand-orange">Ver todo ${cat.name}</a>
                        <div class="pl-2 space-y-1 mt-1">${subListHTML}</div>
                    </div>
                </div>`;
        }
    });

    if (!window.toggleAccordion) {
        window.toggleAccordion = (id) => {
            const content = document.getElementById(id);
            if (!content) return;
            const btn = content.previousElementSibling;
            const icon = btn.querySelector('.icon-rotate');

            if (content.classList.contains('hidden')) {
                content.classList.remove('hidden');
                icon.classList.add('rotate-180', 'bg-brand-orange', 'text-white');
                icon.classList.remove('bg-gray-50', 'text-gray-400');
            } else {
                content.classList.add('hidden');
                icon.classList.remove('rotate-180', 'bg-brand-orange', 'text-white');
                icon.classList.add('bg-gray-50', 'text-gray-400');
            }
        };
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('SW registrado: ', reg.scope))
            .catch(err => console.log('SW falló: ', err));
    });
}

export function trackEcommerceEvent(eventName, params) {
    if (typeof gtag === 'function') gtag('event', eventName, params);
    if (typeof fbq === 'function') {
        switch (eventName) {
            case 'view_item': fbq('track', 'ViewContent', { content_name: params.items[0].item_name, content_ids: [params.items[0].item_id], content_type: 'product', value: params.value, currency: 'COP' }); break;
            case 'add_to_cart': fbq('track', 'AddToCart', { content_ids: [params.items[0].item_id], content_type: 'product', value: params.value, currency: 'COP' }); break;
            case 'purchase': fbq('track', 'Purchase', { value: params.value, currency: 'COP' }); break;
        }
    }
}