import { auth, db, onAuthStateChanged, doc, getDoc, collection, getDocs, query, orderBy, where, limit, onSnapshot } from "./firebase-init.js";
import { updateQuantity } from "./cart.js";

/**
 * Inyecta Header, Footer, Menús y Herramientas Flotantes (Y EL MINI CARRITO)
 */
export function loadGlobalHeader() {
    initHeaderLogic();
    initSearchLogic();
}

window.showToast = (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = '<i class="fa-solid fa-circle-check text-brand-cyan toast-icon"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-circle-exclamation text-brand-red toast-icon"></i>';
    toast.innerHTML = `${icon}<span class="toast-msg">${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.classList.add('show'); });
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
};

// --- LÓGICA DE BÚSQUEDA ---
function initSearchLogic() {
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
                    const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
                    let localProducts = [];

                    if (cachedRaw) {
                        try {
                            const data = JSON.parse(cachedRaw);
                            localProducts = Object.values(data.map || {});
                        } catch (e) { }
                    }

                    let resultsArray = [];

                    if (localProducts.length > 0) {
                        resultsArray = localProducts.filter(p => {
                            const name = (p.name || "").toLowerCase();
                            const cat = (p.category || "").toLowerCase();
                            return (name.includes(term) || cat.includes(term)) && p.status === 'active';
                        });
                    } else {
                        const q = query(
                            collection(db, "products"),
                            where("status", "==", "active"),
                            limit(20)
                        );
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
                        <button onclick="window.location.href='/shop/search.html?q=${encodeURIComponent(term)}'" class="text-brand-cyan text-xs font-black mt-1 hover:underline">Buscar "${term}" en todo el catálogo</button>
                    </div>`;
            } else {
                products.forEach(p => {
                    const img = p.mainImage || p.image || 'https://placehold.co/50';
                    const price = p.price.toLocaleString('es-CO');

                    results.innerHTML += `
                        <div onclick="window.location.href='/shop/product.html?id=${p.id}'" class="search-result-item">
                            <img src="${img}" class="w-10 h-10 object-contain rounded-lg bg-gray-50 border border-gray-100">
                            <div class="flex-grow min-w-0">
                                <p class="text-[10px] font-black text-brand-black uppercase truncate">${p.name}</p>
                                <p class="text-[9px] font-bold text-gray-400">${p.category || 'Producto'}</p>
                            </div>
                            <span class="text-xs font-black text-brand-cyan">$${price}</span>
                        </div>
                    `;
                });

                if (products.length >= 5) {
                    results.innerHTML += `
                        <div onclick="window.location.href='/shop/search.html?q=${encodeURIComponent(term)}'" class="p-3 text-center bg-gray-50 cursor-pointer hover:bg-gray-100 transition">
                            <span class="text-[9px] font-black text-brand-black uppercase tracking-widest">Ver todos los resultados</span>
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

// --- LOGICA DE HEADER Y MENÚ (Optimizada sin OnSnapshot para evitar Timeouts) ---
async function initHeaderLogic() {
    const topBanner = document.getElementById('top-banner-dynamic');

    if (topBanner) {
        const renderBanner = (data) => {
            let freeHTML = '';
            if (data && data.freeThreshold > 0) {
                freeHTML = `<span class="mx-8 flex items-center gap-2 text-brand-cyan"><i class="fa-solid fa-gift animate-pulse"></i> ENVÍO GRATIS DESDE $${parseInt(data.freeThreshold).toLocaleString('es-CO')}</span>`;
            }
            const baseContent = `<span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-truck-fast text-brand-cyan"></i> Envíos a toda Colombia</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-hand-holding-dollar text-brand-cyan"></i> Contra entrega en Bogotá</span><span class="mx-8 flex items-center gap-2"><i class="fa-solid fa-credit-card text-brand-cyan"></i> Paga con ADDI o SISTECREDITO</span>${freeHTML}`;
            topBanner.innerHTML = `<div class="flex items-center animate-marquee font-black uppercase tracking-[0.3em]">${baseContent} ${baseContent} ${baseContent}</div>`;
        };

        // 1. CARGA INSTANTÁNEA: Leemos el caché sin tocar la red
        const currentCacheStr = sessionStorage.getItem('pixeltech_shipping_config');
        if (currentCacheStr) {
            renderBanner(JSON.parse(currentCacheStr));
        } else {
            // Placeholder mientras carga
            topBanner.innerHTML = `<div class="flex items-center justify-center font-black uppercase tracking-[0.3em] h-full"><span class="mx-8">ENVÍOS A TODO EL PAÍS 🚚</span></div>`;
        }

        // 2. CONEXIÓN DIFERIDA (Petición Única, no en tiempo real)
        const fetchShipping = async () => {
            if (!navigator.onLine) return;
            try {
                const snap = await getDoc(doc(db, "config", "shipping"));
                if (snap.exists()) {
                    const data = snap.data();
                    const newDataStr = JSON.stringify(data);
                    const oldDataStr = sessionStorage.getItem('pixeltech_shipping_config');

                    if (oldDataStr !== newDataStr) {
                        sessionStorage.setItem('pixeltech_shipping_config', newDataStr);
                        renderBanner(data);
                        window.dispatchEvent(new Event('shippingConfigUpdated'));
                    }
                }
            } catch (error) {
                console.warn("No se pudo refrescar la política de envío.");
            }
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(fetchShipping);
        } else {
            setTimeout(fetchShipping, 1000);
        }
    }

    // Funciones del Drawer (Se mantienen iguales)
    window.toggleWhatsAppModal = () => {
        const modal = document.getElementById('wa-modal');
        const overlay = document.getElementById('wa-overlay');
        if (modal && overlay) {
            modal.classList.toggle('hidden');
            modal.classList.toggle('flex');
            overlay.classList.toggle('hidden');
        }
    };

    const cartDrawer = document.getElementById('cart-drawer');
    const cartOverlay = document.getElementById('cart-overlay');
    let isDrawerAnimating = false;

    window.toggleCartDrawer = () => {
        if (!cartDrawer || !cartOverlay || isDrawerAnimating) return;
        const isClosed = cartDrawer.classList.contains('translate-x-full');
        isDrawerAnimating = true;

        if (isClosed) {
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

    window.removeCartItemDrawer = (index) => {
        let cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
        cart.splice(index, 1);
        localStorage.setItem('pixeltech_cart', JSON.stringify(cart));
        window.renderCartDrawerItems();
        window.updateCartCountGlobal();
        window.dispatchEvent(new Event('cartUpdated'));
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
            window.dispatchEvent(new Event('cartUpdated'));
        }
    };

    window.updateCartCountGlobal = () => {
        const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];
        const count = cart.reduce((acc, i) => acc + (i.quantity || 1), 0);
        const deskBadge = document.getElementById('cart-count-desktop');
        if (deskBadge) { deskBadge.textContent = count; count > 0 ? deskBadge.classList.remove('hidden') : deskBadge.classList.add('hidden'); }
        const mobileBadge = document.getElementById('cart-count-mobile');
        if (mobileBadge) { mobileBadge.textContent = count; count > 0 ? mobileBadge.classList.remove('hidden') : mobileBadge.classList.add('hidden'); }
    };

    // --- EVENTOS GLOBALES ---
    window.addEventListener('cartItemAdded', () => {
        window.updateCartCountGlobal();
        window.renderCartDrawerItems();
        const drawer = document.getElementById('cart-drawer');
        if (drawer && drawer.classList.contains('translate-x-full')) {
            window.toggleCartDrawer();
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
        if (e.key === 'pixeltech_cart') {
            window.updateCartCountGlobal();
            window.renderCartDrawerItems();
        }
    });

    window.addEventListener('shippingConfigUpdated', () => {
        const drawer = document.getElementById('cart-drawer');
        if (drawer && !drawer.classList.contains('translate-x-full')) {
            window.renderCartDrawerItems();
        }
    });

    window.updateCartCountGlobal();

    // RENDERIZAR ITEMS (DRAWER)
    window.renderCartDrawerItems = async () => {
        const container = document.getElementById('cart-drawer-items');
        const totalEl = document.getElementById('cart-drawer-total');
        const shippingMsg = document.getElementById('shipping-msg');
        const shippingBar = document.getElementById('shipping-progress');
        const btnCheckout = document.getElementById('btn-checkout-drawer');

        const cart = JSON.parse(localStorage.getItem('pixeltech_cart')) || [];

        if (cart.length === 0) {
            container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center opacity-50 py-10"><i class="fa-solid fa-basket-shopping text-6xl text-gray-200 mb-4"></i><p class="text-xs font-bold text-gray-400">Tu carrito está vacío</p></div>`;
            totalEl.textContent = "$0";
            shippingMsg.innerHTML = "Agrega productos para ver beneficios";
            shippingBar.style.width = "0%";
            if (btnCheckout) { btnCheckout.disabled = true; btnCheckout.classList.add('opacity-50', 'cursor-not-allowed'); btnCheckout.onclick = null; }
            return;
        }

        if (btnCheckout) {
            btnCheckout.disabled = false; btnCheckout.classList.remove('opacity-50', 'cursor-not-allowed');
            btnCheckout.onclick = () => window.location.href = '/shop/checkout.html';
        }

        let subtotal = 0;
        container.innerHTML = cart.map((item, index) => {
            const isOutOfStock = (item.maxStock !== undefined && item.maxStock <= 0);
            const isMaxedOut = !isOutOfStock && (item.quantity >= (item.maxStock || 999));
            if (!isOutOfStock) subtotal += item.price * item.quantity;
            const itemTotal = item.price * item.quantity;
            const opacityClass = isOutOfStock ? 'opacity-50 grayscale bg-gray-50' : 'bg-white hover:border-gray-100';
            const statusBadge = isOutOfStock ? `<span class="absolute top-2 right-2 bg-red-500 text-white text-[8px] font-black px-2 py-0.5 rounded shadow-sm z-10">AGOTADO</span>` : '';

            return `
                <div class="${opacityClass} p-2 rounded-xl border border-gray-50 transition group relative mb-3">
                    ${statusBadge}
                    <div onclick="${isOutOfStock ? '' : `window.location.href='/shop/product.html?id=${item.id}'`}" class="flex gap-4 items-center cursor-pointer">
                        <div class="w-16 h-16 bg-gray-50 rounded-lg shrink-0 p-1 flex items-center justify-center border border-gray-100"><img src="${item.image || 'https://placehold.co/50'}" class="w-full h-full object-contain"></div>
                        <div class="flex-grow min-w-0"><h4 class="text-[10px] font-black uppercase text-brand-black truncate leading-tight">${item.name}</h4><p class="text-[9px] text-gray-400 mt-0.5">${item.color || ''} ${item.capacity || ''}</p><span class="text-[11px] font-black ${isOutOfStock ? 'text-gray-400 line-through' : 'text-brand-black'} block mt-1">${isOutOfStock ? '$0' : `$${itemTotal.toLocaleString('es-CO')}`}</span></div>
                    </div>
                    <div class="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                        ${isOutOfStock ? `<span class="text-[9px] text-red-500 font-bold ml-1">No disponible</span>` : `<div class="flex items-center bg-gray-50 rounded-lg h-7 border border-gray-100"><button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, -1)" class="w-7 h-full flex items-center justify-center text-gray-400 hover:text-black font-bold active:scale-90">-</button><span class="text-[10px] font-black min-w-[20px] text-center">${item.quantity}</span><button onclick="window.changeDrawerQty('${item.cartId}', ${item.quantity}, 1)" class="w-7 h-full flex items-center justify-center ${isMaxedOut ? 'text-gray-200 cursor-not-allowed' : 'text-gray-400 hover:text-black'} font-bold active:scale-90" ${isMaxedOut ? 'disabled' : ''}>+</button></div>`}
                        <button onclick="window.removeCartItemDrawer(${index})" class="text-gray-300 hover:text-red-500 transition px-2 z-10"><i class="fa-solid fa-trash-can text-xs"></i></button>
                    </div>
                </div>`;
        }).join('');

        totalEl.textContent = `$${subtotal.toLocaleString('es-CO')}`;

        try {
            const cachedConfig = sessionStorage.getItem('pixeltech_shipping_config');
            if (cachedConfig) {
                const data = JSON.parse(cachedConfig);
                const threshold = parseInt(data.freeThreshold) || 0;
                if (threshold > 0) {
                    const diff = threshold - subtotal;
                    let percent = subtotal >= threshold ? 100 : (subtotal / threshold) * 100;
                    shippingBar.style.width = `${percent}%`;
                    if (diff > 0) {
                        shippingMsg.innerHTML = `Te faltan <span class="text-brand-cyan font-black">$${diff.toLocaleString('es-CO')}</span> para envío gratis`;
                        shippingBar.classList.remove('bg-green-500'); shippingBar.classList.add('bg-brand-cyan');
                    } else {
                        shippingMsg.innerHTML = `<span class="text-green-600 font-black"><i class="fa-solid fa-check-circle"></i> ¡Tienes envío gratis!</span>`;
                        shippingBar.classList.remove('bg-brand-cyan'); shippingBar.classList.add('bg-green-500');
                    }
                }
            }
        } catch (e) { console.error(e); }
    };

    // Funciones del Menú Móvil
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

    // 🔥 NUEVO TRUCO SEO: Ejecutar cuando el navegador esté libre (Idle)
    const initDelayedTasks = () => {
        syncAllCategories();
        onAuthStateChanged(auth, async (user) => {
            const container = document.getElementById('user-info-desktop');
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
                    container.innerHTML = `<a href="/auth/login.html" class="flex flex-col items-center gap-1 group w-14"><div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-brand-cyan transition duration-300 shadow-lg"><i class="fa-regular fa-user text-xl text-white group-hover:text-brand-black"></i></div><span class="text-[8px] font-black uppercase tracking-widest text-gray-500 group-hover:text-brand-cyan text-center">Ingresar</span></a>`;
                }
                if (mobileProfile) mobileProfile.href = "/auth/login.html";
            }
        });
    };

    if ('requestIdleCallback' in window) {
        requestIdleCallback(initDelayedTasks);
    } else {
        setTimeout(initDelayedTasks, 1000); // Si es Safari (no soporta requestIdleCallback), esperamos solo 1 segundo.
    }

    function renderUserLink(role, container, mobileProfile) {
        const isAdmin = role === 'admin';
        const label = isAdmin ? 'Admin' : 'Cuenta';
        const link = isAdmin ? '/admin/index.html' : '/profile.html';
        container.innerHTML = `<a href="${link}" class="flex flex-col items-center gap-1 group w-14"><div class="w-12 h-12 rounded-2xl bg-brand-cyan text-brand-black flex items-center justify-center shadow-lg transition duration-300 hover:bg-white"><i class="fa-solid ${isAdmin ? 'fa-user-shield' : 'fa-user-check'} text-xl"></i></div><span class="text-[8px] font-black uppercase tracking-widest text-brand-cyan text-center">${label}</span></a>`;
        if (mobileProfile) mobileProfile.href = link;
    }

    const handleSearch = (e) => { if (e.key === 'Enter' && e.target.value.trim()) window.location.href = `/shop/search.html?q=${encodeURIComponent(e.target.value.trim())}`; };
    document.getElementById('search-desktop')?.addEventListener('keypress', handleSearch);
    document.getElementById('search-mobile')?.addEventListener('keypress', handleSearch);
}


// --- CARGA DE CATEGORÍAS ---
async function syncAllCategories() {
    const mobileList = document.getElementById('categories-mobile-list');
    if (!mobileList) return;

    const STORAGE_KEY = 'pixeltech_categories';
    const SYNC_KEY = 'pixeltech_cat_last_sync';

    let categories = [];

    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    if (cachedRaw) {
        try {
            const parsedData = JSON.parse(cachedRaw);
            // PASO CLAVE: Validamos que la caché realmente sea un Array
            if (Array.isArray(parsedData)) {
                categories = parsedData;
            } else {
                console.warn("Caché de categorías con formato incorrecto. Limpiando...");
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (e) {
            console.warn("Caché categorías corrupto");
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    // Si la caché estaba vacía, corrupta, o no era un array, la longitud será 0
    if (categories.length === 0) {
        try {
            const q = query(collection(db, "categories"), orderBy("name", "asc"));
            const snap = await getDocs(q);

            snap.forEach(doc => {
                categories.push({ id: doc.id, ...doc.data() });
            });

            if (categories.length > 0) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
                localStorage.setItem(SYNC_KEY, Date.now().toString());
            }
        } catch (e) {
            console.error("Error descargando categorías:", e);
            mobileList.innerHTML = `<p class="text-xs text-red-400 p-4">Error cargando menú.</p>`;
            return;
        }
    }

    // Ahora estamos 100% seguros de que 'categories' es un Array
    renderMobileMenuHTML(mobileList, categories);
}


// 🔥 CORRECCIÓN APLICADA AQUÍ 🔥
function renderMobileMenuHTML(container, categories) {
    container.innerHTML = `
        <a href="/shop/catalog.html" class="group flex items-center gap-3 p-3 mb-2 rounded-xl hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100">
            <div class="w-8 h-8 rounded-lg bg-brand-black text-white flex items-center justify-center shrink-0 shadow-md group-hover:scale-90 transition-transform"><i class="fa-solid fa-store text-xs"></i></div>
            <div class="flex flex-col"><span class="text-[10px] font-black uppercase tracking-widest text-brand-black">Ver Catálogo Completo</span><span class="text-[8px] font-bold text-gray-400">Explorar todos los productos</span></div>
            <i class="fa-solid fa-arrow-right text-gray-300 ml-auto text-xs group-hover:text-brand-cyan group-hover:translate-x-1 transition-all"></i>
        </a>
        <div class="h-px w-full bg-gray-100 my-2"></div>
    `;

    categories.forEach(cat => {
        const subcats = cat.subcategories || [];
        // Apuntamos directo a catalog.html como manda la lógica actual
        const catUrl = `/shop/catalog.html?category=${encodeURIComponent(cat.name)}`;
        const accordionId = `acc-${(cat.id || cat.name).replace(/\s+/g, '-')}`;

        if (subcats.length === 0) {
            container.innerHTML += `
                <a href="${catUrl}" class="flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition duration-300 mb-1 border-b border-gray-50 last:border-0">
                    <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                    <i class="fa-solid fa-chevron-right text-[10px] text-gray-300"></i>
                </a>`;
        } else {
            // CORRECCIÓN: usamos '&subcategory=' en lugar de 'q='
            const subListHTML = subcats.map(sub => {
                const subName = typeof sub === 'string' ? sub : sub.name;
                return `<a href="/shop/catalog.html?category=${encodeURIComponent(cat.name)}&subcategory=${encodeURIComponent(subName)}" class="block py-3 px-4 text-[10px] font-bold text-gray-500 hover:text-brand-cyan border-l-2 border-gray-100 hover:border-brand-cyan ml-3 transition-all">${subName}</a>`
            }).join('');

            container.innerHTML += `
                <div class="mb-1 border-b border-gray-50 last:border-0 transition-all duration-300 group-accordion">
                    <button class="w-full flex items-center justify-between p-4 text-left focus:outline-none hover:bg-slate-50 rounded-2xl transition" onclick="window.toggleAccordion('${accordionId}')">
                        <span class="font-bold text-xs text-gray-600 uppercase tracking-tight">${cat.name}</span>
                        <div class="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 transition-transform duration-300 icon-rotate"><i class="fa-solid fa-chevron-down text-[9px]"></i></div>
                    </button>
                    <div id="${accordionId}" class="hidden bg-white px-2 pb-2">
                        <a href="${catUrl}" class="block py-3 px-4 text-[10px] font-black text-brand-black uppercase tracking-widest border-b border-dashed border-gray-100 mb-1 hover:text-brand-cyan">Ver todo ${cat.name}</a>
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
                icon.classList.add('rotate-180', 'bg-brand-black', 'text-white');
                icon.classList.remove('bg-gray-50', 'text-gray-400');
            } else {
                content.classList.add('hidden');
                icon.classList.remove('rotate-180', 'bg-brand-black', 'text-white');
                icon.classList.add('bg-gray-50', 'text-gray-400');
            }
        };
    }
}

export function loadGlobalFooter() {

}

export async function renderBrandCarousel(containerId, activeBrandNames = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let brands = [];
    const STORAGE_KEY = 'pixeltech_brands';

    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    if (cachedRaw) {
        try {
            brands = JSON.parse(cachedRaw);
        } catch (e) { console.warn("Cache marcas corrupto"); }
    }

    if (brands.length === 0) {
        try {
            const q = query(collection(db, "brands"), orderBy("name", "asc"));
            const snap = await getDocs(q);
            snap.forEach(doc => {
                brands.push(doc.data());
            });

            if (brands.length > 0) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(brands));
            }
        } catch (e) {
            console.error("Error cargando marcas:", e);
        }
    }

    if (brands.length === 0) {
        container.innerHTML = "";
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    let displayBrands = [...brands];
    while (displayBrands.length < 10) {
        displayBrands = [...displayBrands, ...brands];
    }
    displayBrands = [...displayBrands, ...displayBrands];

    container.innerHTML = `
        <div class="relative group mb-10 overflow-hidden marquee-container">
            <div class="flex items-center justify-between mb-4 px-2">
                <h3 class="font-black text-sm uppercase tracking-widest text-brand-black">Aliados Oficiales</h3>
            </div>
            
            <div class="animate-marquee flex gap-6 w-max">
                ${displayBrands.map(b => `
                    <a href="/shop/search.html?brand=${encodeURIComponent(b.name)}" class="block w-32 h-20 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:border-brand-cyan/30 transition-all duration-300 flex flex-col items-center justify-center p-4 group/brand shrink-0">
                        <img src="${b.image || 'https://placehold.co/100'}" alt="${b.name}" class="w-full h-full object-contain transition-transform duration-500 group-hover/brand:scale-110">
                    </a>
                `).join('')}
            </div>
            
            <div class="absolute top-0 left-0 h-full w-12 bg-gradient-to-r from-white to-transparent pointer-events-none z-10"></div>
            <div class="absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-white to-transparent pointer-events-none z-10"></div>
        </div>`;
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('SW registrado: ', reg.scope))
            .catch(err => console.log('SW falló: ', err));
    });
}

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) installBtn.classList.remove('hidden');
});

window.installPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response: ${outcome}`);
    deferredPrompt = null;
    document.getElementById('btn-install-pwa')?.classList.add('hidden');
};

window.addEventListener('appinstalled', () => {
    document.getElementById('btn-install-pwa')?.classList.add('hidden');
    console.log('PWA Installed');
});

export function trackEcommerceEvent(eventName, params) {
    if (typeof gtag === 'function') {
        gtag('event', eventName, params);
    }

    if (typeof fbq === 'function') {
        switch (eventName) {
            case 'view_item':
                fbq('track', 'ViewContent', {
                    content_name: params.items[0].item_name,
                    content_ids: [params.items[0].item_id],
                    content_type: 'product',
                    value: params.value,
                    currency: 'COP'
                });
                break;
            case 'add_to_cart':
                fbq('track', 'AddToCart', {
                    content_ids: [params.items[0].item_id],
                    content_type: 'product',
                    value: params.value,
                    currency: 'COP'
                });
                break;
            case 'purchase':
                fbq('track', 'Purchase', {
                    value: params.value,
                    currency: 'COP'
                });
                break;
        }
    }
}

