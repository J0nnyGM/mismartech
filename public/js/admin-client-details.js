import { db, doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, runTransaction, Timestamp, limit, startAfter } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const params = new URLSearchParams(window.location.search);
const clientId = params.get('id');

let clientLoadedSerials = [];
let lastSerialOrderDoc = null;
const SERIALS_PAGE_SIZE = 15; // Límite de órdenes a leer por página (Ahorro de dinero)

if (!clientId) window.location.href = 'clients.html';

// REFERENCIAS DOM
const els = {
    // Header Info
    initials: document.getElementById('client-initials'),
    nameBig: document.getElementById('client-name-big'),
    emailBig: document.getElementById('client-email-big'),
    tagsContainer: document.getElementById('client-tags'),
    ltv: document.getElementById('stat-ltv'),
    balance: document.getElementById('stat-balance'),
    
    // Formulario
    inpName: document.getElementById('edit-name'),
    inpPhone: document.getElementById('edit-phone'),
    inpDoc: document.getElementById('edit-doc'),
    inpDept: document.getElementById('edit-department'),
    inpCity: document.getElementById('edit-city'),
    inpAddress: document.getElementById('edit-address'),
    inpNotes: document.getElementById('edit-notes'),
    btnUpdate: document.getElementById('btn-update-client'),
    
    // Listas
    ordersList: document.getElementById('client-orders-list'),
    pendingList: document.getElementById('pending-invoices-list'),
    snList: document.getElementById('client-sn-list'),

    // Pagos
    debtAmount: document.getElementById('debt-amount'),
    modalDebt: document.getElementById('modal-debt-amount'),
    payAccount: document.getElementById('pay-account'),
    payAmount: document.getElementById('pay-amount'),
    payNote: document.getElementById('pay-note'),
    payForm: document.getElementById('payment-form'),
    paymentModal: document.getElementById('payment-modal')
};

let clientData = null;
let pendingOrders = []; 
let lastOrderDoc = null; 
const PAGE_SIZE = 20;

// --- HELPERS ---
const formatMoney = (amount) => `$${Math.round(amount).toLocaleString('es-CO')}`;
const getCleanVal = (val) => {
    if (typeof val === 'number') return val;
    return val ? parseInt(val.toString().replace(/\D/g, ""), 10) : 0;
};

document.querySelectorAll('.currency-input').forEach(input => {
    input.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, "");
        if (val === "") { e.target.value = ""; return; }
        e.target.value = "$" + parseInt(val, 10).toLocaleString('es-CO');
    });
});

// --- 1. INIT ---
async function init() {
    await Promise.all([
        loadDepartmentsAPI(), 
        loadClientData(), 
        loadAccounts(),
        loadClientSerials() // <-- NUEVA LLAMADA
    ]);
}

// --- 2. CARGAR METADATA ---
async function loadAccounts() {
    try {
        const q = query(collection(db, "accounts"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        els.payAccount.innerHTML = '<option value="">Seleccione Cuenta Destino...</option>';
        snap.forEach(d => {
            const acc = d.data();
            els.payAccount.innerHTML += `<option value="${d.id}">${acc.name}</option>`;
        });
    } catch (e) { console.error("Error loading accounts:", e); }
}

async function loadDepartmentsAPI() {
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        depts.sort((a, b) => a.name.localeCompare(b.name));
        els.inpDept.innerHTML = '<option value="">Seleccione...</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; opt.textContent = d.name;
            els.inpDept.appendChild(opt);
        });
    } catch (e) { console.error(e); }
}

els.inpDept.addEventListener('change', (e) => loadCitiesAPI(e.target.value));

async function loadCitiesAPI(deptId, cityToSelect = null) {
    els.inpCity.innerHTML = '<option value="">Cargando...</option>'; els.inpCity.disabled = true;
    if (!deptId) return;
    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
        const cities = await res.json();
        cities.sort((a, b) => a.name.localeCompare(b.name));
        els.inpCity.innerHTML = '<option value="">Seleccione Ciudad...</option>';
        cities.forEach(c => {
            const opt = document.createElement('option'); opt.value = c.name; opt.textContent = c.name; els.inpCity.appendChild(opt);
        });
        els.inpCity.disabled = false;
        if (cityToSelect) els.inpCity.value = cityToSelect;
    } catch (e) { console.error(e); }
}

async function loadClientData() {
    try {
        const snap = await getDoc(doc(db, "users", clientId));
        if (!snap.exists()) { alert("Cliente no encontrado"); return; }
        clientData = snap.data();
        
        els.nameBig.textContent = clientData.name || "Sin Nombre";
        els.initials.textContent = (clientData.name || "U").charAt(0).toUpperCase();
        els.emailBig.textContent = clientData.email || "";
        
        els.inpName.value = clientData.name || "";
        els.inpPhone.value = clientData.phone || "";
        els.inpDoc.value = clientData.document || "";
        els.inpNotes.value = clientData.adminNotes || "";
        
        const addr = (clientData.addresses && clientData.addresses[0]) || {};
        els.inpAddress.value = addr.address || clientData.address || "";
        
        // Cargar pedidos e historial financiero
        loadClientOrders();

    } catch (e) { console.error(e); }
}

// --- 3. CARGAR PEDIDOS Y DEUDA (FINAL Y PAGINADO) ---
async function loadClientOrders(isNextPage = false) {
    const loadMoreBtn = document.getElementById('load-more-orders-container');
    
    if (!isNextPage) {
        els.ordersList.innerHTML = `<tr><td colspan="6" class="p-8 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i> Cargando...</td></tr>`;
        els.pendingList.innerHTML = ""; 
        pendingOrders = []; 
        if(loadMoreBtn) loadMoreBtn.classList.add('hidden');
    }

    try {
        // A. CÁLCULO DE DEUDA Y TOTAL COMPRAS (LTV)
        // Solo lo hacemos en la primera carga para actualizar las cajas superiores
        if (!isNextPage) {
            // Buscamos TODAS las órdenes del cliente para calcular los totales reales
            const qAllOrders = query(
                collection(db, "orders"), 
                where("userId", "==", clientId)
            );
            
            const snapAll = await getDocs(qAllOrders);
            let totalDebt = 0;
            let totalLTV = 0; // Lifetime Value (Total de compras históricas)
            
            els.pendingList.innerHTML = "";
            pendingOrders = [];

            if(snapAll.empty) {
                els.pendingList.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-xs text-gray-400 font-bold uppercase">Al día.</td></tr>`;
            } else {
                snapAll.forEach(d => {
                    const o = { id: d.id, ...d.data() };
                    
                    // Ignoramos los cancelados/rechazados para las estadísticas financieras
                    if(o.status === 'CANCELADO' || o.status === 'RECHAZADO') return;

                    const total = o.total || 0;
                    const paid = o.amountPaid || 0;
                    // Restamos lo devuelto para que el saldo pendiente sea exacto
                    const refunded = o.refundedAmount || 0; 
                    
                    // Sumamos al Total de Compras Históricas (LTV)
                    totalLTV += (total - refunded); 

                    // Calculamos la deuda real
                    const balance = total - paid - refunded;

                    // Si hay deuda pendiente y no está pagada totalmente
                    if (balance > 0 && o.paymentStatus !== 'PAID' && o.status !== 'PAGADO') {
                        totalDebt += balance;
                        pendingOrders.push({ ...o, balance, ref: d.ref });
                        
                        els.pendingList.innerHTML += `
                            <tr class="border-b border-gray-50 hover:bg-red-50/30 transition">
                                <td class="px-6 py-4 font-mono text-gray-500">#${o.id.slice(0,6).toUpperCase()}</td>
                                <td class="px-6 py-4 font-bold text-gray-600">${o.createdAt?.toDate().toLocaleDateString('es-CO')}</td>
                                <td class="px-6 py-4 text-right font-black text-brand-black">${formatMoney(total)}</td>
                                <td class="px-6 py-4 text-right text-green-600">${formatMoney(paid)}</td>
                                <td class="px-6 py-4 text-right text-red-500 font-black">${formatMoney(balance)}</td>
                            </tr>
                        `;
                    }
                });
            }

            if (pendingOrders.length === 0) {
                 els.pendingList.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-xs text-gray-400 font-bold uppercase">El cliente está al día con sus pagos.</td></tr>`;
            }

            // 🔥 ACTUALIZAR UI DE LAS CAJAS SUPERIORES 🔥
            els.ltv.textContent = formatMoney(totalLTV);
            els.balance.textContent = formatMoney(totalDebt);
            els.debtAmount.textContent = formatMoney(totalDebt);
            els.modalDebt.textContent = formatMoney(totalDebt);
        }

        // B. CARGAR HISTORIAL VISUAL (PAGINADO)
        let qHist = query(
            collection(db, "orders"), 
            where("userId", "==", clientId), 
            orderBy("createdAt", "desc"),
            limit(PAGE_SIZE) 
        );

        if (isNextPage && lastOrderDoc) {
            qHist = query(qHist, startAfter(lastOrderDoc));
        }

        const snapHist = await getDocs(qHist);
        
        if (!isNextPage) els.ordersList.innerHTML = "";

        if (snapHist.empty) {
            if (!isNextPage) els.ordersList.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-xs text-gray-400 font-bold uppercase">Sin historial de pedidos.</td></tr>`;
            if(loadMoreBtn) loadMoreBtn.classList.add('hidden');
            return;
        }

        // Actualizar cursor de paginación
        lastOrderDoc = snapHist.docs[snapHist.docs.length - 1];
        
        // Mostrar botón si hay más datos potenciales
        if (loadMoreBtn) {
            if (snapHist.docs.length === PAGE_SIZE) loadMoreBtn.classList.remove('hidden');
            else loadMoreBtn.classList.add('hidden');
        }

        snapHist.forEach(d => {
            const o = d.data();
            
            // Cálculos financieros exactos para la tabla
            const total = o.total || 0;
            const paid = o.amountPaid || 0;
            const refunded = o.refundedAmount || 0;
            const pendingBalance = total - paid - refunded;
            
            const isFullyPaid = o.paymentStatus === 'PAID' || o.status === 'PAGADO' || pendingBalance <= 0;

            let payBadge = `<span class="text-[9px] font-black uppercase text-red-500 bg-red-50 px-2 py-1 rounded border border-red-100">Pendiente</span>`;
            if (isFullyPaid) payBadge = `<span class="text-[9px] font-black uppercase text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100"><i class="fa-solid fa-check"></i> Pagado</span>`;
            else if (paid > 0) payBadge = `<span class="text-[9px] font-black uppercase text-orange-500 bg-orange-50 px-2 py-1 rounded border border-orange-100">Parcial</span>`;

            // Insertar HTML
            const row = `
                <tr class="hover:bg-slate-50 transition border-b border-gray-50 group animate-in fade-in">
                    <td class="px-8 py-6 font-mono text-xs font-bold text-brand-cyan">#${(o.internalOrderNumber || d.id.slice(0,6)).toString().toUpperCase()}</td>
                    <td class="px-8 py-6 text-xs font-bold">${o.createdAt?.toDate().toLocaleDateString('es-CO')}</td>
                    <td class="px-8 py-6 text-center"><span class="px-3 py-1 rounded-full text-[9px] font-black uppercase border border-gray-200 bg-gray-50 text-gray-500">${o.status}</span></td>
                    <td class="px-8 py-6 text-center">${payBadge}</td>
                    <td class="px-8 py-6 text-right font-black text-brand-black text-sm">${formatMoney(total)}</td>
                    <td class="px-8 py-6 text-center">
                        <button onclick="window.openOrderModal('${d.id}')" title="Ver Detalle" class="w-8 h-8 flex items-center justify-center mx-auto rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-brand-cyan hover:border-brand-cyan transition shadow-sm"><i class="fa-solid fa-eye text-xs"></i></button>
                    </td>
                </tr>
            `;
            els.ordersList.insertAdjacentHTML('beforeend', row);
        });

    } catch (e) { 
        console.error("Error orders:", e); 
        if(!isNextPage) els.ordersList.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-400">Error cargando datos de historial.</td></tr>`;
    }
}

window.loadMoreOrders = () => loadClientOrders(true);


// --- 4. PROCESAR PAGO (CORREGIDO Y SEGURO) ---
els.payForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = els.payForm.querySelector('button');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

    const amount = getCleanVal(els.payAmount.value);
    const accountId = els.payAccount.value;
    const note = els.payNote.value || "Abono Cliente";

    if (!accountId) { alert("Seleccione cuenta destino"); btn.disabled=false; btn.innerHTML=originalText; return; }
    if (amount <= 0) { alert("Monto inválido"); btn.disabled=false; btn.innerHTML=originalText; return; }
    
    try {
        await runTransaction(db, async (t) => {
            // 1. Leer Cuenta (Bloqueo)
            const accRef = doc(db, "accounts", accountId);
            const accDoc = await t.get(accRef);
            if (!accDoc.exists()) throw "Cuenta no existe";
            
            // 2. Leer Órdenes Pendientes (Solo las necesarias)
            // Ya tenemos 'pendingOrders' cargado en memoria, pero para transacción segura
            // debemos leerlas dentro del bloque 't'.
            const docsToPay = [];
            let simulatedPay = amount;
            
            for (const po of pendingOrders) {
                if (simulatedPay <= 0) break;
                const dRef = doc(db, "orders", po.id);
                const dSnap = await t.get(dRef); // Lectura transaccional
                if (dSnap.exists()) {
                    docsToPay.push(dSnap);
                    const bal = (dSnap.data().total || 0) - (dSnap.data().amountPaid || 0);
                    simulatedPay -= bal;
                }
            }

            // --- ESCRITURA ---

            // A. Sumar al Banco
            const currentBal = accDoc.data().balance || 0;
            t.update(accRef, { balance: currentBal + amount });

            // B. Registrar Ingreso (EXPENSE con type INCOME)
            const incomeRef = doc(collection(db, "expenses"));
            t.set(incomeRef, {
                description: `Pago Cliente: ${clientData.name}`,
                amount: amount, 
                category: "Ingreso Ventas", 
                type: 'INCOME', // CLAVE: Marcado correcto
                paymentMethod: accDoc.data().name,
                date: Timestamp.now(),
                createdAt: Timestamp.now(),
                supplierName: clientData.name || "Cliente Final",
                note: note
            });

            // C. Aplicar a Facturas (FIFO)
            let remaining = amount;
            for (const dSnap of docsToPay) {
                if (remaining <= 0) break;
                
                const data = dSnap.data();
                const total = data.total || 0;
                const paid = data.amountPaid || 0;
                const debt = total - paid;

                if (debt <= 0) continue;

                const apply = Math.min(remaining, debt);
                const newPaid = paid + apply;
                
                // Tolerancia de $100 pesos para cierre
                const isPaid = newPaid >= (total - 100);

                t.update(dSnap.ref, {
                    amountPaid: newPaid,
                    paymentStatus: isPaid ? 'PAID' : 'PARTIAL',
                    lastPaymentDate: Timestamp.now()
                });

                remaining -= apply;
            }
        });

        alert("✅ Pago registrado exitosamente");
        els.paymentModal.classList.add('hidden');
        els.payForm.reset();
        loadClientOrders(); // Recargar interfaz

    } catch (e) {
        console.error("Transaction failed: ", e);
        alert("Error al procesar: " + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
};

// --- MODAL DETALLE PEDIDO ---
window.openOrderModal = async (orderId) => {
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if(!snap.exists()) return;
        const o = snap.data();
        
        const el = (id) => document.getElementById(id);
        el('modal-order-id').textContent = `#${snap.id.slice(0,8).toUpperCase()}`;
        el('modal-order-date').textContent = o.createdAt?.toDate().toLocaleString();
        el('modal-total').textContent = formatMoney(o.total || 0);
        el('modal-status-badge').textContent = o.status;
        
        // Shipping
        const ship = o.shippingData || {};
        el('modal-shipping-info').textContent = ship.address 
            ? `${ship.address}, ${ship.city || ''} (${ship.dept || ''}) \nGuía: ${ship.guideNumber || 'Pendiente'}`
            : "Retiro en Tienda / Digital";

        const itemsDiv = el('modal-items-list');
        itemsDiv.innerHTML = "";
        if(o.items) {
            o.items.forEach(i => {
                itemsDiv.innerHTML += `
                    <div class="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div class="flex gap-3 items-center">
                            <span class="bg-brand-black text-white text-[10px] font-bold px-2 py-1 rounded-md">${i.quantity}x</span>
                            <span class="text-xs font-bold text-gray-700 uppercase">${i.name}</span>
                        </div>
                        <span class="text-xs font-black text-brand-black">${formatMoney(i.price || 0)}</span>
                    </div>`;
            });
        }
        
        document.getElementById('order-modal').classList.remove('hidden');
    } catch(e) { console.error(e); }
};

// Update Client Info
els.btnUpdate.onclick = async () => {
    els.btnUpdate.disabled = true; els.btnUpdate.textContent = "Guardando...";
    try {
        await updateDoc(doc(db, "users", clientId), {
            name: els.inpName.value,
            phone: els.inpPhone.value,
            document: els.inpDoc.value,
            adminNotes: els.inpNotes.value,
            address: els.inpAddress.value, // Legacy
            // Update address array structure properly if needed
            updatedAt: Timestamp.now()
        });
        alert("✅ Datos actualizados");
    } catch(e) { alert("Error: " + e.message); }
    finally { els.btnUpdate.disabled = false; els.btnUpdate.textContent = "Guardar Cambios"; }
};

// ==========================================
// 5. CARGAR SERIALES PARA GARANTÍA
// ==========================================
async function loadClientSerials(isNextPage = false) {
    const container = document.getElementById('client-sn-list');
    const loadMoreBtn = document.getElementById('load-more-serials-container');

    if (!isNextPage) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-10"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan text-2xl mb-2"></i><p class="text-xs font-bold uppercase tracking-widest">Descargando seriales...</p></div>';
        clientLoadedSerials = [];
        lastSerialOrderDoc = null;
    } else {
        const btn = loadMoreBtn.querySelector('button');
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...';
    }

    try {
        let q = query(
            collection(db, "orders"),
            where("userId", "==", clientId),
            orderBy("createdAt", "desc"),
            limit(SERIALS_PAGE_SIZE)
        );

        if (isNextPage && lastSerialOrderDoc) {
            q = query(q, startAfter(lastSerialOrderDoc));
        }

        const snap = await getDocs(q);

        if (!isNextPage) container.innerHTML = "";

        if (snap.empty) {
            if (!isNextPage) {
                container.innerHTML = `
                    <div class="col-span-full text-center bg-white border border-gray-100 rounded-[2rem] py-12 shadow-sm">
                        <i class="fa-solid fa-barcode text-4xl text-gray-200 mb-3"></i>
                        <p class="text-[10px] text-gray-400 font-black uppercase tracking-widest">No hay seriales registrados</p>
                        <p class="text-xs text-gray-400 font-bold mt-1">No se encontraron registros en el historial de este cliente.</p>
                    </div>`;
            }
            if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
            return;
        }

        // Guardamos el cursor para la próxima página
        lastSerialOrderDoc = snap.docs[snap.docs.length - 1];

        // Lógica de mostrar/ocultar el botón
        if (loadMoreBtn) {
            if (snap.docs.length === SERIALS_PAGE_SIZE) {
                loadMoreBtn.classList.remove('hidden');
                loadMoreBtn.querySelector('button').innerHTML = '<i class="fa-solid fa-circle-plus"></i> Cargar historial anterior';
            } else {
                loadMoreBtn.classList.add('hidden');
            }
        }

        let newSerialsFound = [];

        // Extraer seriales del bloque actual
        snap.forEach(doc => {
            const o = doc.data();
            if (o.status === 'CANCELADO' || o.status === 'RECHAZADO') return;

            if (o.items && Array.isArray(o.items)) {
                o.items.forEach(item => {
                    if (item.sns && Array.isArray(item.sns)) {
                        item.sns.forEach(sn => {
                            if (sn && sn.trim() !== '') {
                                newSerialsFound.push({
                                    sn: sn.trim().toUpperCase(),
                                    productName: item.name || 'Producto',
                                    orderId: doc.id,
                                    date: o.createdAt?.toDate()
                                });
                            }
                        });
                    }
                });
            }
        });

        // Sumamos los nuevos a la memoria RAM global
        clientLoadedSerials = [...clientLoadedSerials, ...newSerialsFound];
        
        // Renderizamos
        renderSerials(clientLoadedSerials);

        // Si el usuario estaba buscando algo mientras cargaba más, forzamos el filtro
        document.getElementById('search-serial-input').dispatchEvent(new Event('input'));

    } catch (e) {
        console.error("Error cargando seriales:", e);
        if (!isNextPage) container.innerHTML = '<div class="col-span-full text-center text-red-500 py-8 font-bold text-xs uppercase tracking-widest">Error al cargar datos.</div>';
    }
}

// Dibuja las tarjetas basado en el array que le pasen (completo o filtrado)
function renderSerials(serialsArray) {
    const container = document.getElementById('client-sn-list');
    
    if (serialsArray.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-6 font-bold text-xs uppercase tracking-widest">No se encontraron coincidencias en los datos cargados.</div>';
        return;
    }

    container.innerHTML = serialsArray.map(s => {
        const dateStr = s.date ? s.date.toLocaleDateString('es-CO') : '--';
        return `
            <div class="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-lg transition-all relative group overflow-hidden fade-in">
                <div class="absolute top-0 left-0 w-1 h-full bg-brand-cyan group-hover:w-2 transition-all"></div>
                <div class="flex justify-between items-start mb-3 pl-2">
                    <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest"><i class="fa-solid fa-tag text-brand-cyan mr-1"></i> Serial Registrado</p>
                    <button onclick="window.openOrderModal('${s.orderId}')" class="text-[9px] font-black bg-slate-50 hover:bg-brand-black hover:text-white text-gray-500 px-2 py-1 rounded border border-gray-200 transition-colors cursor-pointer" title="Ver Orden Completa">
                        #${s.orderId.slice(0,6)}
                    </button>
                </div>
                <div class="pl-2">
                    <p class="font-mono text-xl md:text-2xl font-black text-brand-black tracking-tight mb-1 select-all" title="Haz doble clic para copiar">${s.sn}</p>
                    <p class="text-xs font-bold text-gray-600 line-clamp-2 leading-tight" title="${s.productName}">${s.productName}</p>
                </div>
                <div class="mt-4 pt-4 border-t border-gray-100 pl-2">
                    <p class="text-[9px] font-bold text-gray-400 uppercase tracking-widest"><i class="fa-regular fa-calendar text-gray-300 mr-1"></i> Fecha: <span class="text-brand-black">${dateStr}</span></p>
                </div>
            </div>
        `;
    }).join('');
}

// ==========================================
// LISTENER DEL BUSCADOR INTELIGENTE
// ==========================================
const serialSearchInput = document.getElementById('search-serial-input');
if (serialSearchInput) {
    serialSearchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        
        // Si borra la búsqueda, mostrar todos los cargados en memoria
        if (!val) {
            renderSerials(clientLoadedSerials);
            return;
        }

        // Filtrar en memoria RAM sin consultar a Firebase
        const filtered = clientLoadedSerials.filter(s => {
            return s.sn.toLowerCase().includes(val) || 
                   s.productName.toLowerCase().includes(val) || 
                   s.orderId.toLowerCase().includes(val);
        });

        renderSerials(filtered);
    });
}

// Exportar al window para que el botón de HTML lo detecte
window.loadMoreSerials = () => loadClientSerials(true);

init();
