// public/js/admin/admin-ui.js
import { auth, db, collection, getDocs, doc, getDoc } from '../firebase-init.js';

export function loadAdminSidebar(userRole = 'customer') {
    const sidebarContainer = document.getElementById('admin-sidebar');
    if (!sidebarContainer) return;

    const currentPage = window.location.pathname;

    // --- 1. PERMISOS DE MÓDULOS (Nombres exactos del menú) ---
    const rolePermissions = {
        'admin': ['all'],
        'contabilidad': ['Dashboard', 'Facturación', 'Gestión de Cartera', 'Cuentas', 'Control de Gastos', 'Rentabilidad FIFO', 'Sedes y Cierres'],
        'ventas': ['Dashboard', 'WhatsApp', 'Pedidos', 'Clientes', 'Garantías', 'Productos', 'Categorías', 'Banners y Promos', 'Sedes y Cierres'],
        'logistica': ['Dashboard', 'Pedidos', 'Productos', 'Nueva Entrada', 'Inventario RMA', 'Logística', 'Sedes y Cierres']
    };

    // --- 2. DEFINICIÓN DE GRUPOS Y MENÚS BASE ---
    const navGroups = [
        {
            title: 'Principal',
            items: [
                { name: 'Dashboard', icon: 'fa-chart-line', path: '/admin/index.html' },
                { name: 'WhatsApp', icon: 'fa-brands fa-whatsapp', path: '/admin/whatsapp.html' },
                { name: 'Sedes y Cierres', icon: 'fa-house-flag', path: '/admin/branches.html' },
                { name: 'Gestión Usuarios', icon: 'fa-user-shield', path: '/admin/users-admin.html' } // Módulo solo Admin
            ]
        },
        {
            title: 'Gestión Comercial',
            items: [
                { name: 'Pedidos', icon: 'fa-clipboard-list', path: '/admin/orders.html' },
                { name: 'Facturación', icon: 'fa-file-invoice-dollar', path: '/admin/invoices.html' },
                { name: 'Clientes', icon: 'fa-users', path: '/admin/clients.html' },
                { name: 'Garantías', icon: 'fa-shield-cat', path: '/admin/warranties.html' }
            ]
        },
        {
            title: 'Inventario & Catálogo',
            items: [
                { name: 'Productos', icon: 'fa-box-open', path: '/admin/products.html' },
                { name: 'Categorías', icon: 'fa-tags', path: '/admin/categories.html' },
                { name: 'Marcas', icon: 'fa-copyright', path: '/admin/brands.html' }, 
                { name: 'Nueva Entrada', icon: 'fa-truck-loading', path: '/admin/inventory-entry.html' },
                { name: 'Historial Compras', icon: 'fa-file-invoice', path: '/admin/purchases.html' },
                { name: 'Inventario RMA', icon: 'fa-warehouse', path: '/admin/warranty-inventory.html' }
            ]
        },
        {
            title: 'Administración',
            items: [
                { name: 'Proveedores', icon: 'fa-handshake', path: '/admin/suppliers.html' },
                { name: 'Gestión de Cartera', icon: 'fa-wallet', path: '/admin/cartera.html' },
                { name: 'Cuentas', icon: 'fa-vault', path: '/admin/treasury.html' },
                { name: 'Control de Gastos', icon: 'fa-money-bill-trend-up', path: '/admin/expenses.html' }, 
                { name: 'Rentabilidad FIFO', icon: 'fa-chart-pie', path: '/admin/profitability.html' },
                { name: 'Logística', icon: 'fa-truck-fast', path: '/admin/shipping-config.html' },
                { name: 'Banners y Promos', icon: 'fa-bullhorn', path: '/admin/promotions.html' },
                { name: 'Configuración', icon: 'fa-gear', path: '/admin/settings.html' }
            ]
        }
    ];

    // --- 3. FILTRAR MENÚ SEGÚN EL ROL ---
    const filteredGroups = navGroups.map(group => {
        const allowedItems = group.items.filter(item => {
            if (userRole === 'admin') return true;
            // Configuración y Usuarios siempre restringidos a Admin
            if (item.name === 'Gestión Usuarios' || item.name === 'Configuración' || item.name === 'Proveedores' || item.name === 'Marcas') return false; 
            return rolePermissions[userRole]?.includes(item.name);
        });
        return { ...group, items: allowedItems };
    }).filter(group => group.items.length > 0);

    const generateNavHTML = () => {
        return filteredGroups.map(group => `
            <div class="mb-6">
                ${group.title ? `<p class="px-4 text-[9px] font-black text-gray-600 uppercase tracking-widest mb-3 opacity-60">${group.title}</p>` : ''}
                <div class="space-y-1">
                    ${group.items.map(item => {
                        const isActive = currentPage.includes(item.path);
                        return `
                            <a href="${item.path}" class="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300 font-bold text-sm group ${
                                isActive ? 'bg-brand-orange text-brand-black shadow-lg shadow-orange-500/20' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                            }">
                                <div class="w-6 flex justify-center">
                                    <i class="fa-solid ${item.icon} ${isActive ? 'text-brand-black' : 'text-brand-orange group-hover:text-white'} transition-colors"></i> 
                                </div>
                                <span>${item.name}</span>
                            </a>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');
    };

    // --- 4. BARRA INFERIOR (SOLO MÓVIL) DINÁMICA ---
    const showOrders = userRole === 'admin' || userRole === 'ventas' || userRole === 'logistica';
    const showProducts = userRole === 'admin' || userRole === 'ventas' || userRole === 'logistica';

    const mobileBottomBar = `
        <nav class="md:hidden fixed bottom-0 left-0 w-full bg-brand-black text-gray-400 border-t border-gray-800 z-[60] flex justify-around items-center pb-safe">
            <a href="/admin/index.html" class="flex flex-col items-center py-3 px-2 w-full ${currentPage.includes('/admin/index.html') ? 'text-brand-orange' : 'hover:text-white'}">
                <i class="fa-solid fa-chart-line text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Inicio</span>
            </a>
            ${showOrders ? `
            <a href="/admin/orders.html" class="flex flex-col items-center py-3 px-2 w-full ${currentPage.includes('/admin/orders.html') ? 'text-brand-orange' : 'hover:text-white'}">
                <i class="fa-solid fa-clipboard-list text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Pedidos</span>
            </a>` : ''}
            ${showProducts ? `
            <a href="/admin/products.html" class="flex flex-col items-center py-3 px-2 w-full ${currentPage.includes('/admin/products.html') ? 'text-brand-orange' : 'hover:text-white'}">
                <i class="fa-solid fa-box-open text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Stock</span>
            </a>` : ''}
            <button id="mobile-menu-trigger" class="relative flex flex-col items-center py-3 px-2 w-full text-brand-orange hover:text-white hover:bg-white/5 transition">
                <i class="fa-solid fa-bars text-lg mb-1"></i>
                <span class="text-[8px] font-bold uppercase tracking-widest">Menú</span>
                <span id="mobile-update-badge" class="hidden absolute top-2 right-[25%] w-2.5 h-2.5 bg-brand-orange rounded-full shadow-[0_0_8px_#F05A28] animate-pulse"></span>
            </button>
        </nav>
    `;

    const overlay = `<div id="sidebar-overlay" class="fixed inset-0 bg-black/80 z-[65] hidden backdrop-blur-sm transition-opacity opacity-0"></div>`;

    const scrollStyles = `
        <style>
            .sidebar-scroll::-webkit-scrollbar { width: 4px; }
            .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
            .sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
            .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #F05A28; }
            .pb-safe { padding-bottom: env(safe-area-inset-bottom, 0); }
        </style>
    `;

    const sidebarHTML = `
        <aside id="main-sidebar" class="fixed inset-y-0 left-0 w-72 bg-brand-black text-white flex flex-col shadow-2xl z-[70] transform -translate-x-full md:translate-x-0 transition-transform duration-300 ease-out md:static md:h-screen border-r border-gray-800">
            <div class="p-6 md:p-8 border-b border-gray-800 flex flex-col items-center bg-brand-black/50 backdrop-blur-sm sticky top-0 z-10 relative">
                <button id="mobile-menu-close" class="md:hidden absolute right-4 top-4 w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-white hover:bg-brand-red transition">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <div class="relative group cursor-pointer mt-2 bg-white/95 backdrop-blur-md rounded-2xl py-2 px-5 shadow-lg border border-white/20 flex items-center justify-center transition-all duration-300 hover:scale-[1.03] hover:bg-white" onclick="window.location.href='/admin/index.html'">
                    <img src="../img/logo.webp" alt="Mi Smartech" class="h-8 md:h-9 w-auto relative z-10">
                </div>
                <p class="text-[9px] text-gray-500 font-black uppercase tracking-[0.3em] mt-3">Admin Panel | <span class="text-brand-orange">${userRole}</span></p>
                <div id="branch-selector-container" class="w-full mt-2"></div>
                <button id="btn-update-app" class="hidden w-full flex items-center justify-center gap-2 py-3 mt-5 text-xs font-black uppercase tracking-widest text-brand-orange bg-brand-orange/10 border border-brand-orange/30 hover:bg-brand-orange hover:text-brand-black rounded-xl transition-all duration-300 shadow-[0_0_15px_rgba(0,174,199,0.3)]">
                    <i class="fa-solid fa-cloud-arrow-down fa-bounce"></i> Actualizar App
                </button>
            </div>

            <nav class="flex-grow p-4 mt-2 overflow-y-auto sidebar-scroll pb-24 md:pb-8">
                ${generateNavHTML()}
            </nav>

            <div class="p-4 border-t border-gray-800 bg-black/20 mb-16 md:mb-0">
                <button id="btn-logout-global" class="w-full flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-brand-red hover:bg-red-500/10 rounded-xl transition-all duration-300 group">
                    <i class="fa-solid fa-right-from-bracket group-hover:rotate-180 transition-transform duration-500"></i> Cerrar Sesión
                </button>
            </div>
        </aside>
    `;

    sidebarContainer.innerHTML = scrollStyles + overlay + sidebarHTML + mobileBottomBar;

    // --- LÓGICA DE EVENTOS (Se mantiene igual) ---
    const sidebar = document.getElementById('main-sidebar');
    const overlayEl = document.getElementById('sidebar-overlay');
    const triggerBtn = document.getElementById('mobile-menu-trigger');
    const closeBtn = document.getElementById('mobile-menu-close');
    const logoutBtn = document.getElementById('btn-logout-global');

    function openMenu() { sidebar.classList.remove('-translate-x-full'); overlayEl.classList.remove('hidden'); setTimeout(() => overlayEl.classList.remove('opacity-0'), 10); }
    function closeMenu() { sidebar.classList.add('-translate-x-full'); overlayEl.classList.add('opacity-0'); setTimeout(() => overlayEl.classList.add('hidden'), 300); }

    if (triggerBtn) triggerBtn.addEventListener('click', openMenu);
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    if (overlayEl) overlayEl.addEventListener('click', closeMenu);

    if (logoutBtn) {
        logoutBtn.onclick = () => {
            if(confirm("¿Deseas cerrar la sesión administrativa?")) {
                auth.signOut().then(() => window.location.href = '/index.html');
            }
        };
    }

    // Service Worker lógica resumida
    const btnUpdate = document.getElementById('btn-update-app');
    const mobileBadge = document.getElementById('mobile-update-badge');
    let newWorker;

    function showUpdateButton(worker) {
        newWorker = worker;
        if (btnUpdate) { btnUpdate.classList.remove('hidden'); btnUpdate.style.display = 'flex'; }
        if (mobileBadge) { mobileBadge.classList.remove('hidden'); mobileBadge.style.display = 'block'; }
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then(reg => {
            reg.update();
            if (reg.waiting) showUpdateButton(reg.waiting);
            if (reg.installing) reg.installing.addEventListener('statechange', (e) => { if (e.target.state === 'installed') showUpdateButton(e.target); });
            reg.addEventListener('updatefound', () => {
                const newWorkerInstalling = reg.installing;
                if (!newWorkerInstalling) return; 
                newWorkerInstalling.addEventListener('statechange', (e) => { if (e.target.state === 'installed') showUpdateButton(e.target); });
            });
        });
        let refreshing;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return; refreshing = true; window.location.reload();
        });
    }

    if (btnUpdate) {
        btnUpdate.addEventListener('click', async () => {
            btnUpdate.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Limpiando sistema...';
            try {
                const cacheNames = await caches.keys();
                for (const cacheName of cacheNames) {
                    const cache = await caches.open(cacheName);
                    const cachedRequests = await cache.keys();
                    for (const request of cachedRequests) {
                        const url = request.url.toLowerCase();
                        if (url.endsWith('.js') || url.endsWith('.html') || url.includes('?')) await cache.delete(request);
                    }
                }
                // 🔥 LIMPIAR CACHÉ DE BASE DE DATOS LOCAL PARA FORZAR RE-SINCRONIZACIÓN COMPLETA DESDE FIRESTORE
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('mismartech_') || key.startsWith('smartech_') || key.startsWith('admin_')) {
                        localStorage.removeItem(key);
                    }
                });
                Object.keys(sessionStorage).forEach(key => {
                    if (key.startsWith('mismartech_') || key.startsWith('smartech_') || key.startsWith('admin_')) {
                        sessionStorage.removeItem(key);
                    }
                });
            } catch (error) {}
            if (newWorker) newWorker.postMessage({ type: 'SKIP_WAITING' });
            else window.location.href = window.location.pathname + '?refresh=' + new Date().getTime();
        });
    }

    setupBranchSelectorInSidebar();
}

async function setupBranchSelectorInSidebar() {
    const container = document.getElementById('branch-selector-container');
    if (!container) return;

    const role = sessionStorage.getItem('adminUserRole') || 'customer';
    const assignedBranchId = sessionStorage.getItem('adminUserBranchId') || 'sede_principal';
    const activeBranchId = sessionStorage.getItem('activeBranchId') || 'sede_principal';

    // Para Super Admin (o rol admin)
    if (role === 'admin' || assignedBranchId === 'ALL') {
        try {
            const snap = await getDocs(collection(db, "branches"));
            let optionsHTML = '';
            snap.forEach(d => {
                const b = d.data();
                const selected = d.id === activeBranchId ? 'selected' : '';
                optionsHTML += `<option value="${d.id}" ${selected}>${b.name || d.id}</option>`;
            });

            container.innerHTML = `
                <div class="relative w-full">
                    <div class="absolute left-3 top-1/2 -translate-y-1/2 text-brand-orange text-xs pointer-events-none">
                        <i class="fa-solid fa-location-dot"></i>
                    </div>
                    <select id="sidebar-branch-select" class="w-full bg-gray-900 border border-gray-800 rounded-xl py-2 pl-8 pr-8 text-xs font-bold text-gray-300 outline-none appearance-none focus:border-brand-orange focus:text-white transition">
                        ${optionsHTML}
                    </select>
                    <div class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-[10px] pointer-events-none">
                        <i class="fa-solid fa-chevron-down"></i>
                    </div>
                </div>
            `;

            const selectEl = document.getElementById('sidebar-branch-select');
            if (selectEl) {
                selectEl.onchange = (e) => {
                    sessionStorage.setItem('activeBranchId', e.target.value);
                    window.location.reload();
                };
            }
        } catch (err) {
            console.error("Error loading branches for sidebar:", err);
            container.innerHTML = `<span class="text-[10px] text-red-400">Error al cargar sedes</span>`;
        }
    } else {
        // Para empleados de sede bloqueada
        container.innerHTML = `
            <div class="w-full bg-gray-900/60 border border-gray-800/80 rounded-xl py-2.5 px-3 flex items-center gap-2 text-xs font-bold text-gray-400">
                <span class="text-brand-orange animate-pulse"><i class="fa-solid fa-location-dot"></i></span>
                <span class="truncate uppercase text-[9px] tracking-widest text-gray-400">Sede: <span id="locked-branch-name" class="font-black text-brand-orange">Cargando...</span></span>
            </div>
        `;

        try {
            const docSnap = await getDoc(doc(db, "branches", assignedBranchId));
            const nameEl = document.getElementById('locked-branch-name');
            if (nameEl) {
                if (docSnap.exists()) {
                    nameEl.innerText = docSnap.data().name || assignedBranchId;
                } else {
                    nameEl.innerText = assignedBranchId;
                }
            }
        } catch (err) {
            console.error("Error fetching locked branch name:", err);
            const nameEl = document.getElementById('locked-branch-name');
            if (nameEl) nameEl.innerText = assignedBranchId;
        }
    }
}