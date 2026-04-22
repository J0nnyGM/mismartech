import { db, doc, getDoc, updateDoc, Timestamp, collection, getDocs, runTransaction, serverTimestamp, writeBatch } from './firebase-init.js';
import { adjustStock } from './inventory-core.js'; 

// --- CACHÉ DE OPTIMIZACIÓN ---
let currentOrderData = null; 
let currentOrderId = null;
let accountsCache = null;    

const getEl = (id) => document.getElementById(id);
const safeSetText = (id, text) => { const el = getEl(id); if (el) el.textContent = text; };

// Helper para cargar cuentas
async function loadAccountsCached() {
    if (accountsCache) return accountsCache;
    try {
        const snap = await getDocs(collection(db, "accounts"));
        accountsCache = [];
        snap.forEach(doc => accountsCache.push({ id: doc.id, ...doc.data() }));
        return accountsCache;
    } catch (e) {
        console.error("Error cache cuentas:", e);
        return [];
    }
}

// --- 1. VER DETALLE (Optimizado) ---
export async function viewOrderDetail(orderId) {
    currentOrderId = orderId;
    currentOrderData = null; 
    const modal = getEl('order-modal');
    
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if (!snap.exists()) return;
        const o = snap.data();
        
        currentOrderData = { id: snap.id, ...o };

        // 1. Icono Canal
        const isWeb = o.source === 'TIENDA' || o.source === 'TIENDA_WEB';
        const iconContainer = getEl('modal-source-icon');
        if (iconContainer) {
            iconContainer.innerHTML = isWeb ? '<i class="fa-solid fa-globe"></i>' : '<i class="fa-solid fa-store"></i>';
            iconContainer.className = `w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-gray-100 ${isWeb ? 'text-brand-cyan' : 'text-brand-black'}`;
        }

        // 2. Datos Cabecera
        safeSetText('modal-order-id', `#${snap.id.slice(0, 8).toUpperCase()}`);
        safeSetText('modal-order-date', o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('es-CO') : '---');

        // 3. Estado Logístico (Badge)
        const badge = getEl('modal-order-status-badge');
        if (badge) {
            badge.textContent = o.status || 'PENDIENTE';
            let bClass = 'bg-yellow-100 text-yellow-700 border-yellow-200';
            if (o.status === 'ALISTADO') bClass = 'bg-blue-100 text-blue-700 border-blue-200';
            if (o.status === 'DESPACHADO') bClass = 'bg-slate-800 text-white border-slate-900';
            if (o.status === 'PAGADO') bClass = 'bg-green-100 text-green-700 border-green-200'; 
            if (o.status === 'DEVOLUCION_PARCIAL') bClass = 'bg-orange-100 text-orange-700 border-orange-200';
            if (o.status === 'DEVUELTO') bClass = 'bg-purple-100 text-purple-700 border-purple-200';
            badge.className = `px-3 py-1 rounded-full text-[10px] font-black uppercase border ${bClass}`;
        }

        // --- INFORMACIÓN DE PAGO ---
        const paymentSection = getEl('modal-payment-info');
        if (paymentSection) {
            const methods = {
                'MERCADOPAGO': { label: 'MercadoPago', icon: 'fa-regular fa-credit-card', color: 'text-blue-500' },
                'ONLINE': { label: 'MercadoPago', icon: 'fa-regular fa-credit-card', color: 'text-blue-500' }, 
                'CONTRAENTREGA': { label: 'Contra Entrega', icon: 'fa-solid fa-truck-fast', color: 'text-brand-black' },
                'COD': { label: 'Contra Entrega', icon: 'fa-solid fa-truck-fast', color: 'text-brand-black' }, 
                'ADDI': { label: 'Crédito ADDI', icon: 'fa-solid fa-hand-holding-dollar', color: 'text-[#00D6D6]' },
                'SISTECREDITO': { label: 'Sistecrédito', icon: 'fa-solid fa-money-check-dollar', color: 'text-emerald-500' },
                'PSE': { label: 'Pago con PSE', icon: 'fa-solid fa-building-columns', color: 'text-blue-600' },
                'MANUAL': { label: 'Venta Manual', icon: 'fa-solid fa-cash-register', color: 'text-gray-500' }
            };
            
            const methodKey = (o.paymentMethod || 'MANUAL').toUpperCase();
            const mInfo = methods[methodKey] || methods['MANUAL'];

            const isPaid = o.paymentStatus === 'PAID' || o.status === 'PAGADO'; 
            const statusHtml = isPaid 
                ? `<span class="px-2 py-1 rounded bg-green-50 text-green-600 border border-green-100 text-[9px] font-black uppercase"><i class="fa-solid fa-check"></i> Pagado</span>`
                : `<span class="px-2 py-1 rounded bg-orange-50 text-orange-600 border border-orange-100 text-[9px] font-black uppercase"><i class="fa-regular fa-clock"></i> Pendiente</span>`;

            const refHtml = o.paymentId 
                ? `<div class="mt-2 pt-2 border-t border-gray-100 text-[9px] text-gray-400 font-mono">Ref: ${o.paymentId}</div>` 
                : '';

            paymentSection.innerHTML = `
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center ${mInfo.color} text-lg">
                            <i class="${mInfo.icon}"></i>
                        </div>
                        <div>
                            <p class="text-[10px] font-black uppercase text-gray-400 leading-none mb-1">Método de Pago</p>
                            <p class="text-xs font-black text-brand-black uppercase">${mInfo.label}</p>
                        </div>
                    </div>
                    ${statusHtml}
                </div>
                ${refHtml}
            `;
            paymentSection.classList.remove('hidden');
        }

        // 4. Datos Cliente
        safeSetText('modal-client-name', o.userName || 'Cliente');
        safeSetText('modal-client-doc', o.clientDoc || '---');
        safeSetText('modal-client-contact', o.phone || o.userEmail || '');

        // 5. Dirección, Notas y RASTREO
        const addr = o.shippingData?.address || o.address || 'Retiro en Tienda / Local';
        const city = o.shippingData?.city || o.city || 'Bogotá';
        const dept = o.shippingData?.department || "";
        safeSetText('modal-delivery-address', addr);
        safeSetText('modal-delivery-city', `${city}${dept ? ', ' + dept : ''}`);

        const trackingContainer = getEl('modal-tracking-info');
        if (trackingContainer) {
            if (o.shippingCarrier && o.shippingTracking) {
                safeSetText('modal-carrier', o.shippingCarrier);
                safeSetText('modal-tracking-number', o.shippingTracking);
                trackingContainer.classList.remove('hidden');
            } else {
                trackingContainer.classList.add('hidden');
            }
        }

        const notesEl = getEl('modal-order-notes');
        if(notesEl) {
            if (o.notes || o.shippingData?.notes) { 
                getEl('note-text').textContent = o.notes || o.shippingData.notes; 
                notesEl.classList.remove('hidden'); 
            } else { 
                notesEl.classList.add('hidden'); 
            }
        }

        // 6. Facturación
        const billingSec = getEl('modal-billing-section');
        if (billingSec) {
            const bill = o.billingInfo || o.billingData;
            if (o.requiresInvoice && bill) {
                billingSec.classList.remove('hidden');
                safeSetText('bill-modal-name', bill.name);
                safeSetText('bill-modal-id', bill.taxId);
                safeSetText('bill-modal-email', bill.email);
            } else {
                billingSec.classList.add('hidden');
            }
        }

        // 7. Items (CON VALIDACIÓN DE SERIALES)
        const isLocked = ['DESPACHADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO', 'DEVUELTO', 'DEVOLUCION_PARCIAL'].includes(o.status);
        const itemsList = getEl('modal-items-list-responsive');
        
        if (itemsList) {
            itemsList.innerHTML = (o.items || []).map((item, idx) => {
                const img = item.mainImage || item.image || '/img/placeholder-tech.webp';
                let snInputs = '';
                for (let i = 0; i < (item.quantity || 1); i++) {
                    const val = (item.sns && item.sns[i]) ? item.sns[i] : '';
                    const lockClass = isLocked 
                        ? 'bg-gray-100 text-gray-500 cursor-not-allowed border-gray-200' 
                        : 'bg-white text-brand-black border-gray-200 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/20';
                    
                    snInputs += `
                    <div class="relative mb-2">
                        <i class="fa-solid fa-barcode absolute left-3 top-3 text-brand-black text-xs"></i>
                        <input type="text" 
                               placeholder="${isLocked ? (val || 'No registrado') : 'Escanea Serial'}" 
                               value="${val}" 
                               data-item-index="${idx}" 
                               data-unit-index="${i}" 
                               class="sn-input w-full rounded-xl py-2 pl-8 pr-3 text-xs font-mono font-bold outline-none transition-all uppercase border ${lockClass}" 
                               ${isLocked ? 'readonly' : ''}>
                    </div>`;
                }
                return `<div class="p-6 border-b border-gray-100 last:border-0 flex flex-col md:flex-row gap-6 items-start"><div class="w-16 h-16 rounded-xl bg-white border border-gray-100 p-2 shrink-0 flex items-center justify-center"><img src="${img}" class="max-w-full max-h-full object-contain"></div><div class="flex-grow w-full"><div class="flex justify-between mb-2"><h5 class="font-black text-xs uppercase text-brand-black">${item.name || item.title}</h5><span class="text-xs font-black text-brand-cyan">x${item.quantity}</span></div><div class="flex gap-2 mb-4">${item.color ? `<span class="text-[8px] font-black uppercase bg-slate-100 px-2 py-1 rounded text-brand-black border border-gray-200">${item.color}</span>` : ''}</div><div class="bg-slate-100/50 p-3 rounded-xl border border-dashed border-gray-200"><p class="text-[8px] font-black text-brand-black uppercase tracking-widest mb-2">Seriales</p><div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${snInputs}</div></div></div></div>`;
            }).join('');

            if (!isLocked) {
                setTimeout(() => {
                    const allInputs = Array.from(document.querySelectorAll('.sn-input'));
                    
                    allInputs.forEach((input, currentIndex) => {
                        input.addEventListener('change', function(e) {
                            const val = this.value.trim().toUpperCase();
                            if (!val) return; 

                            const isDuplicate = allInputs.some(otherInput => {
                                return otherInput !== this && otherInput.value.trim().toUpperCase() === val;
                            });

                            if (isDuplicate) {
                                alert(`⚠️ ERROR: El serial "${val}" ya fue escaneado en esta orden. Por favor revisa.`);
                                this.value = ""; 
                                this.focus();    
                                this.classList.add('border-red-500', 'bg-red-50');
                                setTimeout(() => this.classList.remove('border-red-500', 'bg-red-50'), 2000);
                            }
                        });

                        input.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter') {
                                e.preventDefault(); 
                                this.dispatchEvent(new Event('change'));

                                if (this.value.trim() !== "") {
                                    const nextInput = allInputs[currentIndex + 1];
                                    if (nextInput) {
                                        nextInput.focus(); 
                                    } else {
                                        const btnSave = getEl('btn-save-alistado');
                                        if(btnSave && !btnSave.classList.contains('hidden')) {
                                            btnSave.focus();
                                        }
                                    }
                                }
                            }
                        });
                    });
                }, 100); 
            }
        }

        // 8. Totales 
        const subtotal = o.subtotal || o.total;
        const shipping = o.shippingCost || 0;
        const totalOriginal = o.total || 0;
        const refunded = o.refundedAmount || 0;
        const netTotal = totalOriginal - refunded;

        safeSetText('modal-order-subtotal', `$${subtotal.toLocaleString('es-CO')}`);
        safeSetText('modal-order-shipping', shipping === 0 ? "GRATIS" : `$${shipping.toLocaleString('es-CO')}`);
        
        const totalContainer = getEl('modal-total-container');
        
        if (totalContainer) {
            if (refunded > 0) {
                totalContainer.innerHTML = `
                    <div class="flex flex-col items-end">
                        <p class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Original</p>
                        <p class="text-xs font-bold text-gray-400 line-through decoration-red-300">$${totalOriginal.toLocaleString('es-CO')}</p>
                        
                        <p class="text-[9px] font-black text-red-500 uppercase tracking-widest mt-1">Devolución</p>
                        <p class="text-xs font-bold text-red-500">-$${refunded.toLocaleString('es-CO')}</p>
                        
                        <div class="w-full h-px bg-gray-200 my-2"></div>
                        
                        <p class="text-[9px] font-black text-brand-black uppercase tracking-widest">Total Neto</p>
                        <h4 class="text-3xl font-black text-brand-black leading-none">$${netTotal.toLocaleString('es-CO')}</h4>
                    </div>
                `;
            } else {
                totalContainer.innerHTML = `
                    <p class="text-[9px] font-black text-brand-black uppercase tracking-widest">Total Neto</p>
                    <h4 id="modal-order-total" class="text-3xl font-black text-brand-black leading-none">$${totalOriginal.toLocaleString('es-CO')}</h4>
                `;
            }
        }

        // 9. Lógica de Botones 
        const footerActions = getEl('modal-footer-actions');
        const footerMsg = getEl('modal-footer-msg');
        
        const oldRefundBtn = document.getElementById('btn-refund-action');
        if(oldRefundBtn) oldRefundBtn.remove();

        if (footerActions) footerActions.classList.add('hidden');
        if (footerMsg) footerMsg.classList.add('hidden');
        
        const btnAlistar = getEl('btn-save-alistado');
        const btnDespachar = getEl('btn-set-despachado');
        if(btnAlistar) btnAlistar.classList.add('hidden');
        if(btnDespachar) btnDespachar.classList.add('hidden');

        if (o.status === 'PENDIENTE_PAGO') {
            if (footerMsg) { footerMsg.innerHTML = '<span class="text-orange-500 font-bold flex items-center gap-2"><i class="fa-solid fa-clock"></i> Esperando pago...</span>'; footerMsg.classList.remove('hidden'); }
        } else if (['RECHAZADO', 'CANCELADO', 'DEVUELTO'].includes(o.status)) {
            if (footerMsg) { footerMsg.innerHTML = `<span class="text-red-500 font-bold flex items-center gap-2"><i class="fa-solid fa-ban"></i> Pedido ${o.status}</span>`; footerMsg.classList.remove('hidden'); }
        } else if (o.status === 'ALISTADO') {
            if (footerActions) footerActions.classList.remove('hidden');
            if (btnDespachar) btnDespachar.classList.remove('hidden');
        } else if (['DESPACHADO', 'ENTREGADO', 'DEVOLUCION_PARCIAL'].includes(o.status)) { 
             if (footerActions) {
                 footerActions.classList.remove('hidden');
                 
                 const btnRefund = document.createElement('button');
                 btnRefund.id = 'btn-refund-action';
                 btnRefund.className = "flex-1 md:flex-none bg-white text-red-500 border border-red-200 px-6 py-4 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-red-50 transition-all shadow-sm flex items-center gap-2";
                 btnRefund.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Gestionar Devolución`;
                 btnRefund.onclick = () => openRefundModal(currentOrderData);
                 footerActions.prepend(btnRefund);
             }
        } else {
            if (footerActions) footerActions.classList.remove('hidden');
            if (btnAlistar) btnAlistar.classList.remove('hidden');
        }

        modal.classList.remove('hidden');

    } catch (e) { console.error(e); }
}

// --- 2. ACCIONES (ALISTAR / DESPACHAR) ---
export async function saveAlistamiento(onSuccess) {
    if (!currentOrderId) return;
    const btn = getEl('btn-save-alistado');
    btn.disabled = true; btn.innerHTML = "Guardando...";
    try {
        const snap = await getDoc(doc(db, "orders", currentOrderId));
        const items = snap.data().items;
        const updatedItems = items.map((item, idx) => {
            const inputs = document.querySelectorAll(`.sn-input[data-item-index="${idx}"]`);
            return { ...item, sns: Array.from(inputs).map(i => i.value.trim()) };
        });
        // 🔥 Trigger al Store (updatedAt)
        await updateDoc(doc(db, "orders", currentOrderId), { items: updatedItems, status: 'ALISTADO', updatedAt: new Date() });
        alert("✅ Orden Alistada");
        getEl('order-modal').classList.add('hidden');
        if(onSuccess) onSuccess();
    } catch(e) { console.error(e); } finally { btn.disabled = false; btn.innerHTML = "Guardar Alistamiento"; }
}

export function openDispatchModal() { getEl('dispatch-modal').classList.remove('hidden'); }

export async function confirmDispatch(onSuccess) {
    if (!currentOrderId) return;
    const btn = getEl('btn-confirm-dispatch');
    const carrier = getEl('dispatch-carrier').value;
    const tracking = getEl('dispatch-tracking').value;
    
    if (!carrier || !tracking) return alert("⚠️ Faltan datos de envío");
    
    btn.disabled = true;
    try {
        // 🔥 Trigger al Store (updatedAt)
        await updateDoc(doc(db, "orders", currentOrderId), { 
            status: 'DESPACHADO', shippingCarrier: carrier, shippingTracking: tracking, shippedAt: new Date(), updatedAt: new Date() 
        });
        alert("🚚 Despachado");
        getEl('dispatch-modal').classList.add('hidden');
        getEl('order-modal').classList.add('hidden');
        if(onSuccess) onSuccess();
    } catch(e) { console.error(e); } finally { btn.disabled = false; }
}

// --- 3. IMPRIMIR PDF (REMISIÓN PROFESIONAL) ---
export async function printRemission(orderId) {
    try {
        const snap = await getDoc(doc(db, "orders", orderId));
        if (!snap.exists()) return alert("Error al generar la remisión");
        
        const o = snap.data();
        
        const dateStr = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('es-CO') : '--';
        const remissionNumber = o.internalOrderNumber ? `#${o.internalOrderNumber}` : 'S/N';
        const shortId = snap.id.slice(0, 8).toUpperCase();
        
        let address = o.shippingData?.address || o.address || 'Retiro en Local';
        if (o.shippingData?.city) address += `, ${o.shippingData.city}`;
        if (o.shippingData?.department) address += ` - ${o.shippingData.department}`;

        const clientName = o.userName || o.buyerInfo?.name || 'N/A';
        const clientPhone = o.phone || o.buyerInfo?.phone || 'N/A';
        const clientDoc = o.clientDoc || o.buyerInfo?.document || 'N/A';

        const itemsHtml = (o.items || []).map(i => {
            let variantText = '';
            if(i.color || i.capacity) {
                variantText = `<br><span style="color:#6b7280; font-size:11px;">${i.capacity ? i.capacity + ' ' : ''}${i.color ? i.color : ''}</span>`;
            }
            
            return `
            <tr>
                <td><strong>${i.name || i.title}</strong>${variantText}</td>
                <td style="text-align:center">${i.quantity}</td>
                <td style="text-align:right">$${(i.price || 0).toLocaleString('es-CO')}</td>
                <td style="text-align:right; font-weight:bold;">$${((i.price || 0) * i.quantity).toLocaleString('es-CO')}</td>
            </tr>`;
        }).join('');

        const total = o.total || 0;
        const shipping = o.shippingCost || 0;
        const subtotal = total - shipping;

        const w = window.open('', '_blank', 'width=800,height=800');
        w.document.write(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Remisión ${remissionNumber}</title>
                <style>
                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; font-size: 13px; color: #111827; max-width: 800px; margin: 0 auto; }
                    h1, h2, h3, h4 { color: #111827; margin: 0 0 5px 0; line-height: 1.2; }
                    
                    /* Cabecera */
                    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 2px solid #111827; padding-bottom: 20px; }
                    .store-info h1 { font-size: 28px; font-weight: 900; letter-spacing: -1px; margin-bottom: 2px; }
                    .store-info p { margin: 0; color: #4b5563; font-size: 12px; }
                    
                    .remission-info { text-align: right; }
                    .remission-info h2 { font-size: 22px; font-weight: 900; letter-spacing: 2px; }
                    .remission-info .consecutivo { font-size: 18px; font-weight: 900; color: #00AEC7; margin-bottom: 5px; display: block;}
                    .remission-info p { margin: 2px 0; font-size: 12px; color: #4b5563; }
                    .badge { display: inline-block; background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-family: monospace; margin-top: 5px; font-weight: bold; font-size: 11px;}
                    
                    .section-title { font-size: 10px; font-weight: 900; color: #9ca3af; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px;}
                    
                    /* Información Cliente */
                    .customer-info { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; background: #f9fafb; padding: 20px; border-radius: 12px; }
                    .customer-box p { margin: 0; font-size: 13px; font-weight: bold;}
                    .customer-box label { font-size: 9px; font-weight: 900; color: #9ca3af; text-transform: uppercase; display: block; margin-bottom: 2px; letter-spacing: 0.5px;}

                    /* Tabla de Productos */
                    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                    th { text-align: left; background: #f9fafb; padding: 12px; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
                    td { padding: 15px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
                    
                    /* Totales */
                    .totals-container { display: flex; justify-content: flex-end; margin-bottom: 40px; }
                    .totals-table { width: 300px; border-collapse: collapse; }
                    .totals-table td { padding: 10px; border-bottom: 1px solid #f3f4f6; }
                    .totals-table tr:last-child td { border-bottom: none; font-size: 16px; font-weight: 900; border-top: 2px solid #111827; }
                    .totals-table td:last-child { text-align: right; font-weight: bold; color: #111827; }
                    .totals-table td:first-child { text-align: left; color: #6b7280; font-weight: bold; }

                    /* Pie de página */
                    .footer { margin-top: 50px; text-align: center; color: #4b5563; font-size: 11px; border-top: 1px solid #e5e7eb; padding-top: 20px; line-height: 1.6; }
                    .footer strong { color: #111827; font-size: 12px;}
                    
                    /* Evitar cortes */
                    @media print {
                        body { padding: 0; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; page-break-after: auto; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="store-info">
                        <h1>PIXELTECH</h1>
                        <p>Lo mejor en tecnología</p>
                        <p>Bogotá, Colombia</p>
                    </div>
                    <div class="remission-info">
                        <h2>REMISIÓN</h2>
                        <span class="consecutivo">${remissionNumber}</span>
                        <p>${dateStr}</p>
                        <div class="badge">Pedido ID: ${shortId}</div>
                    </div>
                </div>

                <div class="section-title">Información del Cliente</div>
                <div class="customer-info">
                    <div class="customer-box">
                        <label>Cliente</label>
                        <p>${clientName}</p>
                    </div>
                    <div class="customer-box">
                        <label>Teléfono</label>
                        <p>${clientPhone}</p>
                    </div>
                    <div class="customer-box">
                        <label>Identificación</label>
                        <p>${clientDoc}</p>
                    </div>
                    <div class="customer-box">
                        <label>Dirección de Entrega</label>
                        <p>${address}</p>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Descripción</th>
                            <th style="text-align:center">Cant</th>
                            <th style="text-align:right">Unitario</th>
                            <th style="text-align:right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>

                <div class="totals-container">
                    <table class="totals-table">
                        <tr>
                            <td>Subtotal</td>
                            <td>$${subtotal.toLocaleString('es-CO')}</td>
                        </tr>
                        <tr>
                            <td>Envío</td>
                            <td>$${shipping.toLocaleString('es-CO')}</td>
                        </tr>
                        <tr>
                            <td>TOTAL</td>
                            <td>$${total.toLocaleString('es-CO')}</td>
                        </tr>
                    </table>
                </div>

                <div class="footer">
                    Este documento es una remisión de entrega y soporte de garantía.<br>
                    <strong>Para solicitud de factura con código CUFE contáctanos al 3009046450</strong>
                </div>

                <script>setTimeout(() => { window.print(); window.close(); }, 800);</script>
            </body>
            </html>
        `);
        w.document.close();
    } catch(e) { console.error(e); }
}

// --- 4. SOLICITAR FACTURA ---
export async function requestInvoice(orderId) {
    if(!confirm("¿Marcar este pedido para Facturación Electrónica?")) return;
    
    try {
        // 🔥 Trigger al Store (updatedAt)
        await updateDoc(doc(db, "orders", orderId), { 
            requiresInvoice: true,
            billingStatus: 'PENDING', 
            updatedAt: new Date()
        });

        alert("✅ Solicitud enviada al Módulo de Facturación.");
        location.reload();

    } catch (e) {
        console.error(e);
        alert("Error al actualizar: " + e.message);
    }
}

// --- 5. EXPORTAR AL WINDOW ---
window.viewOrderDetail = viewOrderDetail;
window.printRemission = printRemission;
window.requestInvoice = requestInvoice;
window.saveAlistamiento = saveAlistamiento; 
window.openDispatchModal = openDispatchModal;
window.confirmDispatch = confirmDispatch;

// --- 6. REGISTRAR PAGO MANUAL ---
export async function openPaymentModal(orderId, amountDue) {
    const modal = getEl('payment-modal');
    const idDisplay = getEl('pay-modal-order-id');
    const inputId = getEl('pay-target-id');
    const inputAmount = getEl('pay-amount');
    const selectAcc = getEl('pay-account-select');

    if(!modal) return console.error("No modal");

    idDisplay.textContent = `Orden #${orderId.slice(0,8).toUpperCase()}`;
    inputId.value = orderId;
    
    inputAmount.value = `$${Number(amountDue).toLocaleString('es-CO')}`;
    inputAmount.dataset.max = amountDue;
    
    try {
        if (selectAcc.options.length <= 1) { 
            selectAcc.innerHTML = '<option value="">Cargando...</option>';
            const accounts = await loadAccountsCached();
            
            let ops = '<option value="">Seleccione Cuenta...</option>';
            accounts.forEach(acc => {
                ops += `<option value="${acc.id}">${acc.name} (${acc.type})</option>`;
            });
            selectAcc.innerHTML = ops;
        }
    } catch (e) {
        console.error("Error cuentas:", e);
        selectAcc.innerHTML = '<option value="">Error al cargar</option>';
    }

    modal.classList.remove('hidden');
    
    inputAmount.oninput = (e) => {
        let val = e.target.value.replace(/\D/g, "");
        e.target.value = val ? "$" + parseInt(val, 10).toLocaleString('es-CO') : "";
    };
}

// =============================================================================
// LÓGICA DEVOLUCIONES (OPTIMIZADA)
// =============================================================================

async function openRefundModal(orderInput) {
    if (!orderInput) return;

    let o = orderInput;
    if (typeof orderInput === 'string') {
        if (currentOrderData && currentOrderData.id === orderInput) {
            o = currentOrderData; 
        } else {
            const snap = await getDoc(doc(db, "orders", orderInput)); 
            if (!snap.exists()) return;
            o = { id: snap.id, ...snap.data() };
            currentOrderData = o; 
        }
    }

    const modal = getEl('refund-modal');
    const idDisplay = getEl('refund-modal-order-id');
    const inputId = getEl('refund-target-id');
    const wasPaidInput = getEl('refund-was-paid');
    const container = getEl('refund-items-container');
    const inputAmount = getEl('refund-amount');
    const selectAcc = getEl('refund-account-select');
    const financialSection = getEl('refund-financial-section');
    const noPaymentMsg = getEl('refund-no-payment-msg');

    idDisplay.textContent = `Orden #${o.id.slice(0,8).toUpperCase()}`;
    inputId.value = o.id;
    inputAmount.value = "$ 0";
    container.innerHTML = '<div class="text-center py-4"><i class="fa-solid fa-circle-notch fa-spin text-gray-300"></i></div>';
    
    try {
        const totalPaid = o.total || 0;
        const alreadyRefunded = o.refundedAmount || 0;
        const moneyAvailable = totalPaid - alreadyRefunded;

        const isPaid = (o.paymentStatus === 'PAID') || (o.status === 'PAGADO') || ((o.amountPaid || 0) >= totalPaid);
        
        wasPaidInput.value = isPaid ? "true" : "false";

        if (isPaid) {
            financialSection.classList.remove('hidden');
            noPaymentMsg.classList.add('hidden');
            
            const existingInfo = financialSection.querySelector('.info-badge');
            if(existingInfo) existingInfo.remove();
            
            const infoDiv = document.createElement('div');
            infoDiv.className = "info-badge mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-[10px] text-blue-800 flex justify-between";
            infoDiv.innerHTML = `
                <span><strong>Total:</strong> $${totalPaid.toLocaleString()}</span>
                <span><strong>Devuelto:</strong> $${alreadyRefunded.toLocaleString()}</span>
                <span class="font-black text-brand-cyan"><strong>Disponible:</strong> $${moneyAvailable.toLocaleString()}</span>
            `;
            financialSection.prepend(infoDiv);

            if (selectAcc.options.length <= 1) {
                const accounts = await loadAccountsCached();
                let html = '<option value="">Seleccione Cuenta de Origen...</option>';
                accounts.forEach(acc => {
                    html += `<option value="${acc.id}">${acc.name} (Saldo: $${(acc.balance || 0).toLocaleString()})</option>`;
                });
                selectAcc.innerHTML = html;
            }
        } else {
            financialSection.classList.add('hidden');
            noPaymentMsg.classList.remove('hidden');
        }

        const items = o.items || [];
        container.innerHTML = "";
        
        let hasItemsToReturn = false;

        items.forEach((item, index) => {
            const img = item.mainImage || item.image || '[https://placehold.co/50](https://placehold.co/50)';
            
            const originalQty = item.quantity || 0;
            const alreadyReturnedQty = item.returnedQty || 0; 
            const availableQty = originalQty - alreadyReturnedQty;

            if (availableQty <= 0) return; 

            hasItemsToReturn = true;
            
            const div = document.createElement('div');
            div.className = "refund-item-row flex items-center gap-4 p-3 border border-gray-100 rounded-xl hover:bg-slate-50 transition bg-white";
            div.innerHTML = `
                <div class="flex items-center h-full">
                    <input type="checkbox" class="refund-check w-5 h-5 text-red-500 rounded border-gray-300 focus:ring-red-500 cursor-pointer" data-index="${index}">
                </div>
                <img src="${img}" class="w-10 h-10 rounded-lg object-contain bg-gray-50 border border-gray-200">
                <div class="flex-grow min-w-0">
                    <p class="text-[10px] font-black text-brand-black uppercase truncate">${item.name}</p>
                    <p class="text-[9px] text-gray-400 font-bold">$${(item.price || 0).toLocaleString()} c/u</p>
                    ${alreadyReturnedQty > 0 ? `<p class="text-[8px] text-orange-500 font-bold">Devueltos antes: ${alreadyReturnedQty}</p>` : ''}
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-[8px] font-bold text-gray-400 uppercase">Cant.</span>
                    <input type="number" min="1" max="${availableQty}" value="${availableQty}" class="refund-qty w-12 p-2 text-center text-xs font-bold border border-gray-200 rounded-lg outline-none focus:border-red-500" disabled>
                </div>
            `;
            container.appendChild(div);

            const checkbox = div.querySelector('.refund-check');
            const qtyInput = div.querySelector('.refund-qty');

            checkbox.addEventListener('change', () => {
                qtyInput.disabled = !checkbox.checked;
                div.classList.toggle('border-red-200', checkbox.checked);
                div.classList.toggle('bg-red-50/30', checkbox.checked);
                if (isPaid) recalcRefundTotal(items);
            });

            qtyInput.addEventListener('input', () => { if(isPaid) recalcRefundTotal(items); });
        });

        if (!hasItemsToReturn) {
            container.innerHTML = '<div class="text-center p-4 bg-green-50 rounded-xl text-green-700 text-xs font-bold border border-green-100"><i class="fa-solid fa-check-circle"></i> Todos los productos de esta orden ya han sido devueltos.</div>';
        }

    } catch (e) { console.error(e); }

    modal.classList.remove('hidden');
}

function recalcRefundTotal(items) {
    let total = 0;
    document.querySelectorAll('.refund-item-row').forEach(row => {
        const checkbox = row.querySelector('.refund-check');
        if (checkbox.checked) {
            const index = checkbox.dataset.index;
            const qty = parseInt(row.querySelector('.refund-qty').value) || 0;
            const price = items[index].price || 0;
            total += (price * qty);
        }
    });
    const input = getEl('refund-amount');
    input.value = `$ ${total.toLocaleString('es-CO')}`;
}

const refundForm = getEl('refund-form');
if (refundForm) {
    refundForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = refundForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;
        btn.disabled = true; 
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const orderId = getEl('refund-target-id').value;
        const wasPaid = getEl('refund-was-paid').value === "true";
        const reason = getEl('refund-reason').value || "Devolución Cliente";
        
        let accountId = null;
        let amount = 0;

        if (wasPaid) {
            accountId = getEl('refund-account-select').value;
            const amountStr = getEl('refund-amount').value.replace(/[^0-9]/g, "");
            amount = parseInt(amountStr) || 0;

            if (!accountId && amount > 0) {
                alert("Selecciona una cuenta de origen.");
                btn.disabled = false; btn.innerHTML = originalText;
                return;
            }
        }

        try {
            let itemsToRestoreStock = [];

            await runTransaction(db, async (t) => {
                const orderRef = doc(db, "orders", orderId);
                const orderDoc = await t.get(orderRef);
                if(!orderDoc.exists()) throw "Orden no encontrada";
                
                const oData = orderDoc.data();
                
                if (wasPaid && amount > 0) {
                    const currentRefunded = oData.refundedAmount || 0;
                    const maxRefundable = (oData.total || 0) - currentRefunded;
                    if (amount > maxRefundable) throw `El monto excede el saldo disponible ($${maxRefundable.toLocaleString()}).`;
                }

                const originalItems = oData.items || [];
                const updatedItems = JSON.parse(JSON.stringify(originalItems)); 
                
                let totalOriginalQty = 0;
                let totalReturnedQtySoFar = 0;

                const rows = document.querySelectorAll('.refund-item-row');
                rows.forEach(row => {
                    const check = row.querySelector('.refund-check');
                    if (check.checked) {
                        const idx = parseInt(check.dataset.index);
                        const qtyToReturn = parseInt(row.querySelector('.refund-qty').value);
                        
                        if (qtyToReturn > 0) {
                            const currentReturned = updatedItems[idx].returnedQty || 0;
                            updatedItems[idx].returnedQty = currentReturned + qtyToReturn;
                            
                            itemsToRestoreStock.push({ 
                                id: updatedItems[idx].id, 
                                qty: qtyToReturn, 
                                color: updatedItems[idx].color, 
                                capacity: updatedItems[idx].capacity 
                            });
                        }
                    }
                });

                updatedItems.forEach(i => {
                    totalOriginalQty += (i.quantity || 0);
                    totalReturnedQtySoFar += (i.returnedQty || 0);
                });

                let newStatus = oData.status;
                if (totalReturnedQtySoFar > 0) {
                    if (totalReturnedQtySoFar >= totalOriginalQty) newStatus = 'DEVUELTO';
                    else newStatus = 'DEVOLUCION_PARCIAL';
                }

                if (wasPaid && amount > 0) {
                    const accRef = doc(db, "accounts", accountId);
                    const accDoc = await t.get(accRef);
                    if (!accDoc.exists()) throw "Cuenta no existe";
                    const currentBalance = accDoc.data().balance || 0;
                    if (currentBalance < amount) throw "Saldo insuficiente en cuenta";

                    t.update(accRef, { balance: currentBalance - amount });

                    const expenseRef = doc(collection(db, "expenses"));
                    t.set(expenseRef, {
                        amount: amount,
                        category: "Devoluciones",
                        description: `Reembolso ${newStatus === 'DEVUELTO' ? 'Total' : 'Parcial'} Orden #${orderId.slice(0,8)}`,
                        paymentMethod: accDoc.data().name,
                        supplierName: oData.userName || "Cliente",
                        date: serverTimestamp(),
                        createdAt: serverTimestamp(),
                        type: 'EXPENSE',
                        orderId: orderId,
                        isRefund: true
                    });
                }

                // 🔥 Trigger al Store (updatedAt)
                t.update(orderRef, {
                    items: updatedItems,
                    status: newStatus,
                    refundedAmount: (oData.refundedAmount || 0) + amount,
                    hasRefunds: true,
                    lastRefundDate: serverTimestamp(),
                    refundReason: reason,
                    updatedAt: serverTimestamp() 
                });
            });

            if (itemsToRestoreStock.length > 0) {
                for (const item of itemsToRestoreStock) {
                    await adjustStock(item.id, item.qty, item.color, item.capacity);
                }
            }

            alert("✅ Devolución procesada correctamente.");
            
            currentOrderData = null; 
            accountsCache = null;

            getEl('refund-modal').classList.add('hidden');
            getEl('order-modal').classList.add('hidden');
            
            // Si la vista local tiene función fetchOrders (Como dashboard.js), usarla. Si no, reload.
            // OJO: Como ahora tenemos AdminStore, ni siquiera hace falta recargar, el Store repintará solo.

        } catch (e) {
            console.error(e);
            alert("Error: " + (e.message || e));
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };
}

const payForm = document.getElementById('payment-form');
if (payForm) {
    payForm.onsubmit = async (e) => {
        e.preventDefault();
        const btn = payForm.querySelector('button');
        const originalText = btn.innerHTML;
        btn.disabled = true; 
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const orderId = document.getElementById('pay-target-id').value;
        const accId = document.getElementById('pay-account-select').value;
        const amountStr = document.getElementById('pay-amount').value.replace(/\D/g, "");
        const amount = parseInt(amountStr, 10);
        
        const maxAmount = parseInt(document.getElementById('pay-amount').dataset.max || 0);

        if (!accId || amount <= 0) {
            alert("Verifica la cuenta y el monto.");
            btn.disabled = false; btn.innerHTML = originalText;
            return;
        }

        if (amount > maxAmount) {
            alert(`El monto excede el saldo pendiente ($${maxAmount.toLocaleString()}).`);
            btn.disabled = false; btn.innerHTML = originalText;
            return;
        }

        try {
            await runTransaction(db, async (t) => {
                const orderRef = doc(db, "orders", orderId);
                const orderDoc = await t.get(orderRef);
                if (!orderDoc.exists()) throw "La orden no existe.";
                const oData = orderDoc.data();

                const currentPending = (oData.total || 0) - (oData.amountPaid || 0) - (oData.refundedAmount || 0);
                if (amount > currentPending) throw `El monto excede el saldo real pendiente ($${currentPending.toLocaleString()}).`;

                const accRef = doc(db, "accounts", accId);
                const accDoc = await t.get(accRef);
                if (!accDoc.exists()) throw "La cuenta no existe.";

                const newBalance = (accDoc.data().balance || 0) + amount;
                t.update(accRef, { balance: newBalance });

                const expenseRef = doc(collection(db, "expenses"));
                t.set(expenseRef, {
                    amount: amount,
                    category: "Ingreso Ventas Manual",
                    description: `Cobro Orden #${orderId.slice(0,8)}`,
                    paymentMethod: accDoc.data().name,
                    supplierName: oData.userName || "Cliente",
                    date: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    type: 'INCOME',
                    orderId: orderId
                });

                const newAmountPaid = (oData.amountPaid || 0) + amount;
                const isFullyPaid = newAmountPaid >= ((oData.total || 0) - (oData.refundedAmount || 0));
                
                let nextStatus = oData.status; 
                if (isFullyPaid && ['PENDIENTE', 'PENDIENTE_PAGO', 'CANCELADO'].includes(oData.status)) {
                    nextStatus = 'PAGADO';
                }

                // 🔥 Trigger al Store (updatedAt)
                t.update(orderRef, {
                    status: nextStatus,
                    paymentStatus: isFullyPaid ? 'PAID' : 'PARTIAL',
                    amountPaid: newAmountPaid, 
                    paymentMethod: oData.paymentMethod || 'MANUAL', 
                    paymentAccountId: accId,
                    paymentDate: serverTimestamp(),
                    updatedAt: serverTimestamp() 
                });
            });

            alert("✅ Pago registrado exitosamente.");
            document.getElementById('payment-modal').classList.add('hidden');
            
            currentOrderData = null; 
            accountsCache = null;

        } catch (error) {
            console.error(error);
            alert("Error: " + (error.message || error));
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    };
}

// --- 6. GENERAR RÓTULOS DE ENVÍO ---
export function generateLabels(ordersArray) {
    const w = window.open('', '_blank', 'width=900,height=800');
    
    const chunkArray = (arr, size) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    };

    const pagesOfOrders = chunkArray(ordersArray, 4);

    const allPagesHtml = pagesOfOrders.map(pageGroup => {
        const labelsHtml = pageGroup.map(o => {
            const clientName = o.shippingData?.name || o.buyerInfo?.name || o.userName || '';
            const clientDoc = o.shippingData?.clientDoc || o.clientDoc || o.buyerInfo?.document || '';
            const clientPhone = o.shippingData?.phone || o.phone || o.buyerInfo?.phone || '';
            
            let address = o.shippingData?.address || o.address || '';
            let city = o.shippingData?.city || o.city || '';
            let dept = o.shippingData?.department || '';

            return `
            <div class="label-box">
                <div class="header-logo">
                    <img src="https://pixeltechcol.com/img/logo.webp" alt="PixelTech">
                </div>
                <div class="company-info">
                    <div>
                        PIXEL TECH COL SAS<br>
                        NIT: 901.561.037-7<br>
                        CL. 31 #13A-51 OFICINA 223<br>
                        PIXELTECHSAS@GMAIL.COM
                    </div>
                    <div style="text-align: right;">
                        (PIXELTECH.COL)<br>
                        TEL: 300 904 6450<br>
                        BOGOTÁ
                    </div>
                </div>
                
                <h3 class="dest-title">DESTINATARIO</h3>
                
                <div class="dest-info">
                    <div class="info-line">
                        <strong>NOMBRE:</strong> <span>${clientName.toUpperCase()}</span>
                    </div>
                    
                    <div class="info-row">
                        <div class="info-line" style="width: 55%;">
                            <strong>CC/NIT:</strong> <span>${clientDoc}</span>
                        </div>
                        <div class="info-line" style="width: 45%;">
                            <strong>TEL:</strong> <span>${clientPhone}</span>
                        </div>
                    </div>
                    
                    <div class="info-line">
                        <strong>DIRECCIÓN:</strong> <span>${address.toUpperCase()}</span>
                    </div>
                    
                    <div class="info-line">
                        <strong>CIUDAD:</strong> <span>${city.toUpperCase()} ${dept ? '- ' + dept.toUpperCase() : ''}</span>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        return `<div class="print-page">${labelsHtml}</div>`;
        
    }).join(''); 

    w.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Impresión de Rótulos</title>
            <style>
                @page {
                    size: letter;
                    margin: 8mm; 
                }
                
                body { 
                    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
                    margin: 0; 
                    padding: 0; 
                    background: white; 
                }
                
                .print-page {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr); 
                    grid-template-rows: repeat(2, 1fr);    
                    gap: 8mm; 
                    width: 100%;
                    height: 255mm; 
                    box-sizing: border-box;
                    page-break-after: always; 
                }

                .print-page:last-child {
                    page-break-after: auto; 
                }
                
                .label-box { 
                    border: 3px solid #111827; 
                    border-radius: 16px; 
                    padding: 25px; 
                    box-sizing: border-box; 
                    color: #111827;
                    display: flex;
                    flex-direction: column;
                    justify-content: flex-start; 
                    overflow: hidden; 
                }
                
                .header-logo { text-align: center; margin-bottom: 25px; }
                .header-logo img { height: 60px; object-fit: contain; }
                
                .company-info { 
                    display: flex; 
                    justify-content: space-between; 
                    font-size: 11px; 
                    font-weight: 900; 
                    margin-bottom: 35px; 
                    line-height: 1.5;
                }
                
                .dest-title { 
                    font-size: 18px; 
                    font-weight: 900; 
                    margin: 0 0 15px 0; 
                }
                
                .dest-info { font-size: 14px; line-height: 1.6; }
                .info-line { 
                    margin-bottom: 12px; 
                    border-bottom: 2px solid #111827; 
                    display: flex; 
                    align-items: flex-end;
                    padding-bottom: 3px;
                }
                .info-line strong { font-weight: 900; margin-right: 8px; font-size: 13px;}
                .info-line span { flex-grow: 1; font-weight: 700; font-size: 13px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .info-row { display: flex; gap: 15px; }
            </style>
        </head>
        <body>
            ${allPagesHtml}
            <script>
                setTimeout(() => { window.print(); window.close(); }, 800);
            <\/script>
        </body>
        </html>
    `);
    w.document.close();
}

// =============================================================================
// 7. LÓGICA DE ACCIONES MASIVAS
// =============================================================================

let currentBulkOrdersToPay = []; 
let currentBulkOrdersToDispatch = [];
let currentBulkOrdersToPack = [];

// --- A. ALISTAMIENTO MASIVO ---
export async function openBulkPackingModal() {
    const checkboxes = document.querySelectorAll('.order-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ Selecciona al menos un pedido de la tabla.");

    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    currentBulkOrdersToPack = [];
    let omittedCount = 0;

    const cachedOrders = window.adminOrdersCache || [];

    for (const id of selectedIds) {
        const o = cachedOrders.find(order => order.id === id);
        if (o) {
            if (['ALISTADO', 'DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'CANCELADO', 'RECHAZADO', 'DEVUELTO', 'DEVOLUCION_PARCIAL'].includes(o.status)) {
                omittedCount++;
                continue;
            }
            currentBulkOrdersToPack.push(o);
        }
    }

    getEl('bulk-packing-modal').classList.remove('hidden');
    const btnConfirm = getEl('btn-confirm-bulk-pack');

    getEl('bulk-pack-valid').textContent = currentBulkOrdersToPack.length;

    const warningEl = getEl('bulk-pack-warning');
    if (omittedCount > 0) {
        warningEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Se omitieron ${omittedCount} pedidos porque ya estaban alistados, despachados o cancelados.`;
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }

    if (currentBulkOrdersToPack.length === 0) {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = "No hay pedidos válidos";
        return; 
    }

    btnConfirm.disabled = false;
    btnConfirm.innerHTML = '<i class="fa-solid fa-box-open"></i> Confirmar Alistamiento Masivo';
}

export async function processBulkPacking() {
    const btn = getEl('btn-confirm-bulk-pack');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

    try {
        let batch = writeBatch(db); 
        let opsCount = 0;

        for (const order of currentBulkOrdersToPack) {
            const oRef = doc(db, "orders", order.id);
            // 🔥 Trigger al Store
            batch.update(oRef, {
                status: 'ALISTADO',
                updatedAt: serverTimestamp()
            });
            opsCount++;

            if (opsCount >= 450) {
                await batch.commit();
                batch = writeBatch(db); 
                opsCount = 0;
            }
        }

        if (opsCount > 0) await batch.commit();

        alert(`✅ ${currentBulkOrdersToPack.length} pedidos marcados como ALISTADOS.`);
        getEl('bulk-packing-modal').classList.add('hidden');
        document.querySelectorAll('.order-cb').forEach(cb => cb.checked = false);

    } catch (e) {
        console.error(e);
        alert("Error alistando: " + (e.message || e));
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}

// --- B. COBRO MASIVO ---
export async function openBulkPaymentModal() {
    const checkboxes = document.querySelectorAll('.order-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ Selecciona al menos un pedido.");
    
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    currentBulkOrdersToPay = [];
    let totalToCollect = 0;
    let omittedCount = 0;

    const cachedOrders = window.adminOrdersCache || [];

    for (const id of selectedIds) {
        const o = cachedOrders.find(order => order.id === id);
        if (o) {
            const total = Number(o.total) || 0;
            const paid = Number(o.amountPaid) || 0;
            const refunded = Number(o.refundedAmount) || 0;
            let pending = total - paid - refunded;
            
            if (pending > 0 && !['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) {
                currentBulkOrdersToPay.push({ pendingAmt: pending, ...o });
                totalToCollect += pending;
            } else {
                omittedCount++;
            }
        }
    }

    getEl('bulk-payment-modal').classList.remove('hidden');

    const warningEl = getEl('bulk-pay-warning');
    if (omittedCount > 0) {
        warningEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Se omitieron ${omittedCount} pedidos porque ya están 100% pagados o fueron cancelados.`;
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }

    if (currentBulkOrdersToPay.length === 0) {
        getEl('bulk-pay-total').textContent = "$0";
        getEl('btn-confirm-bulk-pay').disabled = true;
        return alert("❌ Ninguno de los pedidos seleccionados tiene saldo pendiente por cobrar.");
    }

    getEl('bulk-pay-count').textContent = currentBulkOrdersToPay.length;
    getEl('bulk-pay-total').textContent = `$${totalToCollect.toLocaleString('es-CO')}`;
    
    const selectAcc = getEl('bulk-pay-account-select');
    const accounts = await loadAccountsCached();
    let ops = '<option value="">Seleccione Cuenta...</option>';
    accounts.forEach(acc => {
        ops += `<option value="${acc.id}">${acc.name} (${acc.type})</option>`;
    });
    selectAcc.innerHTML = ops;
    
    getEl('btn-confirm-bulk-pay').disabled = false;
}

export async function processBulkPayment() {
    const accId = getEl('bulk-pay-account-select').value;
    if (!accId) return alert("⚠️ Debes seleccionar una cuenta de destino.");

    const btn = getEl('btn-confirm-bulk-pay');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando Transacción...';

    try {
        await runTransaction(db, async (t) => {
            const accRef = doc(db, "accounts", accId);
            const accDoc = await t.get(accRef);
            if (!accDoc.exists()) throw "La cuenta seleccionada no existe.";
            
            const orderRefs = currentBulkOrdersToPay.map(o => doc(db, "orders", o.id));
            const oSnaps = await Promise.all(orderRefs.map(ref => t.get(ref)));

            const orderDocsToUpdate = [];
            let totalAmountCollected = 0;

            oSnaps.forEach((oSnap) => {
                if(oSnap.exists()) {
                    const oData = oSnap.data();
                    const pending = (oData.total || 0) - (oData.amountPaid || 0) - (oData.refundedAmount || 0);
                    if (pending > 0) {
                        orderDocsToUpdate.push({ ref: oSnap.ref, data: oData, payAmt: pending });
                        totalAmountCollected += pending;
                    }
                }
            });

            if (totalAmountCollected <= 0) throw "No hay saldos por cobrar confirmados por el servidor.";

            const newBalance = (accDoc.data().balance || 0) + totalAmountCollected;
            t.update(accRef, { balance: newBalance });

            for (const o of orderDocsToUpdate) {
                const newAmountPaid = (o.data.amountPaid || 0) + o.payAmt;
                
                let nextStatus = o.data.status; 
                if (['PENDIENTE', 'PENDIENTE_PAGO'].includes(o.data.status)) {
                    nextStatus = 'PAGADO';
                }

                // 🔥 Trigger al Store (updatedAt)
                t.update(o.ref, {
                    status: nextStatus,
                    paymentStatus: 'PAID',
                    amountPaid: newAmountPaid, 
                    paymentMethod: o.data.paymentMethod || 'MANUAL', 
                    paymentAccountId: accId,
                    paymentDate: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                const expenseRef = doc(collection(db, "expenses"));
                t.set(expenseRef, {
                    amount: o.payAmt,
                    category: "Ingreso Ventas Manual (Masivo)",
                    description: `Cobro Masivo Orden #${o.ref.id.slice(0,8)}`,
                    paymentMethod: accDoc.data().name,
                    supplierName: o.data.userName || "Cliente",
                    date: serverTimestamp(),
                    createdAt: serverTimestamp(),
                    type: 'INCOME',
                    orderId: o.ref.id
                });
            }
        });

        alert("✅ Cobro masivo registrado exitosamente.");
        getEl('bulk-payment-modal').classList.add('hidden');
        document.querySelectorAll('.order-cb').forEach(cb => cb.checked = false);

    } catch (e) {
        console.error(e);
        alert("Error procesando cobros: " + (e.message || e));
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}

// --- C. DESPACHO MASIVO ---
export async function openBulkDispatchModal() {
    const checkboxes = document.querySelectorAll('.order-cb:checked');
    if(checkboxes.length === 0) return alert("⚠️ Selecciona al menos un pedido.");

    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    currentBulkOrdersToDispatch = [];
    let omittedCount = 0;

    const listContainer = getEl('bulk-dispatch-list');
    getEl('bulk-dispatch-modal').classList.remove('hidden');

    const cachedOrders = window.adminOrdersCache || [];
    let htmlList = '';

    for (const id of selectedIds) {
        const o = cachedOrders.find(order => order.id === id);
        if (o) {
            if (['DESPACHADO', 'ENTREGADO', 'CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) {
                omittedCount++;
                continue; 
            }

            currentBulkOrdersToDispatch.push(o);
            
            const clientName = o.buyerInfo?.name || o.userName || 'Cliente';
            const orderNum = o.internalOrderNumber ? `#${o.internalOrderNumber}` : o.id.slice(0,6);
            
            htmlList += `
            <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-3 bg-slate-50 border border-gray-100 rounded-xl mb-2">
                <div>
                    <p class="font-black text-xs text-brand-black">${orderNum} - ${clientName.toUpperCase()}</p>
                    <p class="text-[9px] font-bold text-gray-400">${o.shippingData?.city || 'Ciudad no definida'}</p>
                </div>
                <input type="text" id="bulk-track-${o.id}" placeholder="Escanear/Escribir Guía" class="w-full md:w-48 bg-white border border-gray-200 text-xs font-mono font-bold p-2 rounded-lg outline-none focus:border-blue-500">
            </div>
            `;
        }
    }

    const warningEl = getEl('bulk-disp-warning');
    if (omittedCount > 0) {
        warningEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Se omitieron ${omittedCount} pedidos porque ya fueron despachados, entregados o cancelados.`;
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }

    if (currentBulkOrdersToDispatch.length === 0) {
        listContainer.innerHTML = `<p class="text-center text-red-500 font-bold py-4">❌ Ninguno de los pedidos seleccionados es válido para despachar.</p>`;
        getEl('btn-confirm-bulk-dispatch').disabled = true;
        return;
    }

    getEl('btn-confirm-bulk-dispatch').disabled = false;
    getEl('bulk-disp-count').textContent = currentBulkOrdersToDispatch.length;
    listContainer.innerHTML = htmlList;
}

export async function processBulkDispatch() {
    const carrier = getEl('bulk-dispatch-carrier').value;
    if (!carrier) return alert("⚠️ Por favor, selecciona una Transportadora Global.");

    const updatesToApply = [];
    for (const order of currentBulkOrdersToDispatch) {
        const trackInput = getEl(`bulk-track-${order.id}`);
        const trackingNum = trackInput ? trackInput.value.trim() : "";
        
        if (!trackingNum) {
            return alert(`⚠️ Te falta asignar el número de guía para la orden ${order.internalOrderNumber || order.id.slice(0,6)}.`);
        }
        
        updatesToApply.push({ id: order.id, tracking: trackingNum });
    }

    const btn = getEl('btn-confirm-bulk-dispatch');
    const originalText = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Despachando...';

    try {
        let batch = writeBatch(db); 
        let opsCount = 0;

        for (const update of updatesToApply) {
            const oRef = doc(db, "orders", update.id);
            // 🔥 Trigger al Store
            batch.update(oRef, {
                status: 'DESPACHADO', 
                shippingCarrier: carrier, 
                shippingTracking: update.tracking, 
                shippedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            opsCount++;

            if (opsCount >= 450) {
                await batch.commit();
                batch = writeBatch(db); 
                opsCount = 0;
            }
        }

        if (opsCount > 0) await batch.commit();

        alert("🚚 ¡Despacho Masivo Exitoso!");
        getEl('bulk-dispatch-modal').classList.add('hidden');
        document.querySelectorAll('.order-cb').forEach(cb => cb.checked = false); 

    } catch (e) {
        console.error(e);
        alert("Error despachando: " + (e.message || e));
    } finally {
        btn.disabled = false; btn.innerHTML = originalText;
    }
}

// --- EXPORTAR AL WINDOW ---
window.openBulkPaymentModal = openBulkPaymentModal;
window.processBulkPayment = processBulkPayment;
window.openBulkDispatchModal = openBulkDispatchModal;
window.processBulkDispatch = processBulkDispatch;
window.openBulkPackingModal = openBulkPackingModal;
window.processBulkPacking = processBulkPacking;
window.openPaymentModal = openPaymentModal;
window.generateLabels = generateLabels;