import { auth, db, storage, onAuthStateChanged, doc, addDoc, collection, query, where, getDocs, ref, uploadBytes, getDownloadURL, onSnapshot } from "./firebase-init.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

if (!orderId) window.location.href = '/profile.html';

// 1. ELEMENTOS DOM
const els = {
    // Info General
    id: document.getElementById('order-id-display'),
    date: document.getElementById('order-date-display'),
    statusBadge: document.getElementById('order-status-badge'),
    
    // Timeline y Pagos
    timelineContainer: document.getElementById('timeline-container'),
    paymentContainer: document.getElementById('payment-info-container'),

    // Envío y Comprador
    address: document.getElementById('shipping-address'),
    city: document.getElementById('shipping-city'),
    guideContainer: document.getElementById('tracking-container'),
    guideText: document.getElementById('shipping-guide'),
    trackingLink: document.getElementById('tracking-link'),
    copyGuideBtn: document.getElementById('copy-guide-btn'), 
    
    buyerName: document.getElementById('buyer-name'),
    buyerContact: document.getElementById('buyer-contact'),

    // Totales
    itemsCount: document.getElementById('items-count'),
    subtotal: document.getElementById('order-subtotal'), 
    shipping: document.getElementById('order-shipping'), 
    total: document.getElementById('order-total'),
    itemsList: document.getElementById('order-items-list'),

    // Facturación
    billingContainer: document.getElementById('billing-info-container'), 
    billName: document.getElementById('bill-name'),
    billTax: document.getElementById('bill-taxid'),
    billEmail: document.getElementById('bill-email'),

    // Modal Solicitud Garantía
    warrantyModal: document.getElementById('warranty-modal'),
    warrantyForm: document.getElementById('warranty-form'),
    modalProdName: document.getElementById('modal-product-name'),
    inpSn: document.getElementById('w-sn'),
    inpReason: document.getElementById('w-reason'),
    inpImages: document.getElementById('w-images'),
    filePreview: document.getElementById('file-preview'),

    // Modal Estado Garantía
    statusModal: document.getElementById('warranty-status-modal'),
    stDate: document.getElementById('st-date'),
    stBadge: document.getElementById('st-badge'),
    stReason: document.getElementById('st-reason'),
    stAdminBox: document.getElementById('st-admin-response-box'),
    stAdminResp: document.getElementById('st-admin-response'),
    stResolvedDate: document.getElementById('st-resolved-date'),
    stId: document.getElementById('st-id'),
    stPdfBtn: document.getElementById('st-tech-report-btn')
};

let currentOrder = null;
let activeWarranties = [];
let selectedItemIndex = null;

// Controladores para limpiar listeners si el usuario se va
let unsubscribeOrder = null;
let unsubscribeWarranties = null;

// Listener para archivos
if (els.inpImages) {
    els.inpImages.onchange = () => {
        els.filePreview.textContent = els.inpImages.files.length > 0
            ? `${els.inpImages.files.length} archivo(s) seleccionado(s)`
            : "";
    };
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        initSmartRealtimeOrder();
    } else {
        if(unsubscribeOrder) unsubscribeOrder();
        if(unsubscribeWarranties) unsubscribeWarranties();
        window.location.href = "/auth/login.html";
    }
});

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE (onSnapshot)
// ==========================================================================
async function initSmartRealtimeOrder() {
    try {
        let orderFromCache = null;

        // 1. CARGA RÁPIDA (Caché Local)
        // La caché ahora está en formato { map: {...}, lastSync: ... } gracias a profile.js
        const cachedRaw = localStorage.getItem('pixeltech_user_orders');
        if (cachedRaw) {
            try {
                const parsed = JSON.parse(cachedRaw);
                if (parsed.map && parsed.map[orderId]) {
                    orderFromCache = parsed.map[orderId];
                } else if (Array.isArray(parsed)) {
                    // Fallback por si la estructura antigua sigue viva
                    orderFromCache = parsed.find(o => o.id === orderId);
                }
            } catch(e) {}
        }

        if (orderFromCache) {
            console.log("⚡ [OrderDetail] Orden cargada rápido desde caché local.");
            currentOrder = orderFromCache;
            await ensureProductsInCache(currentOrder.items);
            renderAllOrderData(currentOrder);
        } else {
            console.log("☁️ [OrderDetail] Orden no en caché, conectando a Firebase...");
            els.itemsList.innerHTML = `<p class="text-center py-10 text-gray-400"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando detalles...</p>`;
        }

        // 2. CONEXIÓN EN VIVO A LA ORDEN
        if(unsubscribeOrder) unsubscribeOrder();
        
        unsubscribeOrder = onSnapshot(doc(db, "orders", orderId), async (snap) => {
            if (!snap.exists()) {
                window.location.href = '/profile.html'; 
                return;
            }

            const freshData = { id: snap.id, ...snap.data() };
            
            // Comparamos para no repintar en vano
            if (!currentOrder || JSON.stringify(currentOrder) !== JSON.stringify(freshData)) {
                console.log("🔥 [OrderDetail] Cambio detectado en la orden. Repintando...");
                currentOrder = freshData;
                
                await ensureProductsInCache(currentOrder.items);
                renderAllOrderData(currentOrder);
                
                // Actualizar caché sigilosamente
                updateOrderInLocalCache(currentOrder);
            }
        });

        // 3. CONEXIÓN EN VIVO A LAS GARANTÍAS DE ESTA ORDEN
        listenForWarranties();

    } catch (e) {
        console.error("Error al inicializar orden:", e);
        if(els.itemsList) els.itemsList.innerHTML = `<p class="text-red-500 text-center">Error cargando la orden.</p>`;
    }
}

function listenForWarranties() {
    if(unsubscribeWarranties) unsubscribeWarranties();

    const qW = query(
        collection(db, "warranties"),
        where("orderId", "==", orderId),
        where("userId", "==", auth.currentUser.uid)
    );

    unsubscribeWarranties = onSnapshot(qW, (snapW) => {
        let hasChanges = false;
        
        if (activeWarranties.length !== snapW.docs.length) hasChanges = true;
        
        const freshWarranties = snapW.docs.map(d => ({ id: d.id, ...d.data() }));
        
        if (!hasChanges) {
            // Comparación profunda simple si la longitud es igual
            if (JSON.stringify(activeWarranties) !== JSON.stringify(freshWarranties)) {
                hasChanges = true;
            }
        }

        if (hasChanges) {
            console.log("🛠️ [OrderDetail] Actualización en vivo de Garantías.");
            activeWarranties = freshWarranties;
            if(currentOrder) renderItems(currentOrder); // Repintar botones de garantía
        }
    });
}

function updateOrderInLocalCache(orderData) {
    try {
        const STORAGE_KEY = 'pixeltech_user_orders';
        const cachedRaw = localStorage.getItem(STORAGE_KEY);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed.map) {
                // Formato nuevo
                parsed.map[orderData.id] = orderData;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            } else if (Array.isArray(parsed)) {
                // Formato viejo fallback
                const idx = parsed.findIndex(o => o.id === orderData.id);
                if (idx > -1) parsed[idx] = orderData;
                else parsed.push(orderData);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            }
        }
    } catch(e) {}
}


// --- HELPER: DESCARGAR PRODUCTOS FALTANTES PARA LA CACHÉ ---
// Reemplazado getDoc en bucle por promesa concurrente pura
async function ensureProductsInCache(items) {
    const STORAGE_KEY = 'pixeltech_master_catalog';
    let rawCache = localStorage.getItem(STORAGE_KEY);
    let catalogState = { map: {}, lastSync: 0 };

    if (rawCache) {
        try { catalogState = JSON.parse(rawCache); } catch(e) {}
    }

    const uniqueItemIds = [...new Set(items.map(item => item.id))];
    const missingIds = uniqueItemIds.filter(id => !catalogState.map[id]);

    if (missingIds.length === 0) return; // Todo en caché

    console.log(`☁️ [OrderDetail] Descargando ${missingIds.length} productos faltantes (para info de garantía)...`);

    try {
        const promises = missingIds.map(pid => getDoc(doc(db, "products", pid)));
        const snapshots = await Promise.all(promises);

        snapshots.forEach(snap => {
            if (snap.exists()) {
                const prodData = { id: snap.id, ...snap.data() };
                catalogState.map[snap.id] = prodData;
            }
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(catalogState));
    } catch(e) {
        console.error("Error bajando info de productos:", e);
    }
}

// Función Helper para renderizar todo de una vez
function renderAllOrderData(order) {
    renderHeaderInfo(orderId, order);
    renderTimeline(order.status);
    renderPaymentInfo(order);
    renderItems(order);
}

// --- 2. RENDER HEADER ---
function renderHeaderInfo(displayId, order) {
    if(!els.id) return;

    els.id.textContent = `ORDEN #${displayId.slice(0, 8).toUpperCase()}`;
    
    // Manejo de fechas seguro
    let dateObj;
    if (order.createdAt?.toDate) {
        dateObj = order.createdAt.toDate();
    } else {
        dateObj = new Date(order.createdAt);
    }
    
    els.date.textContent = "Realizado el: " + dateObj.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
    
    // BADGES ESTADO
    let statusClass = "bg-gray-100 text-gray-600 border-gray-200";
    let statusLabel = order.status;
    let icon = "";

    switch(order.status) {
        case 'PENDIENTE_PAGO': 
            statusClass = "bg-yellow-50 text-yellow-700 border-yellow-200"; 
            statusLabel = "Pendiente Pago"; 
            icon = '<i class="fa-solid fa-clock mr-1"></i>';
            break;
        case 'PAGADO': 
        case 'PENDIENTE': 
            statusClass = "bg-blue-50 text-blue-700 border-blue-200"; 
            statusLabel = "Pago Confirmado"; 
            icon = '<i class="fa-solid fa-check-double mr-1"></i>';
            break;
        case 'ALISTAMIENTO': 
            statusClass = "bg-purple-100 text-purple-700 border-purple-300 shadow-sm shadow-purple-200"; 
            statusLabel = "En Alistamiento"; 
            icon = '<i class="fa-solid fa-box-open mr-1"></i>';
            break;
        case 'EN_RUTA': 
        case 'DESPACHADO': 
            statusClass = "bg-cyan-50 text-cyan-700 border-cyan-200"; 
            statusLabel = "Despachado"; 
            icon = '<i class="fa-solid fa-truck-fast mr-1"></i>';
            break;
        case 'ENTREGADO': 
            statusClass = "bg-emerald-50 text-emerald-700 border-emerald-200"; 
            statusLabel = "Entregado"; 
            icon = '<i class="fa-solid fa-house-circle-check mr-1"></i>';
            break;
        case 'CANCELADO': 
        case 'RECHAZADO': 
            statusClass = "bg-red-50 text-red-700 border-red-200"; 
            statusLabel = "Cancelado"; 
            icon = '<i class="fa-solid fa-ban mr-1"></i>';
            break;
    }

    els.statusBadge.innerHTML = `<span class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border flex items-center gap-1 ${statusClass}">${icon} ${statusLabel}</span>`;

    // DIRECCIÓN
    const ship = order.shippingData || {};
    const buyer = order.buyerInfo || {};
    
    els.address.textContent = ship.address || buyer.address || "Dirección no disponible";
    const city = ship.city || buyer.city || "";
    const dept = ship.department || buyer.department || "";
    els.city.innerHTML = `<i class="fa-solid fa-map-pin mr-1"></i> ${city} ${dept ? ', ' + dept : ''}`;
    
    // COMPRADOR
    els.buyerName.textContent = (ship.name || buyer.name || "Cliente").toUpperCase();
    els.buyerContact.textContent = `${buyer.email || ''} ${buyer.phone ? ' • ' + buyer.phone : ''}`;

    // RASTREO / TRACKING
    const guide = order.shippingTracking || order.guideNumber;
    const carrier = order.shippingCarrier || "Desconocida";

    if (guide) {
        els.guideContainer.classList.remove('hidden');
        els.guideContainer.classList.add('flex');
        els.guideText.textContent = `${carrier} - ${guide}`;
        
        let trackingUrl = "#";
        const carrierLower = carrier.toLowerCase();

        if (carrierLower.includes('servientrega')) trackingUrl = "https://www.servientrega.com/wps/portal/rastreo-envio";
        else if (carrierLower.includes('interrapidisimo') || carrierLower.includes('interrapidísimo')) trackingUrl = "https://interrapidisimo.com/sigue-tu-envio/";
        else if (carrierLower.includes('envia') || carrierLower.includes('envía')) trackingUrl = "https://envia.co/";
        else if (carrierLower.includes('coordinadora')) trackingUrl = "https://coordinadora.com/rastreo/rastreo-de-guia/";
        else trackingUrl = `https://www.google.com/search?q=${carrier}+rastreo`;

        els.trackingLink.href = trackingUrl; 

        if (els.copyGuideBtn) {
            els.copyGuideBtn.onclick = () => {
                navigator.clipboard.writeText(guide).then(() => {
                    const originalHTML = els.copyGuideBtn.innerHTML;
                    els.copyGuideBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    els.copyGuideBtn.classList.add('text-green-500', 'bg-green-50', 'border-green-200');
                    setTimeout(() => {
                        els.copyGuideBtn.innerHTML = originalHTML;
                        els.copyGuideBtn.classList.remove('text-green-500', 'bg-green-50', 'border-green-200');
                    }, 2000);
                });
            };
        }
    } else {
        els.guideContainer.classList.add('hidden');
        els.guideContainer.classList.remove('flex');
    }

    // FACTURACIÓN
    if (els.billingContainer) {
        if (order.requiresInvoice && order.billingData) {
            els.billingContainer.classList.remove('hidden');
            els.billName.textContent = order.billingData.name || "N/A";
            els.billTax.textContent = order.billingData.taxId || "N/A";
            els.billEmail.textContent = order.billingData.email || "N/A";
        } else {
            els.billingContainer.classList.add('hidden');
        }
    }

    // TOTALES
    const itemCount = (order.items || []).reduce((acc, item) => acc + (parseInt(item.quantity) || 1), 0);
    els.itemsCount.textContent = itemCount;
    els.subtotal.textContent = `$${(order.subtotal || 0).toLocaleString('es-CO')}`;
    const shipCost = order.shippingCost || 0;
    els.shipping.textContent = shipCost === 0 ? "Gratis" : `$${shipCost.toLocaleString('es-CO')}`;
    els.total.textContent = `$${(order.total || 0).toLocaleString('es-CO')}`;
}

// --- 3. RENDER TIMELINE ---
function renderTimeline(currentStatus) {
    if(!els.timelineContainer) return;

    const steps = [
        { label: 'Pendiente Pago', icon: 'fa-file-invoice-dollar' },
        { label: 'Recibido',       icon: 'fa-clipboard-check' }, 
        { label: 'Alistado',       icon: 'fa-box-open' }, 
        { label: 'Despachado',     icon: 'fa-truck-fast' } 
    ];

    let activeIndex = 0;
    const status = (currentStatus || '').toUpperCase().trim();

    if (status === 'PENDIENTE_PAGO') activeIndex = 0; 
    else if (['PAGADO', 'PENDIENTE', 'CONFIRMADO', 'APROBADO'].includes(status)) activeIndex = 1;
    else if (['ALISTAMIENTO', 'ALISTADO', 'PREPARACION'].includes(status)) activeIndex = 2;
    else if (['DESPACHADO', 'EN_RUTA', 'EN_CAMINO', 'ENTREGADO', 'FINALIZADO'].includes(status)) activeIndex = 3;
    else if (['CANCELADO', 'RECHAZADO', 'FAILED', 'ANULADO'].includes(status)) {
        els.timelineContainer.innerHTML = `
            <div class="w-full flex flex-col items-center justify-center p-8 bg-red-50 rounded-[2rem] border border-red-100 text-red-500">
                <div class="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-3 shadow-sm animate-pulse"><i class="fa-solid fa-ban text-2xl"></i></div>
                <p class="font-black uppercase tracking-widest text-sm">Pedido Cancelado</p>
                <p class="text-xs font-bold mt-1 opacity-70">El proceso se ha detenido.</p>
            </div>`;
        return;
    }

    const progressPercent = (activeIndex / (steps.length - 1)) * 100;
    let html = `
        <div class="absolute top-5 md:top-6 left-0 w-full px-12 md:px-14 z-0 flex items-center pointer-events-none">
            <div class="w-full h-1 bg-gray-100 rounded-full overflow-hidden relative">
                <div class="h-full bg-brand-black transition-all duration-1000 ease-out shadow-sm" style="width: ${progressPercent}%"></div>
            </div>
        </div>
        <div class="relative w-full flex justify-between items-start z-10 px-2">`;

    steps.forEach((step, index) => {
        const isCompleted = index <= activeIndex;
        const isCurrent = index === activeIndex;
        
        let circleClass = "bg-white text-gray-300 border-4 border-gray-100";
        let iconClass = "";
        let textClass = "text-gray-300 font-bold";

        if (isCurrent) {
            circleClass = "bg-brand-black text-brand-cyan border-4 border-brand-cyan shadow-xl shadow-cyan-500/30 scale-110 z-20";
            iconClass = "fa-beat-fade"; 
            textClass = "text-brand-cyan font-black transform scale-105";
        } else if (isCompleted) {
            circleClass = "bg-brand-black text-white border-4 border-brand-black shadow-lg";
            textClass = "text-brand-black font-black";
        }

        html += `
            <div class="flex flex-col items-center group w-24">
                <div class="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all duration-500 ${circleClass} relative z-10">
                    <i class="fa-solid ${step.icon} text-xs md:text-sm ${iconClass}"></i>
                </div>
                <p class="text-[8px] md:text-[9px] uppercase tracking-widest mt-3 text-center transition-all duration-300 ${textClass} leading-tight">${step.label}</p>
            </div>`;
    });

    html += '</div>';
    els.timelineContainer.innerHTML = html;
    els.timelineContainer.className = "relative w-full min-w-[320px] max-w-4xl mx-auto py-4"; 
}

// --- 4. RENDER PAGO (MEJORADO CON INSTRUCCIONES DINÁMICAS) ---
function renderPaymentInfo(order) {
    if(!els.paymentContainer) return;

    const payment = order.paymentData || {};
    const rawMethod = (order.paymentMethod || payment.payment_method_id || payment.type || "UNKNOWN").toUpperCase();
    
    let icon = "fa-credit-card"; let label = "Tarjeta / Electrónico"; let iconColor = "text-brand-cyan"; let bgIcon = "bg-brand-cyan/10";

    // 1. Identificamos el método de pago
    if (rawMethod.includes('COD') || rawMethod.includes('CONTRA') || rawMethod.includes('EFECTIVO')) { 
        icon = "fa-truck-fast"; label = "Pago Contra Entrega"; iconColor = "text-brand-black"; bgIcon = "bg-gray-100"; 
    } 
    else if (rawMethod.includes('ADDI')) { 
        icon = "fa-hand-holding-dollar"; label = "Crédito ADDI"; iconColor = "text-[#00D6D6]"; bgIcon = "bg-[#00D6D6]/10"; 
    }
    // 🔥 NUEVO: Agregamos el color oficial de Sistecrédito
    else if (rawMethod.includes('SISTECREDITO')) { 
        icon = "fa-wallet"; label = "Sistecrédito"; iconColor = "text-[#00B34A]"; bgIcon = "bg-green-50"; 
    }
    else if (rawMethod.includes('NEQUI')) { icon = "fa-mobile-screen-button"; label = "Nequi"; iconColor = "text-purple-600"; bgIcon = "bg-purple-50"; }
    else if (rawMethod.includes('PSE')) { icon = "fa-building-columns"; label = "PSE (Transferencia)"; iconColor = "text-blue-600"; bgIcon = "bg-blue-50"; }
    else if (rawMethod.includes('BANCOLOMBIA')) { icon = "fa-building-columns"; label = "Bancolombia"; iconColor = "text-yellow-600"; bgIcon = "bg-yellow-50"; }
    else if (rawMethod.includes('MANUAL') || rawMethod.includes('TIENDA')) { 
        icon = "fa-building-columns"; label = "Transferencia Manual"; iconColor = "text-gray-600"; bgIcon = "bg-gray-100"; 
    }

    let statusBadgeHTML = "";
    let extraInfoHTML = ""; // 🔥 NUEVO: Caja de instrucciones para el cliente

    // 2. Evaluamos el estado y mostramos instrucciones si está pendiente
    if (order.status === 'CANCELADO' || order.status === 'RECHAZADO') {
        statusBadgeHTML = `<p class="text-xs font-bold text-red-500 uppercase flex items-center gap-1 bg-red-50 px-3 py-1.5 rounded-lg w-fit mt-1"><i class="fa-solid fa-ban"></i> Anulado</p>`;
    }
    else if (order.paymentStatus === 'PENDING' || order.status === 'PENDIENTE_PAGO') {
        statusBadgeHTML = `<p class="text-xs font-bold text-yellow-600 uppercase flex items-center gap-1 bg-yellow-50 px-3 py-1.5 rounded-lg w-fit mt-1"><i class="fa-solid fa-clock"></i> Pendiente</p>`;
        
        // 💡 INSTRUCCIÓN PARA TRANSFERENCIA MANUAL
        if (rawMethod.includes('MANUAL') || rawMethod.includes('TIENDA')) {
            extraInfoHTML = `
                <div class="w-full mt-6 bg-slate-50 p-5 rounded-2xl border border-gray-200 animate-in">
                    <p class="text-[10px] font-black uppercase tracking-widest text-brand-black mb-2 flex items-center"><i class="fa-solid fa-circle-exclamation text-yellow-500 mr-2 text-sm"></i> Acción Requerida</p>
                    <p class="text-xs text-gray-600 mb-4 leading-relaxed">Para comenzar a preparar tu pedido, realiza la transferencia por <strong>$${(order.total || 0).toLocaleString('es-CO')}</strong> y envía el comprobante a nuestro equipo de WhatsApp.</p>
                    <a href="https://wa.me/573009046450?text=Hola,%20adjunto%20el%20comprobante%20de%20pago%20de%20mi%20orden%20%23${order.id.slice(0,8).toUpperCase()}" target="_blank" class="inline-flex items-center gap-2 bg-green-500 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-green-600 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                        <i class="fa-brands fa-whatsapp text-base"></i> Enviar Comprobante
                    </a>
                </div>
            `;
        } 
        // 💡 INSTRUCCIÓN PARA CONTRA ENTREGA
        else if (rawMethod.includes('COD') || rawMethod.includes('CONTRA')) {
            extraInfoHTML = `
                <div class="w-full mt-6 bg-slate-50 p-5 rounded-2xl border border-gray-200 animate-in">
                    <p class="text-[10px] font-black uppercase tracking-widest text-brand-black mb-2 flex items-center"><i class="fa-solid fa-money-bill-wave text-emerald-500 mr-2 text-sm"></i> Prepara tu efectivo</p>
                    <p class="text-xs text-gray-600 leading-relaxed">Tu pedido está siendo procesado. Recuerda tener <strong>$${(order.total || 0).toLocaleString('es-CO')}</strong> exactos listos para cuando el repartidor llegue a tu domicilio.</p>
                </div>
            `;
        }
    }
    else {
        statusBadgeHTML = `<p class="text-xs font-bold text-emerald-600 uppercase flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-lg w-fit mt-1"><i class="fa-solid fa-check-circle"></i> Pago Confirmado</p>`;
    }

    // 3. Renderizamos todo el bloque HTML
    els.paymentContainer.innerHTML = `
        <div class="w-full flex flex-col">
            <div class="flex flex-col md:flex-row gap-6 md:gap-10">
                <div class="flex items-center gap-4 flex-1">
                    <div class="w-14 h-14 rounded-2xl ${bgIcon} ${iconColor} flex items-center justify-center text-xl shrink-0 shadow-sm border border-transparent"><i class="fa-solid ${icon}"></i></div>
                    <div><p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Método de Pago</p><p class="text-sm font-bold text-brand-black uppercase mt-0.5">${label}</p></div>
                </div>
                <div class="w-px bg-gray-100 hidden md:block"></div>
                <div class="flex-1 flex items-center gap-4 md:pl-4">
                    <div class="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-gray-300 shrink-0 border border-slate-100"><i class="fa-solid fa-money-bill-wave"></i></div>
                    <div><p class="text-[9px] font-black text-gray-400 uppercase tracking-widest">Estado Transacción</p>${statusBadgeHTML}</div>
                </div>
            </div>
            ${extraInfoHTML}
        </div>`;
}

// --- HELPER: CALCULAR DÍAS DE GARANTÍA ---
function getWarrantyDaysInTotal(item) {
    let w = item.warranty || item.warrantyDays;

    if (w === undefined || w === null) {
        try {
            const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
            if (cachedRaw) {
                const catalog = JSON.parse(cachedRaw).map || {};
                const cachedProduct = catalog[item.id];
                if (cachedProduct) {
                    const cachedW = cachedProduct.warranty !== undefined ? cachedProduct.warranty : cachedProduct.warrantyDays;
                    if (cachedW !== undefined && cachedW !== null) {
                        w = cachedW;
                    }
                }
            }
        } catch (e) { }
    }

    if (w === undefined || w === null) return 60;

    if (typeof w === 'object' && w.time !== undefined) {
        const time = parseInt(w.time);
        if (isNaN(time)) return 60;
        if (time === 0) return 0; 

        const unit = (w.unit || 'months').toLowerCase();
        if (unit.includes('year') || unit.includes('año')) return time * 365;
        if (unit.includes('month') || unit.includes('mes')) return time * 30;
        if (unit.includes('week') || unit.includes('semana')) return time * 7;
        return time; 
    }

    const directTime = parseInt(w);
    if (!isNaN(directTime)) return directTime;

    return 60; 
}


// --- 5. RENDER ITEMS ---
function renderItems(order) {
    if(!els.itemsList) return;
    els.itemsList.innerHTML = "";
    
    const warrantyActiveStatuses = ['DESPACHADO', 'EN_RUTA', 'EN_CAMINO', 'ENTREGADO'];
    const isShipped = warrantyActiveStatuses.includes(order.status);

    let shippedDate = null;
    const parseDate = (val) => {
        if (!val) return null;
        if (val.toDate) return val.toDate();
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    };

    if (isShipped) {
        shippedDate = parseDate(order.shippedAt) || parseDate(order.updatedAt) || parseDate(order.createdAt) || new Date();
    }
    
    const now = new Date();

    order.items.forEach((item, index) => {
        const totalWarrantyDays = getWarrantyDaysInTotal(item);
        
        let isExpired = false;
        let daysLeft = 0;
        const hasWarranty = totalWarrantyDays > 0; 

        if (isShipped && shippedDate && hasWarranty) {
            const expirationDate = new Date(shippedDate);
            expirationDate.setDate(expirationDate.getDate() + totalWarrantyDays);
            const diffTime = expirationDate - now;
            daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            isExpired = daysLeft <= 0;
        } else if (!hasWarranty) {
            isExpired = true;
        }

        const itemWarranties = activeWarranties.filter(w => 
            w.productId === item.id && 
            w.variantColor === (item.color || null) && 
            w.variantCapacity === (item.capacity || null)
        );

        const canCreateNew = isShipped && !isExpired && hasWarranty && (itemWarranties.length < (item.quantity || 1));

        let timeBadgeHTML = "";
        
        if (!hasWarranty) {
            timeBadgeHTML = `<span class="text-[9px] font-bold text-gray-400 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded flex items-center gap-1 w-fit"><i class="fa-solid fa-ban"></i> Sin garantía comercial</span>`;
        } else if (!isShipped) {
            timeBadgeHTML = `<span class="text-[9px] font-bold text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded flex items-center gap-1 w-fit"><i class="fa-regular fa-clock"></i> Garantía inicia al despachar</span>`;
        } else if (isExpired) {
            timeBadgeHTML = `<span class="text-[9px] font-bold text-red-400 bg-red-50 border border-red-100 px-2 py-0.5 rounded flex items-center gap-1 w-fit"><i class="fa-solid fa-calendar-xmark"></i> Garantía Finalizada</span>`;
        } else {
            timeBadgeHTML = `<span class="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded flex items-center gap-1 w-fit"><i class="fa-solid fa-shield-halved"></i> Garantía Activa (${daysLeft} días)</span>`;
        }

        let createBtnHTML = "";
        if (canCreateNew) {
            createBtnHTML = `<button onclick="window.openWarrantyModal(${index})" class="group flex items-center gap-2 bg-white border border-gray-200 hover:border-brand-black hover:text-brand-black text-gray-500 px-4 py-2 rounded-xl font-bold text-[9px] uppercase transition-all shadow-sm"><i class="fa-solid fa-triangle-exclamation"></i> Reportar Problema</button>`;
        }

        let existingCasesHTML = "";
        if (itemWarranties.length > 0) {
            existingCasesHTML = `<div class="flex flex-wrap gap-2 mt-2 w-full sm:justify-end">`;
            itemWarranties.forEach((w, i) => {
                let colorClass = "bg-blue-50 text-blue-600 border-blue-100";
                let icon = "fa-spinner fa-spin-pulse";
                let label = "Revisión";
                if (w.status === 'APROBADO') { colorClass = "bg-green-50 text-green-600 border-green-100"; icon = "fa-check"; label = "Aprobado"; }
                if (w.status === 'RECHAZADO') { colorClass = "bg-red-50 text-red-600 border-red-100"; icon = "fa-xmark"; label = "Rechazado"; }
                if (w.status === 'FINALIZADO') { colorClass = "bg-gray-100 text-gray-600 border-gray-200"; icon = "fa-archive"; label = "Cerrado"; }
                existingCasesHTML += `<button onclick="window.openStatusModal('${w.id}')" class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[8px] font-black uppercase transition hover:opacity-80 ${colorClass}"><i class="fa-solid ${icon}"></i><span>Caso #${i + 1}: ${label}</span></button>`;
            });
            existingCasesHTML += `</div>`;
        }

        const div = document.createElement('div');
        div.className = "flex flex-col sm:flex-row gap-5 p-4 border border-gray-100 rounded-2xl hover:bg-slate-50 transition-colors duration-300 group";
        const imgUrl = item.mainImage || item.image || item.pictureUrl || 'https://via.placeholder.com/100?text=No+Img';

        div.innerHTML = `
            <div class="w-20 h-20 bg-white rounded-xl border border-gray-100 p-2 flex items-center justify-center shrink-0 self-start"><img src="${imgUrl}" class="max-w-full max-h-full object-contain group-hover:scale-105 transition duration-500"></div>
            <div class="flex-grow min-w-0">
                <div class="flex flex-col sm:flex-row justify-between items-start mb-2">
                    <div>
                        <h4 class="font-black text-xs md:text-sm uppercase text-brand-black leading-tight mb-2">${item.name}</h4>
                        <div class="flex flex-wrap gap-2 mb-2">
                            ${item.color ? `<span class="text-[8px] font-bold uppercase bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-500">${item.color}</span>` : ''}
                            ${item.capacity ? `<span class="text-[8px] font-bold uppercase bg-cyan-50 border border-cyan-100 px-2 py-0.5 rounded text-brand-cyan">${item.capacity}</span>` : ''}
                            <span class="text-[8px] font-bold uppercase bg-gray-100 px-2 py-0.5 rounded text-gray-600">Cant: ${item.quantity || 1}</span>
                        </div>
                        ${timeBadgeHTML}
                    </div>
                    <div class="text-right shrink-0 mt-2 sm:mt-0">
                        <p class="font-black text-brand-black text-base">$${(item.price * (item.quantity || 1)).toLocaleString('es-CO')}</p>
                        <p class="text-[9px] text-gray-400">Unit: $${item.price.toLocaleString('es-CO')}</p>
                    </div>
                </div>
                <div class="mt-3 flex flex-wrap justify-end gap-2">${createBtnHTML}${existingCasesHTML}</div>
            </div>`;
        els.itemsList.appendChild(div);
    });
}

// --- MODALES Y LÓGICA DE GARANTÍA ---
window.openWarrantyModal = (index) => {
    selectedItemIndex = index;
    const item = currentOrder.items[index];
    els.modalProdName.textContent = `${item.name} (${item.color || ''} ${item.capacity || ''})`;
    els.inpSn.value = ""; els.inpReason.value = ""; els.inpImages.value = ""; els.filePreview.textContent = "";
    els.warrantyModal.classList.remove('hidden'); els.warrantyModal.classList.add('flex');
};
window.closeWarrantyModal = () => { els.warrantyModal.classList.add('hidden'); els.warrantyModal.classList.remove('flex'); };

window.openStatusModal = (warrantyId) => {
    const claim = activeWarranties.find(w => w.id === warrantyId);
    if (!claim) return;
    els.stId.textContent = claim.id.slice(0,8).toUpperCase();
    els.stDate.textContent = "Radicado: " + (claim.createdAt?.toDate ? claim.createdAt.toDate().toLocaleDateString('es-CO') : new Date(claim.createdAt).toLocaleDateString('es-CO'));
    els.stReason.textContent = `"${claim.reason}"`;
    
    let badgeClass = "bg-blue-100 text-blue-700"; let badgeText = "En Revisión";
    if (claim.status === 'APROBADO') { badgeClass = "bg-green-100 text-green-700"; badgeText = "Aprobada"; }
    else if (claim.status === 'RECHAZADO') { badgeClass = "bg-red-100 text-red-700"; badgeText = "Rechazada"; }
    else if (claim.status === 'FINALIZADO') { badgeClass = "bg-gray-100 text-gray-700"; badgeText = "Cerrado"; }
    
    els.stBadge.className = `inline-block px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest mb-2 ${badgeClass}`;
    els.stBadge.textContent = badgeText;
    
    if (claim.adminResponse) {
        els.stAdminBox.classList.remove('hidden');
        els.stAdminResp.textContent = claim.adminResponse;
        if (claim.technicalReportUrl && els.stPdfBtn) { els.stPdfBtn.href = claim.technicalReportUrl; els.stPdfBtn.classList.remove('hidden'); els.stPdfBtn.classList.add('flex'); }
        else if (els.stPdfBtn) { els.stPdfBtn.classList.add('hidden'); els.stPdfBtn.classList.remove('flex'); }
        
        els.stResolvedDate.textContent = claim.resolvedAt ? "Fecha: " + (claim.resolvedAt?.toDate ? claim.resolvedAt.toDate().toLocaleString() : new Date(claim.resolvedAt).toLocaleString()) : "";
    } else { 
        els.stAdminBox.classList.add('hidden'); 
    }
    
    els.statusModal.classList.remove('hidden'); els.statusModal.classList.add('flex');
};

els.warrantyForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = els.warrantyForm.querySelector('button');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando...';

    const snInput = els.inpSn.value.trim().toUpperCase(); 
    const reason = els.inpReason.value.trim();
    const item = currentOrder.items[selectedItemIndex];
    const imageFiles = els.inpImages.files;

    try {
        if (item.sns && Array.isArray(item.sns) && item.sns.length > 0) {
            const snFound = item.sns.some(validSn => validSn.trim().toUpperCase() === snInput);
            if (!snFound) {
                throw new Error(`⛔ El Serial "${snInput}" no corresponde a este despacho. Verifica la etiqueta o caja del producto.`);
            }
        }

        const qDup = query(
            collection(db, "warranties"), 
            where("userId", "==", auth.currentUser.uid), 
            where("snProvided", "==", snInput),
            where("productId", "==", item.id)
        );
        
        if (snInput.length > 3 && snInput !== "N/A") {
            const dupSnap = await getDocs(qDup);
            const activeDup = dupSnap.docs.find(d => {
                const s = d.data().status;
                return s !== 'RECHAZADO' && s !== 'FINALIZADO';
            });
            if (activeDup) throw new Error("⛔ Ya existe una solicitud activa para este serial.");
        }

        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Subiendo evidencia...';
        const evidenceUrls = [];
        if (imageFiles.length > 0) {
            for (const file of imageFiles) {
                const storageRef = ref(storage, `warranties/${orderId}/${Date.now()}_${file.name}`);
                await uploadBytes(storageRef, file);
                const url = await getDownloadURL(storageRef);
                evidenceUrls.push(url);
            }
        }

        await addDoc(collection(db, "warranties"), {
            orderId: orderId, 
            userId: auth.currentUser.uid, 
            userEmail: auth.currentUser.email, 
            userName: auth.currentUser.displayName || "Cliente",
            productId: item.id || 'unknown', 
            productName: item.name, 
            productImage: item.mainImage || item.image || '',
            variantColor: item.color || null, 
            variantCapacity: item.capacity || null,
            snProvided: snInput || "NO REGISTRADO", 
            reason: reason, 
            evidenceImages: evidenceUrls,
            status: 'PENDIENTE_REVISION', 
            createdAt: new Date(), 
            shippedAtDate: currentOrder.shippedAt ? (currentOrder.shippedAt.toDate ? currentOrder.shippedAt.toDate() : new Date(currentOrder.shippedAt)) : new Date()
        });

        // NOTA: No hace falta location.reload(), el onSnapshot de garantías lo actualizará al instante
        alert("✅ Solicitud enviada exitosamente.");
        window.closeWarrantyModal(); 

    } catch (err) { 
        console.error("Error garantía:", err); 
        alert(err.message); 
    } finally { 
        btn.disabled = false; 
        btn.textContent = originalText; 
    }
};