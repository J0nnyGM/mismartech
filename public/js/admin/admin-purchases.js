import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js'; // 🔥 IMPORTAMOS EL CEREBRO CENTRAL
import { db, doc, runTransaction, collection, query, where, getDocs, auth } from '../firebase-init.js';

loadAdminSidebar();

// --- REFERENCIAS DOM ---
const tableBody = document.getElementById('purchases-table-body');
const btnPrev = document.getElementById('btn-prev-page');
const btnNext = document.getElementById('btn-next-page');
const pageIndicator = document.getElementById('page-indicator');
const searchInput = document.getElementById('search-input');

// --- ESTADO GLOBAL ---
const PAGE_SIZE = 20;
let currentPage = 1;
let adminPurchasesCache = []; // Recibirá los datos en RAM

const formatMoney = (amount) => `$${Math.round(amount || 0).toLocaleString('es-CO')}`;

// ==========================================================================
// 🔥 CONEXIÓN AL STORE CENTRAL
// ==========================================================================
AdminStore.subscribeToPurchases((purchases) => {
    adminPurchasesCache = purchases;
    renderPurchasesFromMemory();
});

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================

if (btnPrev) {
    btnPrev.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderPurchasesFromMemory();
        }
    };
}

if (btnNext) {
    btnNext.onclick = () => {
        currentPage++;
        renderPurchasesFromMemory();
    };
}

function renderPurchasesFromMemory() {
    if (!tableBody) return;

    let filtered = adminPurchasesCache;
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // Búsqueda ultrarrápida en RAM
    if (term.length > 0) {
        filtered = filtered.filter(p => 
            p.id.toLowerCase().includes(term) || 
            (p.supplierName || "").toLowerCase().includes(term)
        );
    }

    tableBody.innerHTML = "";

    const totalItems = filtered.length;
    const maxPage = Math.ceil(totalItems / PAGE_SIZE) || 1;
    if (currentPage > maxPage) currentPage = maxPage;
    if (currentPage < 1) currentPage = 1;

    if (totalItems === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontraron compras.</td></tr>`;
        if (pageIndicator) pageIndicator.textContent = "Página 1 de 1 (0 items)";
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;
    const pageData = filtered.slice(startIdx, endIdx);

    pageData.forEach(p => renderRow(p));

    if (pageIndicator) {
        pageIndicator.textContent = `Página ${currentPage} de ${maxPage} (${totalItems} items)`;
    }
    if (btnPrev) {
        btnPrev.disabled = (currentPage === 1);
    }
    if (btnNext) {
        btnNext.disabled = (currentPage === maxPage);
    }
}

if (searchInput) {
    searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderPurchasesFromMemory();
    });
}

function parseFirestoreDate(rawDate) {
    if (!rawDate) return null;
    if (typeof rawDate.toDate === 'function') {
        return rawDate.toDate();
    }
    if (typeof rawDate.seconds === 'number') {
        return new Date(rawDate.seconds * 1000);
    }
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? null : d;
}

// ==========================================================================
// RENDERIZADO DE FILAS Y MODAL
// ==========================================================================
function renderRow(p) {
    const dateObj = parseFirestoreDate(p.createdAt);
    const dateStr = dateObj ? dateObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--';
    
    let totalItems = 0;
    if (p.items && Array.isArray(p.items)) {
        totalItems = p.items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
    }

    const shortId = p.id.slice(0, 8).toUpperCase();
    
    // Si dice el genérico "Administrador", intentamos mostrar el email de quien lo editó o dejarlo más informativo
    let adminName = p.createdBy || "Sistema";
    if (adminName === "Administrador" && p.editedBy) {
        adminName = p.editedBy;
    }

    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-50 transition border-b border-gray-50 fade-in";
    tr.innerHTML = `
        <td class="px-8 py-6">
            <div class="font-black text-brand-orange uppercase tracking-tighter text-sm mb-1">#${shortId}</div>
            <div class="text-[9px] font-bold text-gray-500">${dateStr}</div>
        </td>
        <td class="px-8 py-6">
            <div class="font-black text-brand-black uppercase text-xs truncate max-w-[200px]">${p.supplierName || 'Desconocido'}</div>
        </td>
        <td class="px-8 py-6 text-center">
            <span class="bg-gray-100 text-gray-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase border border-gray-200">${totalItems} Unidades</span>
        </td>
        <td class="px-8 py-6 text-center text-[10px] font-bold text-gray-400 uppercase tracking-tight">${adminName}</td>
        <td class="px-8 py-6 text-right font-black text-brand-black text-base">${formatMoney(p.totalCost)}</td>
        <td class="px-8 py-6 text-center">
            <button onclick="window.viewPurchaseDetail('${p.id}')" title="Ver Factura" class="w-9 h-9 mx-auto rounded-xl bg-white border border-gray-200 text-gray-400 hover:text-brand-orange hover:border-brand-orange hover:shadow-md transition flex items-center justify-center">
                <i class="fa-solid fa-eye text-xs"></i>
            </button>
        </td>
    `;
    tableBody.appendChild(tr);
}

// Ver Detalle (0 Lecturas)
window.viewPurchaseDetail = (id) => {
    const p = adminPurchasesCache.find(x => x.id === id);
    if (!p) return;

    document.getElementById('modal-purchase-id').textContent = `#${p.id.slice(0, 8).toUpperCase()}`;
    const dateObj = parseFirestoreDate(p.createdAt);
    document.getElementById('modal-purchase-date').textContent = dateObj ? dateObj.toLocaleString('es-CO') : '--';

    document.getElementById('modal-supplier-name').textContent = p.supplierName || 'No registrado';
    
    let adminInfo = p.createdBy || 'Sistema';
    if (p.editedBy) {
        adminInfo += ` (Editado por: ${p.editedBy})`;
    }
    document.getElementById('modal-admin-name').textContent = adminInfo;
    
    const ivaBadge = document.getElementById('modal-iva-badge');
    if (p.hasIVA) {
        ivaBadge.textContent = "SÍ (Aplicado)";
        ivaBadge.className = "inline-block px-3 py-1 rounded bg-brand-orange/10 text-brand-orange text-[10px] font-black uppercase tracking-widest border border-brand-orange/20";
    } else {
        ivaBadge.textContent = "NO APLICADO";
        ivaBadge.className = "inline-block px-3 py-1 rounded bg-gray-100 text-gray-500 text-[10px] font-black uppercase tracking-widest border border-gray-200";
    }

    const itemsTbody = document.getElementById('modal-items-list');
    itemsTbody.innerHTML = "";

    if (p.items && p.items.length > 0) {
        p.items.forEach(item => {
            let variantText = '';
            if (item.color || item.capacity) {
                variantText = `<br><span class="text-[9px] text-gray-400 uppercase font-bold tracking-widest">${item.capacity ? item.capacity + ' ' : ''}${item.color ? item.color : ''}</span>`;
            }

            itemsTbody.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-4">
                        <span class="font-black text-brand-black text-xs uppercase">${item.name}</span>
                        ${variantText}
                    </td>
                    <td class="p-4 text-center font-black text-brand-orange">${item.quantity}</td>
                    <td class="p-4 text-right font-bold text-gray-600">${formatMoney(item.unitCostBase)}</td>
                    <td class="p-4 text-right font-black text-brand-black">${formatMoney(item.totalRow)}</td>
                </tr>
            `;
        });
    } else {
        itemsTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-xs font-bold text-gray-400">Sin detalles registrados.</td></tr>`;
    }

    document.getElementById('modal-purchase-total').textContent = formatMoney(p.totalCost);

    // Habilitar controles de edición solo para administradores
    const userRole = sessionStorage.getItem('adminUserRole') || 'customer';
    const adminEditActions = document.getElementById('admin-edit-actions');
    const btnEditPurchase = document.getElementById('btn-edit-purchase');
    if (adminEditActions && btnEditPurchase) {
        if (userRole === 'admin') {
            adminEditActions.classList.remove('hidden');
            btnEditPurchase.onclick = () => window.openEditPurchase(id);
        } else {
            adminEditActions.classList.add('hidden');
        }
    }

    document.getElementById('purchase-modal').classList.remove('hidden');
};

// ==========================================================================
// 🛠️ EDICIÓN DE COMPRAS (SOLO ADMINISTRADORES)
// ==========================================================================

window.openEditPurchase = (id) => {
    const p = adminPurchasesCache.find(x => x.id === id);
    if (!p) return;

    // Cerrar modal de detalles
    document.getElementById('purchase-modal').classList.add('hidden');

    document.getElementById('edit-purchase-id-display').textContent = `#${p.id.slice(0, 8).toUpperCase()}`;
    document.getElementById('edit-supplier-name').value = p.supplierName || '';
    document.getElementById('edit-has-iva').checked = !!p.hasIVA;

    const editItemsList = document.getElementById('edit-items-list');
    editItemsList.innerHTML = "";

    if (p.items && p.items.length > 0) {
        p.items.forEach((item) => {
            const enteredCost = p.hasIVA ? Math.round(item.unitCostBase * 1.19) : item.unitCostBase;
            const subtotal = item.quantity * enteredCost;

            let variantText = '';
            if (item.color || item.capacity) {
                variantText = `<br><span class="text-[9px] text-gray-400 uppercase font-bold tracking-widest">${item.capacity ? item.capacity + ' ' : ''}${item.color ? item.color : ''}</span>`;
            }

            editItemsList.innerHTML += `
                <tr class="item-row hover:bg-slate-50 transition-colors" data-pid="${item.id}" data-color="${item.color || ''}" data-capacity="${item.capacity || ''}" data-name="${item.name}">
                    <td class="p-4">
                        <span class="font-black text-brand-black text-xs uppercase">${item.name}</span>
                        ${variantText}
                    </td>
                    <td class="p-4 text-center">
                        <input type="number" min="0" value="${item.quantity}" class="qty-input w-20 bg-gray-50 border border-gray-200 p-2 rounded-lg font-bold text-center text-xs outline-none focus:border-brand-orange">
                    </td>
                    <td class="p-4 text-right">
                        <input type="number" min="0" value="${enteredCost}" class="cost-input w-36 bg-gray-50 border border-gray-200 p-2 rounded-lg font-bold text-right text-xs outline-none focus:border-brand-orange">
                    </td>
                    <td class="p-4 text-right font-black text-brand-black subtotal-display" data-val="${subtotal}">
                        ${formatMoney(subtotal)}
                    </td>
                </tr>
            `;
        });
    }

    const rows = editItemsList.querySelectorAll('.item-row');
    rows.forEach(row => {
        const qtyInp = row.querySelector('.qty-input');
        const costInp = row.querySelector('.cost-input');
        const subDisplay = row.querySelector('.subtotal-display');

        const recalc = () => {
            const qty = parseInt(qtyInp.value) || 0;
            const cost = parseInt(costInp.value) || 0;
            const newSub = qty * cost;
            subDisplay.textContent = formatMoney(newSub);
            subDisplay.setAttribute('data-val', newSub);
            recalculateEditTotal();
        };

        qtyInp.addEventListener('input', recalc);
        costInp.addEventListener('input', recalc);
    });

    const editHasIvaCheckbox = document.getElementById('edit-has-iva');
    editHasIvaCheckbox.onchange = () => {
        // Al alternar el checkbox de IVA, recalculamos los subtotales usando el valor actual ingresado en el input
        rows.forEach(row => {
            const qty = parseInt(row.querySelector('.qty-input').value) || 0;
            const cost = parseInt(row.querySelector('.cost-input').value) || 0;
            const subDisplay = row.querySelector('.subtotal-display');
            const newSub = qty * cost;
            subDisplay.setAttribute('data-val', newSub);
            subDisplay.textContent = formatMoney(newSub);
        });
        recalculateEditTotal();
    };

    recalculateEditTotal();
    document.getElementById('edit-purchase-modal').classList.remove('hidden');

    const editForm = document.getElementById('edit-purchase-form');
    editForm.onsubmit = async (e) => {
        e.preventDefault();
        await window.saveEditPurchaseChanges(p.id);
    };
};

window.closeEditPurchaseModal = () => {
    document.getElementById('edit-purchase-modal').classList.add('hidden');
};

function recalculateEditTotal() {
    const editItemsList = document.getElementById('edit-items-list');
    const subdisplays = editItemsList.querySelectorAll('.subtotal-display');
    let grandTotal = 0;
    subdisplays.forEach(d => {
        grandTotal += parseInt(d.getAttribute('data-val')) || 0;
    });
    document.getElementById('edit-purchase-total').textContent = formatMoney(grandTotal);
}

window.saveEditPurchaseChanges = async (purchaseId) => {
    const p = adminPurchasesCache.find(x => x.id === purchaseId);
    if (!p) return;

    const userRole = sessionStorage.getItem('adminUserRole') || 'customer';
    if (userRole !== 'admin') {
        alert("Acceso denegado. Solo administradores pueden realizar esta acción.");
        return;
    }

    const btnSave = document.getElementById('btn-save-edit-purchase');
    const originalText = btnSave.innerHTML;
    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

    try {
        const newSupplierName = document.getElementById('edit-supplier-name').value.trim();
        const hasIva = document.getElementById('edit-has-iva').checked;

        // 1. Obtener la cuenta por pagar antes del inicio de la transacción
        const payablesQuery = query(collection(db, "payables"), where("purchaseId", "==", purchaseId));
        const payablesSnap = await getDocs(payablesQuery);
        let payableRef = null;
        let payableData = null;
        if (!payablesSnap.empty) {
            payableRef = doc(db, "payables", payablesSnap.docs[0].id);
            payableData = payablesSnap.docs[0].data();
        }

        // 2. Referencia del proveedor
        let supplierRef = null;
        if (p.supplierId) {
            supplierRef = doc(db, "suppliers", p.supplierId);
        }

        // 3. Procesar datos ingresados en el formulario
        const editItemsList = document.getElementById('edit-items-list');
        const rows = editItemsList.querySelectorAll('.item-row');
        const updatedItems = [];
        let newTotalCost = 0;

        rows.forEach(row => {
            const pid = row.getAttribute('data-pid');
            const color = row.getAttribute('data-color') || "";
            const capacity = row.getAttribute('data-capacity') || "";
            const name = row.getAttribute('data-name');
            const qty = parseInt(row.querySelector('.qty-input').value) || 0;
            const unitCostEntered = parseInt(row.querySelector('.cost-input').value) || 0;

            const rowTotal = qty * unitCostEntered;
            newTotalCost += rowTotal;
            const unitCostBase = hasIva ? Math.round(unitCostEntered / 1.19) : unitCostEntered;

            updatedItems.push({
                id: pid,
                name: name,
                quantity: qty,
                unitCostBase: unitCostBase,
                totalRow: Math.round(rowTotal),
                color: color,
                capacity: capacity
            });
        });

        // 4. Iniciar transacción en Firestore
        await runTransaction(db, async (transaction) => {
            // Cargar productos implicados
            const productIds = new Set();
            p.items.forEach(item => productIds.add(item.id));
            updatedItems.forEach(item => productIds.add(item.id));

            const productSnaps = {};
            for (const pid of productIds) {
                const pRef = doc(db, "products", pid);
                const pSnap = await transaction.get(pRef);
                if (!pSnap.exists()) throw `Producto ${pid} no existe.`;
                productSnaps[pid] = pSnap.data();
            }

            // Cargar compra
            const purchaseRef = doc(db, "purchases", purchaseId);
            const freshPurchaseSnap = await transaction.get(purchaseRef);
            if (!freshPurchaseSnap.exists()) throw "La compra ya no existe.";
            const freshPurchaseData = freshPurchaseSnap.data();

            // Cargar proveedor si existe
            let supplierData = null;
            if (supplierRef) {
                const sSnap = await transaction.get(supplierRef);
                if (sSnap.exists()) {
                    supplierData = sSnap.data();
                }
            }

            // Cargar cuenta por pagar si existe
            let freshPayableData = null;
            if (payableRef) {
                const paySnap = await transaction.get(payableRef);
                if (paySnap.exists()) {
                    freshPayableData = paySnap.data();
                }
            }

            const targetBranchId = freshPurchaseData.branchId || 'bodega';

            // Ajustar stocks de inventario
            for (const pid of productIds) {
                const pData = productSnaps[pid];
                const pRef = doc(db, "products", pid);

                let combinations = pData.combinations ? [...pData.combinations] : [];
                let branchStock = pData.branchStock ? {...pData.branchStock} : {};
                let lastCost = pData.lastPurchaseCost;

                // Restar cantidades anteriores
                const oldItems = p.items.filter(item => item.id === pid);
                oldItems.forEach(oldItem => {
                    const oQty = oldItem.quantity;
                    if (oldItem.color || oldItem.capacity) {
                        const comboIndex = combinations.findIndex(c => {
                            const colorMatch = (c.color || "") === (oldItem.color || "");
                            const capMatch = (c.capacity || "") === (oldItem.capacity || "");
                            return colorMatch && capMatch;
                        });
                        if (comboIndex >= 0) {
                            const combo = combinations[comboIndex];
                            if (!combo.branchStock) combo.branchStock = {};
                            combo.branchStock[targetBranchId] = Math.max(0, (combo.branchStock[targetBranchId] || 0) - oQty);
                            combo.stock = Object.values(combo.branchStock).reduce((sum, v) => sum + v, 0);
                        }
                    } else {
                        branchStock[targetBranchId] = Math.max(0, (branchStock[targetBranchId] || 0) - oQty);
                    }
                });

                // Sumar cantidades nuevas
                const newItems = updatedItems.filter(item => item.id === pid);
                newItems.forEach(newItem => {
                    const nQty = newItem.quantity;
                    lastCost = newItem.unitCostBase;
                    if (newItem.color || newItem.capacity) {
                        const comboIndex = combinations.findIndex(c => {
                            const colorMatch = (c.color || "") === (newItem.color || "");
                            const capMatch = (c.capacity || "") === (newItem.capacity || "");
                            return colorMatch && capMatch;
                        });
                        if (comboIndex >= 0) {
                            const combo = combinations[comboIndex];
                            if (!combo.branchStock) combo.branchStock = {};
                            combo.branchStock[targetBranchId] = (combo.branchStock[targetBranchId] || 0) + nQty;
                            combo.stock = Object.values(combo.branchStock).reduce((sum, v) => sum + v, 0);
                        } else {
                            const newCombo = {
                                color: newItem.color || "",
                                capacity: newItem.capacity || "",
                                branchStock: {
                                    [targetBranchId]: nQty
                                },
                                stock: nQty,
                                price: pData.price || 0
                            };
                            combinations.push(newCombo);
                        }
                    } else {
                        branchStock[targetBranchId] = (branchStock[targetBranchId] || 0) + nQty;
                    }
                });

                // Recalcular el stock total
                let newStockTotal = 0;
                if (combinations.length > 0) {
                    newStockTotal = combinations.reduce((sum, i) => sum + (parseInt(i.stock) || 0), 0);
                    const rootBranchStock = {};
                    combinations.forEach(c => {
                        if (c.branchStock) {
                            Object.keys(c.branchStock).forEach(bId => {
                                rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (c.branchStock[bId] || 0);
                            });
                        }
                    });
                    branchStock = rootBranchStock;
                } else {
                    newStockTotal = Object.values(branchStock).reduce((sum, v) => sum + v, 0);
                }

                // Guardar cambios en el producto
                transaction.update(pRef, {
                    stock: newStockTotal,
                    branchStock: branchStock,
                    combinations: combinations,
                    lastPurchaseCost: lastCost,
                    updatedAt: new Date()
                });
            }

            // Actualizar la factura / compra
            const finalTotal = Math.round(newTotalCost);
            const oldTotalCost = freshPurchaseData.totalCost || 0;
            const diffTotal = finalTotal - oldTotalCost;
            const adminEmail = auth.currentUser ? (auth.currentUser.displayName || auth.currentUser.email || 'Admin') : 'Admin';

            transaction.update(purchaseRef, {
                supplierName: newSupplierName,
                hasIVA: hasIva,
                totalCost: finalTotal,
                items: updatedItems,
                updatedAt: new Date(),
                editedBy: adminEmail
            });

            // Actualizar la cuenta por pagar (payable)
            if (payableRef && freshPayableData) {
                const amountPaid = freshPayableData.amountPaid || 0;
                const newBalance = Math.max(0, finalTotal - amountPaid);
                const newStatus = newBalance <= 0 ? 'PAID' : 'PENDING';
                transaction.update(payableRef, {
                    provider: newSupplierName,
                    total: finalTotal,
                    balance: newBalance,
                    status: newStatus,
                    updatedAt: new Date()
                });
            }

            // Actualizar totales invertidos en el proveedor
            if (supplierRef && supplierData) {
                transaction.update(supplierRef, {
                    name: newSupplierName,
                    totalInvested: (supplierData.totalInvested || 0) + diffTotal,
                    lastPurchase: new Date()
                });
            }
        });

        alert("✅ Entrada de inventario editada correctamente.");
        window.closeEditPurchaseModal();
        window.location.reload();

    } catch (err) {
        console.error("Error al guardar cambios de la compra:", err);
        alert("Error crítico: " + err);
    } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = originalText;
    }
};