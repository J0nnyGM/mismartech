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

export async function loadGlobalHeader() {
    const headerPlaceholder = document.getElementById('header-placeholder');
    if (headerPlaceholder) {
        await loadComponent('header-placeholder', '/includes/header.html');
    }
    
    injectCartDrawerHTML(); // Inyecta el carrito flotante
    initHeaderLogic();
    initSearchLogic();
    populateMegaMenus(); 
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
        <div id="cart-drawer" class="absolute right-0 top-0 w-full max-w-[420px] h-full bg-white shadow-2xl flex flex-col drawer-shadow translate-x-full smooth-drawer pointer-events-auto">
            
            <div class="p-6 bg-white flex justify-between items-center z-10 relative border-b border-gray-100">
                <h3 class="font-black text-lg uppercase tracking-tight flex items-center gap-3 text-brand-black">
                    <i class="fa-solid fa-bag-shopping text-[#00AEC7]"></i> MI CARRITO
                </h3>
                <button onclick="window.toggleCartDrawer()" aria-label="Cerrar carrito" class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-gray-200 transition">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <div id="cart-shipping-bar" class="px-8 pt-6 pb-2 bg-white hidden">
                <p id="shipping-msg-drawer" class="text-[9px] font-bold text-gray-500 uppercase tracking-wide text-center mb-2">Calculando envío...</p>
                <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div id="shipping-progress-drawer" class="h-full bg-[#00AEC7] transition-all duration-500 w-0"></div>
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
    const topBanner = document.getElementById('top-banner-dynamic');

    if (topBanner) {
        const renderBanner = (data) => {
            let freeHTML = '';
            if (data && data.freeThreshold > 0) {
                freeHTML = `<span class="mx-8 flex items-center gap-2 text-brand-orange"><i class="fa-solid fa-gift animate-pulse"></i> ENVÍO GRATIS DESDE $${parseInt(data.freeThreshold).toLocaleString('es-CO')}</span>`;
            }
            // Mensajes base que siempre se mostrarán
            const baseContent = `<span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-truck-fast text-brand-orange"></i> Envíos a toda Colombia</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-hand-holding-dollar text-brand-orange"></i> Contra entrega disponible</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-credit-card text-brand-orange"></i> Paga con ADDI o SISTECREDITO</span>${freeHTML}`;
            
            topBanner.innerHTML = `<div class="flex items-center animate-marquee font-black uppercase tracking-[0.3em]">${baseContent} ${baseContent} ${baseContent}</div>`;
        };

        // Cambiamos el nombre del caché a mismartech
        const currentCacheStr = sessionStorage.getItem('mismartech_shipping_config');
        if (currentCacheStr) {
            renderBanner(JSON.parse(currentCacheStr));
        } else {
            topBanner.innerHTML = `<div class="flex items-center justify-center font-black uppercase tracking-[0.3em] h-full"><span class="mx-8">CARGANDO PROMOCIONES... <i class="fa-solid fa-circle-notch fa-spin ml-2"></i></span></div>`;
        }

        const fetchShipping = async () => {
            if (!navigator.onLine) {
                renderBanner(null); // PLAN B: Si no hay internet, muestra los textos normales
                return;
            }
            try {
                const snap = await getDoc(doc(db, "config", "shipping"));
                if (snap.exists()) {
                    const data = snap.data();
                    const newDataStr = JSON.stringify(data);
                    const oldDataStr = sessionStorage.getItem('mismartech_shipping_config');

                    // Siempre renderizamos para asegurar que se quite el "Cargando..."
                    renderBanner(data);

                    if (oldDataStr !== newDataStr) {
                        sessionStorage.setItem('mismartech_shipping_config', newDataStr);
                        window.dispatchEvent(new Event('shippingConfigUpdated'));
                    }
                } else {
                    // PLAN B: Si no creaste el documento en Firebase, muestra los textos normales
                    renderBanner(null);
                }
            } catch (error) { 
                console.warn("No se pudo cargar la config de envíos, usando default:", error);
                // PLAN B: Si Firebase da error, muestra los textos normales
                renderBanner(null);
            }
        };

        // Ejecutar
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

    // Lógica para Abrir/Cerrar el Carrito
    let isDrawerAnimating = false;
    window.toggleCartDrawer = (forceOpen = false) => {
        const cartDrawer = document.getElementById('cart-drawer');
        const cartOverlay = document.getElementById('cart-overlay');
        if (!cartDrawer || !cartOverlay || isDrawerAnimating) return;
        
        const isClosed = cartDrawer.classList.contains('translate-x-full');
        isDrawerAnimating = true;

        if (isClosed || forceOpen) {
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
            setTimeout(() => { cartOverlay.style.display = 'none'; isDrawerAnimating = false; }, 500);
        }
    };

    // Controlador de Cantidad dentro del Drawer
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

    // Eliminar Item del Drawer
    window.removeCartItemDrawer = (cartId) => {
        removeFromCart(cartId);
        window.renderCartDrawerItems();
        window.updateCartCountGlobal();
    };

    // Renderizador Visual del Drawer (Idéntico a la imagen provista)
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
            subtotal += item.price * item.quantity;
            
            // Renderizado estilo "image_d2007f.png"
            return `
            <div class="bg-white p-3 rounded-2xl border border-gray-100 flex flex-col gap-3 relative group transition hover:border-[#00AEC7] hover:shadow-md">
                <div class="flex gap-4 items-start">
                    <div class="w-16 h-16 bg-gray-50 rounded-xl border border-gray-100 p-1 shrink-0 flex items-center justify-center">
                        <img src="${item.image || 'https://placehold.co/50'}" class="max-w-full max-h-full object-contain mix-blend-multiply">
                    </div>
                    <div class="flex-grow min-w-0 pr-2">
                        <h4 class="text-[9px] font-black uppercase text-brand-black leading-snug line-clamp-2">${item.name}</h4>
                        ${item.capacity || item.color ? `<p class="text-[8px] font-bold text-gray-400 mt-0.5 uppercase">${item.color || ''} ${item.capacity || ''}</p>` : ''}
                        <div class="text-xs font-black text-brand-black mt-1">$${item.price.toLocaleString('es-CO')}</div>
                    </div>
                </div>
                
                <div class="flex items-center justify-between">
                    <div class="flex items-center bg-white rounded-lg h-8 border border-gray-200 w-24 overflow-hidden">
                        <button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, -1)" class="flex-1 h-full flex items-center justify-center text-gray-400 hover:text-brand-black hover:bg-gray-50 transition font-bold">-</button>
                        <span class="flex-1 text-center text-[10px] font-black text-brand-black bg-gray-50/50 h-full flex items-center justify-center border-x border-gray-100">${item.quantity}</span>
                        <button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, 1)" class="flex-1 h-full flex items-center justify-center text-gray-400 hover:text-brand-black hover:bg-gray-50 transition font-bold">+</button>
                    </div>
                    <button onclick="window.removeCartItemDrawer('${item.cartId}')" class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
                        <i class="fa-solid fa-trash-can text-[10px]"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

        totalEl.textContent = `$${subtotal.toLocaleString('es-CO')}`;

        // Lógica barra de envío
        try {
            const cachedConfig = sessionStorage.getItem('pixeltech_shipping_config');
            if (cachedConfig) {
                const data = JSON.parse(cachedConfig);
                const threshold = parseInt(data.freeThreshold) || 0;
                if (threshold > 0) {
                    shippingBarContainer.classList.remove('hidden');
                    const diff = threshold - subtotal;
                    let percent = subtotal >= threshold ? 100 : (subtotal / threshold) * 100;
                    shippingBar.style.width = `${percent}%`;
                    
                    if (diff > 0) {
                        shippingMsg.innerHTML = `TE FALTAN <span class="text-[#00AEC7] font-black">$${diff.toLocaleString('es-CO')}</span> PARA ENVÍO GRATIS`;
                        shippingBar.classList.remove('bg-emerald-500'); shippingBar.classList.add('bg-[#00AEC7]');
                    } else {
                        shippingMsg.innerHTML = `<span class="text-emerald-500 font-black"><i class="fa-solid fa-check-circle"></i> ¡TIENES ENVÍO GRATIS!</span>`;
                        shippingBar.classList.remove('bg-[#00AEC7]'); shippingBar.classList.add('bg-emerald-500');
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
    window.addEventListener('cartItemAdded', () => {
        window.updateCartCountGlobal();
        window.toggleCartDrawer(true); // Fuerza abrir el drawer al agregar
    });

    window.addEventListener('cartUpdated', () => {
        window.updateCartCountGlobal();
        const drawer = document.getElementById('cart-drawer');
        if (drawer && !drawer.classList.contains('translate-x-full')) {
            window.renderCartDrawerItems();
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'pixeltech_cart') window.updateCartCountGlobal();
    });

    window.updateCartCountGlobal();

    // Drawer de navegación Móvil (Menú principal)
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
        onAuthStateChanged(auth, async (user) => {
            const container = document.getElementById('user-info-global');
            const mobileProfile = document.getElementById('mobile-profile-link');
            if (user) {
                if (container) {
                    let role = sessionStorage.getItem('pixeltech_user_role');
                    if (!role) {
                        getDoc(doc(db, "users", user.uid)).then(userSnap => {
                            role = (userSnap.exists() && userSnap.data().role === 'admin') ? 'admin' : 'user';
                            sessionStorage.setItem('pixeltech_user_role', role);
                            renderUserLink(role, container, mobileProfile);
                        });
                    } else {
                        renderUserLink(role, container, mobileProfile);
                    }
                }
            } else {
                if (container) {
                    container.innerHTML = `
                    <a href="/auth/login.html" class="flex items-center space-x-2 cursor-pointer hover:text-brand-orange transition text-gray-700">
                        <i class="fa-regular fa-user text-2xl"></i>
                        <div class="text-sm">
                            <p class="text-gray-500 leading-none text-[11px] mb-1">Mi Cuenta</p>
                            <p class="font-bold leading-none text-brand-black">Ingresar</p>
                        </div>
                    </a>`;
                }
                if (mobileProfile) mobileProfile.href = "/auth/login.html";
            }
        });
    };

    if ('requestIdleCallback' in window) {
        requestIdleCallback(initDelayedTasks);
    } else {
        setTimeout(initDelayedTasks, 1000); 
    }

    function renderUserLink(role, container, mobileProfile) {
        const isAdmin = role === 'admin';
        const label = isAdmin ? 'Admin' : 'Perfil';
        const link = isAdmin ? '/admin/index.html' : '/profile.html';
        container.innerHTML = `
        <a href="${link}" class="flex items-center space-x-2 cursor-pointer hover:text-brand-orange transition text-brand-orange">
            <i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-circle-user'} text-2xl"></i>
            <div class="text-sm">
                <p class="text-gray-500 leading-none text-[11px] mb-1">Mi Cuenta</p>
                <p class="font-bold leading-none">${label}</p>
            </div>
        </a>`;
        if (mobileProfile) mobileProfile.href = link;
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
                <a href="/shop/catalog.html?category=${encodeURIComponent(cat.name)}" class="w-48 bg-white border border-gray-100 rounded-[1.5rem] hover:border-[#00AEC7] hover:shadow-[0_10px_30px_rgba(0,174,199,0.15)] transition-all duration-300 group flex flex-col relative overflow-hidden shrink-0">
                    <div class="absolute top-3 right-3 bg-brand-black text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0 z-10">
                        Ver Productos
                    </div>
                    
                    <div class="h-32 w-full p-4 flex items-center justify-center relative">
                        <img src="${cat.image || 'https://placehold.co/150'}" class="max-h-full max-w-full object-contain mix-blend-multiply group-hover:scale-110 transition-transform duration-500 relative z-0">
                    </div>
                    
                    <div class="px-5 py-4 border-t border-gray-50 flex items-center justify-between bg-slate-50/50 group-hover:bg-[#00AEC7]/5 transition-colors">
                        <span class="text-[11px] font-black uppercase text-brand-black tracking-wider truncate group-hover:text-[#00AEC7] transition-colors w-full">${cat.name}</span>
                        <i class="fa-solid fa-arrow-right text-[#00AEC7] text-[10px] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"></i>
                    </div>
                </a>
            `).join('');
        }
    }

    if (brandDropdown) {
        const brands = SmartCache.getBrands();
        if (brands.length > 0) {
            brandDropdown.innerHTML = brands.map(b => `
                <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="w-48 bg-white border border-gray-100 rounded-[1.5rem] hover:border-[#00AEC7] hover:shadow-[0_10px_30px_rgba(0,174,199,0.15)] transition-all duration-300 group flex flex-col relative overflow-hidden shrink-0">
                    <div class="absolute top-3 right-3 bg-brand-black text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0 z-10">
                        Ver Productos
                    </div>
                    
                    <div class="h-32 w-full p-4 flex items-center justify-center relative">
                        <img src="${b.image || 'https://placehold.co/150'}" class="max-h-full max-w-full object-contain mix-blend-multiply grayscale opacity-70 group-hover:opacity-100 group-hover:grayscale-0 group-hover:scale-110 transition-all duration-500 relative z-0">
                    </div>
                    
                    <div class="px-5 py-4 border-t border-gray-50 flex items-center justify-between bg-slate-50/50 group-hover:bg-[#00AEC7]/5 transition-colors">
                        <span class="text-[11px] font-black uppercase text-brand-black tracking-wider truncate group-hover:text-[#00AEC7] transition-colors w-full">${b.name}</span>
                        <i class="fa-solid fa-arrow-right text-[#00AEC7] text-[10px] opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"></i>
                    </div>
                </a>
            `).join('');
        }
    }
}

window.addEventListener('categoriesUpdated', populateMegaMenus);
window.addEventListener('brandsUpdated', populateMegaMenus);

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