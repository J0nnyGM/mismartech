import { auth, db, onAuthStateChanged, doc, updateDoc, collection, query, where, orderBy, onSnapshot, signOut } from "./firebase-init.js";

let currentUserId = null;
let allDepartments = [];
let allCities = [];
let editingAddressIndex = -1;

// Estado Local
let ordersCache = []; 
let addressesCache = [];
const ORDERS_PER_PAGE = 10;
const STORAGE_KEY_ORDERS = 'pixeltech_user_orders';

// Controladores de onSnapshot para poder apagarlos si cierra sesión
let unsubscribeOrders = null;
let unsubscribeUser = null;

// Referencias DOM
const addrModal = document.getElementById('address-modal');
const addrForm = document.getElementById('address-form');
const deptInput = document.getElementById('modal-dept-search');
const deptResults = document.getElementById('dept-results');
const cityInput = document.getElementById('modal-city-search');
const cityResults = document.getElementById('city-results');
const cityContainer = document.getElementById('city-input-container');

// --- 1. SESIÓN & INIT ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserId = user.uid;
        updateUserUI(user);
        initYearSelect(); 
        
        // Iniciamos los motores en tiempo real
        initUserRealtimeSync();
        initOrdersRealtimeSync();
        
        initColombiaAPI();
    } else {
        // Limpiar escuchas si cierra sesión
        if(unsubscribeOrders) unsubscribeOrders();
        if(unsubscribeUser) unsubscribeUser();
        window.location.href = "/auth/login.html";
    }
});

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE: USUARIO Y DIRECCIONES (onSnapshot)
// ==========================================================================
function initUserRealtimeSync() {
    const cachedProfile = sessionStorage.getItem('pixeltech_user_profile');
    if (cachedProfile) {
        try {
            const data = JSON.parse(cachedProfile);
            fillProfileForm(data);
            if (data.addresses) renderAddresses(data.addresses);
        } catch(e){}
    }

    if (unsubscribeUser) unsubscribeUser();

    // Escuchamos el documento del usuario (Perfil y Direcciones)
    unsubscribeUser = onSnapshot(doc(db, "users", currentUserId), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            sessionStorage.setItem('pixeltech_user_profile', JSON.stringify(data));
            
            fillProfileForm(data);
            
            const newAddresses = data.addresses || [];
            // Solo repinta si hubo un cambio real en las direcciones (comparación rápida)
            if (JSON.stringify(addressesCache) !== JSON.stringify(newAddresses)) {
                addressesCache = newAddresses;
                renderAddresses(addressesCache);
            }
        }
    }, (error) => {
        console.error("Error en SmartSync Usuario:", error);
    });
}

function fillProfileForm(data) {
    // Si el usuario está escribiendo, no queremos sobreescribirle la letra, solo si está vacío o difiere y no tiene focus
    const updateInput = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) el.value = val || "";
    };
    
    updateInput('form-name', data.name);
    updateInput('form-id', data.document);
    updateInput('form-phone', data.phone);
    updateInput('form-birth', data.birthdate);
}

function renderAddresses(addresses) {
    const list = document.getElementById('addresses-list');
    if (!list) return;

    if (addresses.length === 0) {
        list.innerHTML = `<div class="col-span-full py-10 border-2 border-dashed border-gray-200 rounded-[2rem] text-center"><p class="text-gray-400 text-xs font-bold uppercase">No hay direcciones guardadas</p></div>`;
        return;
    }
    
    list.innerHTML = addresses.map((addr, index) => {
        const isDef = addr.isDefault;
        return `
            <div class="bg-white p-6 rounded-[2rem] border ${isDef ? 'border-brand-cyan shadow-md shadow-cyan-500/10' : 'border-gray-100 hover:border-gray-200'} shadow-sm relative group transition-all">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl ${isDef ? 'bg-brand-cyan text-brand-black' : 'bg-slate-100 text-gray-400'} flex items-center justify-center transition-colors"><i class="fa-solid ${isDef ? 'fa-star' : 'fa-location-dot'}"></i></div>
                        <div><h4 class="font-black text-xs uppercase tracking-tight text-brand-black">${addr.alias}</h4>${isDef ? '<span class="text-[8px] font-black uppercase text-brand-cyan">Principal</span>' : ''}</div>
                    </div>
                    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onclick="window.editAddress(${index})" class="w-8 h-8 rounded-full hover:bg-slate-100 text-gray-400 flex items-center justify-center transition"><i class="fa-solid fa-pen text-xs"></i></button>
                        <button onclick="window.deleteAddress(${index})" class="w-8 h-8 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center transition"><i class="fa-solid fa-trash text-xs"></i></button>
                    </div>
                </div>
                <div class="space-y-1 mb-4">
                    <p class="text-sm font-bold text-gray-800 leading-tight">${addr.address}</p>
                    <p class="text-[10px] text-gray-500 font-bold uppercase">${addr.city}, ${addr.dept}</p>
                    ${addr.notes ? `<p class="text-[9px] text-gray-400 italic mt-2 line-clamp-1">"${addr.notes}"</p>` : ''}
                </div>
            </div>`;
    }).join('');
}

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE: PEDIDOS (onSnapshot + Caché Persistente)
// ==========================================================================
function initOrdersRealtimeSync() {
    const container = document.getElementById('orders-container');
    
    // 1. CARGA RÁPIDA DE CACHÉ
    const cachedRaw = localStorage.getItem(STORAGE_KEY_ORDERS);
    let lastSyncTime = 0;

    if (cachedRaw) {
        try {
            const parsed = JSON.parse(cachedRaw);
            if (parsed.map && parsed.lastSync) {
                const mapValues = Object.values(parsed.map);
                if (mapValues.length === 0 || mapValues[0].userId === currentUserId) {
                    ordersCache = mapValues.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    lastSyncTime = parsed.lastSync;
                    if(ordersCache.length > 0) renderOrdersList(ordersCache);
                } else {
                    throw new Error("Usuario distinto");
                }
            } else {
                throw new Error("Formato antiguo");
            }
        } catch (e) { 
            console.warn("Caché de pedidos corrupto o antiguo, limpiando...");
            ordersCache = []; 
            localStorage.removeItem(STORAGE_KEY_ORDERS);
        }
    }

    if (ordersCache.length === 0 && container) {
        container.innerHTML = `<div class="text-center py-10 text-gray-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando historial de pedidos...</div>`;
    }

    // 2. CONEXIÓN EN TIEMPO REAL
    if (unsubscribeOrders) unsubscribeOrders();

    const colRef = collection(db, "orders");
    let q;

    if (lastSyncTime === 0 || ordersCache.length === 0) {
        console.log("☁️ [Orders] Descargando historial completo y activando tiempo real...");
        q = query(colRef, where("userId", "==", currentUserId), orderBy("createdAt", "desc"));
    } else {
        console.log("🔄 [Orders] Escuchando actualizaciones en tiempo real...");
        q = query(colRef, where("userId", "==", currentUserId), where("updatedAt", ">", new Date(lastSyncTime)));
    }

    unsubscribeOrders = onSnapshot(q, (snapshot) => {
        if (snapshot.empty && lastSyncTime !== 0) {
            console.log("✅ [Orders] Historial al día.");
            return;
        }

        let hasChanges = false;
        let runtimeMap = {};
        ordersCache.forEach(o => runtimeMap[o.id] = o);

        snapshot.docChanges().forEach(change => {
            const data = change.doc.data();
            const id = change.doc.id;

            if (data.createdAt?.toDate) data.createdAt = data.createdAt.toDate().toISOString();
            if (data.updatedAt?.toDate) data.updatedAt = data.updatedAt.toDate().toISOString();

            if (change.type === 'added' || change.type === 'modified') {
                runtimeMap[id] = { id, ...data };
                hasChanges = true;
            } else if (change.type === 'removed') {
                if (runtimeMap[id]) {
                    delete runtimeMap[id];
                    hasChanges = true;
                }
            }
        });

        if (hasChanges) {
            console.log(`🔥 [Orders] Tiempo real: ${snapshot.docChanges().length} cambios detectados.`);
            
            ordersCache = Object.values(runtimeMap).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify({
                map: runtimeMap,
                lastSync: Date.now()
            }));

            window.applyOrderFilters(); 
        }
    }, (error) => {
        console.error("Error en SmartSync Orders Realtime:", error);
        if(ordersCache.length === 0 && container) {
             container.innerHTML = `<div class="text-center py-10 text-red-400 font-bold text-xs"><i class="fa-solid fa-triangle-exclamation"></i> No se pudo conectar a los pedidos.</div>`;
        }
    });
}

function renderOrdersList(orders) {
    const container = document.getElementById('orders-container');
    if (!container) return;
    container.innerHTML = "";
    
    const pageOrders = orders.slice(0, ORDERS_PER_PAGE); 
    
    if (pageOrders.length === 0) {
        container.innerHTML = `
            <div class="bg-white p-10 rounded-[2rem] text-center border-2 border-dashed border-gray-200">
                <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300"><i class="fa-solid fa-box-open text-2xl"></i></div>
                <p class="text-gray-400 font-black uppercase text-[10px] tracking-widest">Aún no tienes pedidos.</p>
                <a href="/shop/catalog.html" class="inline-block mt-4 text-brand-cyan font-bold text-xs hover:underline">Ir a la tienda</a>
            </div>`;
        return;
    }

    pageOrders.forEach(order => {
        const dateObj = new Date(order.createdAt);
        const dateStr = dateObj.toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'});
        let statusConfig = getStatusConfig(order.status);
        const totalItems = order.items ? order.items.length : 0;

        const card = document.createElement('div');
        card.className = "bg-white rounded-[1.5rem] p-5 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden mb-4";
        card.onclick = () => window.location.href = `/shop/order-detail.html?id=${order.id}`;

        const borderColorClass = statusConfig.color.split(' ')[0].replace('bg-', 'bg-'); 

        card.innerHTML = `
            <div class="absolute top-0 left-0 w-1.5 h-full ${borderColorClass}"></div>
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pl-4">
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-brand-black font-black text-xs border border-gray-100 group-hover:bg-brand-black group-hover:text-brand-cyan transition-colors shadow-sm">
                        <div class="text-center leading-none"><span class="block text-[8px] opacity-60">ORDEN</span>#${order.id.slice(0, 4)}</div>
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-1.5">
                            <span class="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border ${statusConfig.color} flex items-center gap-1.5 shadow-sm"><i class="fa-solid ${statusConfig.icon}"></i> ${statusConfig.label}</span>
                            <span class="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                        </div>
                        <p class="text-xs font-bold text-gray-600 group-hover:text-brand-cyan transition-colors">${totalItems} producto(s)</p>
                    </div>
                </div>
                <div class="flex items-center justify-between w-full md:w-auto gap-8 mt-2 md:mt-0 pl-16 md:pl-0 border-t md:border-0 border-gray-50 pt-3 md:pt-0">
                    <div class="text-right">
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total</p>
                        <p class="text-xl font-black text-brand-black tracking-tight">$${(order.total || 0).toLocaleString('es-CO')}</p>
                    </div>
                    <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-gray-300 group-hover:bg-brand-cyan group-hover:text-white transition shadow-sm"><i class="fa-solid fa-chevron-right text-xs"></i></div>
                </div>
            </div>`;
        container.appendChild(card);
    });

    const loadMoreBox = document.getElementById('load-more-container');
    if (orders.length > ORDERS_PER_PAGE) {
        loadMoreBox.classList.remove('hidden');
        loadMoreBox.querySelector('button').onclick = () => {
            renderOrdersListFull(orders); 
            loadMoreBox.classList.add('hidden');
        };
    } else {
        loadMoreBox.classList.add('hidden');
    }
}

function renderOrdersListFull(orders) {
    const container = document.getElementById('orders-container');
    if (!container) return;
    container.innerHTML = "";
    orders.forEach(order => { 
        const dateObj = new Date(order.createdAt);
        const dateStr = dateObj.toLocaleDateString('es-CO', {day: 'numeric', month: 'long', year: 'numeric'});
        let statusConfig = getStatusConfig(order.status);
        const totalItems = order.items ? order.items.length : 0;
        const card = document.createElement('div');
        card.className = "bg-white rounded-[1.5rem] p-5 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative overflow-hidden mb-4";
        card.onclick = () => window.location.href = `/shop/order-detail.html?id=${order.id}`;
        const borderColorClass = statusConfig.color.split(' ')[0].replace('bg-', 'bg-'); 
        card.innerHTML = `
            <div class="absolute top-0 left-0 w-1.5 h-full ${borderColorClass}"></div>
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pl-4">
                <div class="flex items-center gap-4">
                    <div class="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-brand-black font-black text-xs border border-gray-100 group-hover:bg-brand-black group-hover:text-brand-cyan transition-colors shadow-sm">
                        <div class="text-center leading-none"><span class="block text-[8px] opacity-60">ORDEN</span>#${order.id.slice(0, 4)}</div>
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-1.5">
                            <span class="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase border ${statusConfig.color} flex items-center gap-1.5 shadow-sm"><i class="fa-solid ${statusConfig.icon}"></i> ${statusConfig.label}</span>
                            <span class="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                        </div>
                        <p class="text-xs font-bold text-gray-600 group-hover:text-brand-cyan transition-colors">${totalItems} producto(s)</p>
                    </div>
                </div>
                <div class="flex items-center justify-between w-full md:w-auto gap-8 mt-2 md:mt-0 pl-16 md:pl-0 border-t md:border-0 border-gray-50 pt-3 md:pt-0">
                    <div class="text-right">
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Total</p>
                        <p class="text-xl font-black text-brand-black tracking-tight">$${(order.total || 0).toLocaleString('es-CO')}</p>
                    </div>
                    <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-gray-300 group-hover:bg-brand-cyan group-hover:text-white transition shadow-sm"><i class="fa-solid fa-chevron-right text-xs"></i></div>
                </div>
            </div>`;
        container.appendChild(card);
    });
}

function getStatusConfig(status) {
    if(status === 'PENDIENTE_PAGO') return { color: "bg-yellow-50 text-yellow-600 border-yellow-200", icon: "fa-clock", label: "Pendiente Pago" };
    if(['PAGADO', 'PENDIENTE', 'CONFIRMADO'].includes(status)) return { color: "bg-blue-50 text-blue-600 border-blue-200", icon: "fa-check-circle", label: "Confirmado" };
    if(['ALISTADO', 'ALISTAMIENTO'].includes(status)) return { color: "bg-purple-50 text-purple-600 border-purple-200", icon: "fa-box-open", label: "Preparando" };
    if(['DESPACHADO', 'EN_RUTA'].includes(status)) return { color: "bg-cyan-50 text-cyan-700 border-cyan-200", icon: "fa-truck-fast", label: "En Camino" };
    if(status === 'ENTREGADO') return { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "fa-house-circle-check", label: "Entregado" };
    if(['CANCELADO', 'RECHAZADO'].includes(status)) return { color: "bg-red-50 text-red-600 border-red-200", icon: "fa-ban", label: "Cancelado" };
    return { color: "bg-gray-100 text-gray-500", icon: "fa-circle", label: status || "Pendiente" };
}

function updateUserUI(user) {
    const nameSide = document.getElementById('user-name-side');
    const emailSide = document.getElementById('user-email-side');
    const avatar = document.getElementById('user-avatar');
    const name = user.displayName || "Usuario";
    if (nameSide) nameSide.textContent = name;
    if (emailSide) emailSide.textContent = user.email;
    if (avatar) avatar.innerHTML = `<span class="font-black">${name.substring(0, 2).toUpperCase()}</span>`;
    const emailInput = document.getElementById('form-email-readonly');
    if(emailInput) emailInput.value = user.email;
}

function initYearSelect() {
    const yearSelect = document.getElementById('filter-year');
    const currentYear = new Date().getFullYear();
    if(yearSelect) {
        yearSelect.innerHTML = "";
        for (let i = 0; i < 5; i++) {
            const y = currentYear - i;
            yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
        }
    }
}

window.toggleDateFilters = () => {
    const mode = document.getElementById('filter-mode').value;
    const dateSelectors = document.getElementById('date-selectors');
    if (mode === 'custom') { dateSelectors.classList.remove('hidden'); dateSelectors.classList.add('flex'); } 
    else { dateSelectors.classList.add('hidden'); dateSelectors.classList.remove('flex'); }
    window.applyOrderFilters();
};

window.applyOrderFilters = () => {
    const mode = document.getElementById('filter-mode').value;
    let filtered = [...ordersCache];
    const now = new Date();

    if (mode === 'last3') {
        const dateLimit = new Date();
        dateLimit.setDate(now.getDate() - 90);
        filtered = filtered.filter(o => new Date(o.createdAt) >= dateLimit);
    } else if (mode === 'this_year') {
        const dateLimit = new Date(now.getFullYear(), 0, 1);
        filtered = filtered.filter(o => new Date(o.createdAt) >= dateLimit);
    } else if (mode === 'custom') {
        const m = parseInt(document.getElementById('filter-month').value);
        const y = parseInt(document.getElementById('filter-year').value);
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 0, 23, 59, 59);
        filtered = filtered.filter(o => {
            const d = new Date(o.createdAt);
            return d >= start && d <= end;
        });
    }
    renderOrdersList(filtered);
};

window.loadMoreOrders = () => {
    renderOrdersListFull(ordersCache);
};

// ==========================================================================
// GESTIÓN DIRECCIONES Y PERFIL
// ==========================================================================

window.toggleModal = (show) => {
    if (show) {
        addrModal.classList.add('active');
        document.getElementById('modal-addr-title').innerHTML = editingAddressIndex >= 0 ? 'Editar Dirección' : 'Nueva Dirección';
    } else {
        addrModal.classList.remove('active');
        addrForm.reset();
        cityContainer.classList.add('opacity-50');
        cityInput.disabled = true;
        editingAddressIndex = -1; 
    }
};

if(document.getElementById('btn-open-address-modal')) {
    document.getElementById('btn-open-address-modal').onclick = () => {
        editingAddressIndex = -1;
        window.toggleModal(true);
    };
}

addrForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = addrForm.querySelector('button[type="submit"]');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

    const newAddr = {
        alias: document.getElementById('modal-addr-alias').value,
        address: document.getElementById('modal-addr-value').value,
        dept: deptInput.value,
        city: cityInput.value,
        zip: document.getElementById('modal-addr-zip').value || "",
        notes: document.getElementById('modal-addr-notes').value || "",
        isDefault: document.getElementById('modal-addr-default').checked,
        updatedAt: new Date()
    };

    try {
        let currentAddrs = [...addressesCache];

        if (newAddr.isDefault) currentAddrs = currentAddrs.map(a => ({ ...a, isDefault: false }));
        if (currentAddrs.length === 0) newAddr.isDefault = true;

        if (editingAddressIndex >= 0) currentAddrs[editingAddressIndex] = newAddr;
        else currentAddrs.push(newAddr);

        // Al hacer updateDoc, el onSnapshot (initUserRealtimeSync) se dispara automáticamente y repinta la UI
        await updateDoc(doc(db, "users", currentUserId), { addresses: currentAddrs });
        window.toggleModal(false);
    } catch (error) { 
        console.error(error); 
        alert("Error al guardar la dirección"); 
    } finally { 
        btn.disabled = false; 
        btn.textContent = "Guardar"; 
    }
};

window.editAddress = (index) => {
    editingAddressIndex = index;
    if(addressesCache.length > index) {
        const addr = addressesCache[index];
        document.getElementById('modal-addr-alias').value = addr.alias;
        document.getElementById('modal-addr-value').value = addr.address;
        deptInput.value = addr.dept;
        cityInput.value = addr.city;
        cityInput.disabled = false;
        cityContainer.classList.remove('opacity-50');
        document.getElementById('modal-addr-zip').value = addr.zip || "";
        document.getElementById('modal-addr-notes').value = addr.notes || "";
        document.getElementById('modal-addr-default').checked = addr.isDefault || false;
        window.toggleModal(true);
    }
};

window.deleteAddress = async (index) => {
    if (!confirm("¿Eliminar esta ubicación?")) return;
    try {
        let currentAddrs = [...addressesCache];
        currentAddrs.splice(index, 1);
        await updateDoc(doc(db, "users", currentUserId), { addresses: currentAddrs });
    } catch (e) {
        console.error("Error al eliminar", e);
    }
};

async function initColombiaAPI() {
    try {
        const response = await fetch('https://api-colombia.com/api/v1/Department');
        allDepartments = await response.json();

        deptInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            deptResults.innerHTML = "";
            if (term.length < 1) { deptResults.classList.add('hidden'); return; }
            allDepartments.filter(d => d.name.toLowerCase().includes(term)).forEach(dept => {
                const div = document.createElement('div');
                div.className = "p-2 hover:bg-slate-50 cursor-pointer text-xs font-bold rounded-lg transition uppercase text-gray-600 hover:text-brand-cyan";
                div.textContent = dept.name;
                div.onclick = () => {
                    deptInput.value = dept.name;
                    document.getElementById('modal-addr-dept-id').value = dept.id;
                    deptResults.classList.add('hidden');
                    loadCities(dept.id);
                };
                deptResults.appendChild(div);
            });
            deptResults.classList.remove('hidden');
        };

        cityInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            cityResults.innerHTML = "";
            if (term.length < 1) { cityResults.classList.add('hidden'); return; }
            allCities.filter(c => c.name.toLowerCase().includes(term)).forEach(city => {
                const div = document.createElement('div');
                div.className = "p-2 hover:bg-slate-50 cursor-pointer text-xs font-bold rounded-lg transition uppercase text-gray-600 hover:text-brand-cyan";
                div.textContent = city.name;
                div.onclick = () => {
                    cityInput.value = city.name;
                    cityResults.classList.add('hidden');
                };
                cityResults.appendChild(div);
            });
            cityResults.classList.remove('hidden');
        };
    } catch (e) { console.error(e); }
}

async function loadCities(deptId) {
    cityInput.disabled = true; cityInput.value = "Cargando...";
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        allCities = await res.json();
        cityInput.disabled = false; cityInput.value = ""; cityInput.placeholder = "Escribe ciudad...";
        cityContainer.classList.remove('opacity-50');
    } catch (e) { console.error(e); }
}

document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = "Guardando...";
    try {
        const newData = {
            name: document.getElementById('form-name').value,
            document: document.getElementById('form-id').value,
            phone: document.getElementById('form-phone').value,
            birthdate: document.getElementById('form-birth').value,
            updatedAt: new Date()
        };
        await updateDoc(doc(db, "users", currentUserId), newData);
        alert("✅ Perfil actualizado");
    } catch (e) { alert("Error al guardar perfil"); }
    finally { btn.disabled = false; btn.textContent = "Guardar Cambios"; }
});

const logoutBtn = document.getElementById('btn-logout-profile');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm("¿Cerrar sesión?")) {
            if(unsubscribeOrders) unsubscribeOrders();
            if(unsubscribeUser) unsubscribeUser();
            
            await signOut(auth);
            sessionStorage.clear();
            localStorage.removeItem(STORAGE_KEY_ORDERS);
            window.location.href = "/index.html";
        }
    });
}