import { db, collection, getDocs, query, orderBy, addDoc, deleteDoc, doc, auth } from '../firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// --- DOM ---
const searchInput = document.getElementById('product-search');
const resultsContainer = document.getElementById('product-results');
const generalDashboard = document.getElementById('general-dashboard');
const specificDashboard = document.getElementById('specific-dashboard');
const btnBack = document.getElementById('btn-back-general');
const timelineBody = document.getElementById('timeline-table-body');
const topSalesList = document.getElementById('top-sales-list');
const topProfitList = document.getElementById('top-profit-list');

// --- DATOS GLOBALES EN RAM ---
let productIndex = [];
let allPurchases = [];
let allOrders = [];
let globalMetrics = []; 
let currentPeriod = 'GLOBAL';
let currentProfitabilityBranchId = 'ALL';
let currentProductIdOpen = null;
let currentTimelinePage = 1;
const TIMELINE_PAGE_SIZE = 10;
let currentTimelineData = [];

const STORAGE_KEY = 'mismartech_admin_master_inventory';
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
const formatMoney = (val) => `$${Math.round(val).toLocaleString('es-CO')}`;

const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function getMonthYearLabel(date) {
    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

function getMonthYearKey(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${date.getFullYear()}-${m}`;
}

// ============================================================================
// 1. INICIALIZACIÓN Y DESCARGA MASIVA
// ============================================================================
async function initAnalysis() {
    try {
        const cachedRaw = localStorage.getItem(STORAGE_KEY);
        if (cachedRaw) {
            try {
                const parsed = JSON.parse(cachedRaw);
                if (parsed.map) productIndex = Object.values(parsed.map);
            } catch (e) { console.warn("Cache corrupto."); }
        }
        if (productIndex.length === 0) {
            const snap = await getDocs(collection(db, "products"));
            productIndex = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        const [purchasesSnap, ordersSnap] = await Promise.all([
            getDocs(query(collection(db, "purchases"), orderBy("createdAt", "asc"))),
            getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc")))
        ]);

        purchasesSnap.forEach(doc => allPurchases.push({ id: doc.id, ...doc.data() }));
        ordersSnap.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));

        calculateGlobalFIFO();

        // Obtener meses únicos con ventas y poblar selector de período
        const uniqueMonths = new Set();
        allOrders.forEach(o => {
            if (['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) return;
            if (o.createdAt) {
                const date = o.createdAt.toDate ? o.createdAt.toDate() : new Date(o.createdAt);
                uniqueMonths.add(getMonthYearKey(date));
            }
        });

        // Asegurar que el mes actual del sistema esté presente si hay órdenes
        const today = new Date();
        uniqueMonths.add(getMonthYearKey(today));

        const sortedMonthKeys = Array.from(uniqueMonths).sort().reverse();
        const periodSelector = document.getElementById('period-selector');

        sortedMonthKeys.forEach(key => {
            const [year, month] = key.split('-');
            const date = new Date(parseInt(year), parseInt(month) - 1, 1);
            const label = getMonthYearLabel(date);
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            periodSelector.appendChild(opt);
        });

        // Poblar selector de Sedes para filtrado dinámico en Rentabilidad FIFO
        const branchFilterSelector = document.getElementById('branch-filter-selector');
        if (branchFilterSelector) {
            try {
                const branchesSnap = await getDocs(collection(db, "branches"));
                branchesSnap.forEach(d => {
                    const b = d.data();
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = b.name || d.id;
                    branchFilterSelector.appendChild(opt);
                });
            } catch (err) {
                console.error("Error al cargar sedes para el filtro:", err);
            }

            branchFilterSelector.addEventListener('change', (e) => {
                currentProfitabilityBranchId = e.target.value;
                calculateGlobalFIFO();
                updateDashboardForPeriod(currentPeriod);
                if (currentProductIdOpen) {
                    window.showSpecificProduct(currentProductIdOpen);
                }
            });
        }

        periodSelector.addEventListener('change', (e) => {
            updateDashboardForPeriod(e.target.value);
        });

        const btnPrev = document.getElementById('btn-timeline-prev');
        const btnNext = document.getElementById('btn-timeline-next');
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (currentTimelinePage > 1) {
                    currentTimelinePage--;
                    renderTimelinePage();
                }
            });
        }
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const totalPages = Math.ceil(currentTimelineData.length / TIMELINE_PAGE_SIZE) || 1;
                if (currentTimelinePage < totalPages) {
                    currentTimelinePage++;
                    renderTimelinePage();
                }
            });
        }

        updateDashboardForPeriod('GLOBAL');

        const btnSync = document.getElementById('btn-sync-fifo');
        if (btnSync) {
            btnSync.classList.remove('hidden');
            btnSync.classList.add('flex');
        }

    } catch (e) {
        console.error("Error en inicialización:", e);
        topSalesList.innerHTML = `<div class="p-4 text-red-500 font-bold text-xs text-center">Error al conectar con la base de datos.</div>`;
        topProfitList.innerHTML = `<div class="p-4 text-red-500 font-bold text-xs text-center">Error al conectar con la base de datos.</div>`;
    }
}

// ============================================================================
// 2. ALGORITMO CONTABLE FIFO (PROCESAMIENTO EN LOTE)
// ============================================================================
function calculateGlobalFIFO() {
    globalMetrics = [];

    productIndex.forEach(product => {
        let timeline = [];
        const activeBranchId = currentProfitabilityBranchId;

        allPurchases.forEach(p => {
            if (p.supplierName === "Ajuste de Inventario (Sistema)") return;
            const pBranch = p.branchId || 'bodega';
            if (activeBranchId !== 'ALL' && pBranch !== activeBranchId) return;

            if (p.items) {
                p.items.forEach(item => {
                    if (item.id === product.id) {
                        timeline.push({ 
                            type: 'IN', 
                            date: p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt), 
                            qty: parseInt(item.quantity) || 0, 
                            unitCost: parseFloat(item.unitCostBase) || 0, 
                            refId: p.id 
                        });
                    }
                });
            }
        });

        allOrders.forEach(o => {
            if (['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) return;
            const oBranch = o.branchId || 'bodega';
            if (activeBranchId !== 'ALL' && oBranch !== activeBranchId) return;

            if (o.items) {
                o.items.forEach(item => {
                    if (item.id === product.id) {
                        timeline.push({ 
                            type: 'OUT', 
                            date: o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt), 
                            qty: parseInt(item.quantity) || 0, 
                            unitPrice: parseFloat(item.price) || 0, 
                            refId: o.internalOrderNumber ? o.internalOrderNumber.toString() : o.id, 
                            status: o.status 
                        });
                    }
                });
            }
        });

        timeline.sort((a, b) => a.date - b.date);

        let inventoryQueue = []; 
        let totalQtySold = 0, totalRevenue = 0, totalCOGS = 0;
        let lastKnownCost = product.lastPurchaseCost || 0;

        timeline.forEach(event => {
            if (event.type === 'IN') {
                inventoryQueue.push({ qty: event.qty, cost: event.unitCost });
                if (event.unitCost > 0) lastKnownCost = event.unitCost;
                event.totalIn = event.qty * event.unitCost;
            } 
            else if (event.type === 'OUT') {
                let qtyToFulfill = event.qty;
                let costForThisSale = 0;
                let isGhostInventory = false;

                while (qtyToFulfill > 0 && inventoryQueue.length > 0) {
                    let batch = inventoryQueue[0];
                    if (batch.qty <= qtyToFulfill) {
                        costForThisSale += batch.qty * batch.cost;
                        qtyToFulfill -= batch.qty;
                        inventoryQueue.shift();
                    } else {
                        costForThisSale += qtyToFulfill * batch.cost;
                        batch.qty -= qtyToFulfill;
                        qtyToFulfill = 0;
                    }
                }

                if (qtyToFulfill > 0) {
                    isGhostInventory = true;
                    costForThisSale += (qtyToFulfill * lastKnownCost);
                }

                event.costForThisSale = costForThisSale;
                event.revenueForThisSale = event.qty * event.unitPrice;
                event.profitForThisSale = event.revenueForThisSale - costForThisSale;
                event.isGhostInventory = isGhostInventory;

                totalQtySold += event.qty;
                totalRevenue += event.revenueForThisSale;
                totalCOGS += costForThisSale;
            }
        });

        const profit = totalRevenue - totalCOGS;
        const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

        // Obtener stock real correspondiente a la sede seleccionada en el filtro
        let realStock = 0;
        if (product.combinations && product.combinations.length > 0) {
            product.combinations.forEach(combo => {
                const comboStock = (activeBranchId === 'ALL')
                    ? (parseInt(combo.stock) || 0)
                    : ((combo.branchStock && combo.branchStock[activeBranchId] !== undefined)
                        ? (parseInt(combo.branchStock[activeBranchId]) || 0)
                        : (activeBranchId === 'bodega' ? (parseInt(combo.stock) || 0) : 0));
                realStock += comboStock;
            });
        } else {
            realStock = (activeBranchId === 'ALL')
                ? (parseInt(product.stock) || 0)
                : ((product.branchStock && product.branchStock[activeBranchId] !== undefined)
                    ? (parseInt(product.branchStock[activeBranchId]) || 0)
                    : (activeBranchId === 'bodega' ? (parseInt(product.stock) || 0) : 0));
        }

        let calculatedRemaining = inventoryQueue.reduce((sum, item) => sum + item.qty, 0);
        const stockDiff = realStock - calculatedRemaining;

        if (stockDiff > 0) {
            timeline.push({
                type: 'IN',
                date: new Date(),
                qty: stockDiff,
                unitCost: lastKnownCost,
                totalIn: stockDiff * lastKnownCost,
                refId: 'AJUSTE_INVENTARIO',
                isAdjustment: true
            });
            inventoryQueue.push({ qty: stockDiff, cost: lastKnownCost });
        } else if (stockDiff < 0) {
            timeline.push({
                type: 'OUT',
                date: new Date(),
                qty: Math.abs(stockDiff),
                unitPrice: 0,
                revenueForThisSale: 0,
                costForThisSale: 0,
                profitForThisSale: 0,
                refId: 'AJUSTE_INVENTARIO',
                isAdjustment: true
            });
        }

        const remainingStock = realStock;
        const nextBatchCost = inventoryQueue.length > 0 ? inventoryQueue[0].cost : lastKnownCost;
        const nextBatchQty = inventoryQueue.length > 0 ? inventoryQueue[0].qty : 0;

        globalMetrics.push({
            product,
            totalQtySold,
            totalRevenue,
            totalCOGS,
            profit,
            margin,
            timeline,
            remainingStock,
            nextBatchCost,
            nextBatchQty
        });
    });
}

// ============================================================================
// 3. ACTUALIZACIÓN DEL DASHBOARD SEGÚN PERIODO
// ============================================================================
function updateDashboardForPeriod(period) {
    currentPeriod = period;

    let totalPeriodProfit = 0;

    globalMetrics.forEach(m => {
        let periodQtySold = 0;
        let periodRevenue = 0;
        let periodCOGS = 0;

        m.timeline.forEach(event => {
            if (event.type === 'OUT') {
                const eventPeriod = getMonthYearKey(event.date);
                if (period === 'GLOBAL' || eventPeriod === period) {
                    periodQtySold += event.qty;
                    periodRevenue += event.revenueForThisSale;
                    periodCOGS += event.costForThisSale;
                }
            }
        });

        m.periodQtySold = periodQtySold;
        m.periodRevenue = periodRevenue;
        m.periodCOGS = periodCOGS;
        m.periodProfit = periodRevenue - periodCOGS;
        m.periodMargin = periodRevenue > 0 ? (m.periodProfit / periodRevenue) * 100 : 0;

        totalPeriodProfit += m.periodProfit;
    });

    const periodLabel = document.getElementById('period-profit-label');
    const periodVal = document.getElementById('period-profit-val');
    
    if (period === 'GLOBAL') {
        periodLabel.textContent = "Ganancia Total (Global)";
    } else {
        const [year, month] = period.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        periodLabel.textContent = `Ganancia de ${getMonthYearLabel(date)}`;
    }
    periodVal.textContent = formatMoney(totalPeriodProfit);

    // Calcular ganancia exclusiva del mes actual (siempre con la fecha del sistema)
    let totalCurrentMonthProfit = 0;
    const today = new Date();
    const currentMonthKey = getMonthYearKey(today);

    globalMetrics.forEach(m => {
        m.timeline.forEach(event => {
            if (event.type === 'OUT') {
                const eventPeriod = getMonthYearKey(event.date);
                if (eventPeriod === currentMonthKey) {
                    totalCurrentMonthProfit += event.profitForThisSale;
                }
            }
        });
    });
    
    document.getElementById('current-month-label').textContent = `Ganancia de ${getMonthYearLabel(today)}`;
    document.getElementById('current-month-val').textContent = formatMoney(totalCurrentMonthProfit);

    renderTop10ListsFiltered();
}

function renderTop10ListsFiltered() {
    const byRevenue = [...globalMetrics].sort((a, b) => b.periodRevenue - a.periodRevenue).slice(0, 10);
    const byProfit = [...globalMetrics].sort((a, b) => b.periodProfit - a.periodProfit).slice(0, 10);

    const generateHtml = (arr, type) => {
        if (arr.length === 0 || arr[0].periodQtySold === 0) return `<div class="text-center p-4 text-gray-400 text-xs font-bold">Sin datos suficientes</div>`;
        
        return arr.filter(i => i.periodQtySold > 0).map((item, index) => {
            const p = item.product;
            
            const valueDisplay = type === 'sales'
                ? `<span class="text-brand-orange font-black text-sm sm:text-base lg:text-lg xl:text-xl tracking-tight">${formatMoney(item.periodRevenue)}</span>`
                : `<span class="text-emerald-500 font-black text-sm sm:text-base lg:text-lg xl:text-xl tracking-tight">${formatMoney(item.periodProfit)}</span><br><span class="text-[9px] sm:text-[10px] text-gray-400 font-bold tracking-widest uppercase bg-gray-50 px-1.5 py-0.5 rounded inline-block mt-0.5">Margen: ${item.periodMargin.toFixed(1)}%</span>`;

            return `
            <div class="flex items-center gap-4 p-4 hover:bg-slate-50 rounded-2xl transition-all duration-300 cursor-pointer border border-transparent hover:border-gray-100 hover:shadow-sm hover:-translate-y-0.5 group" onclick="window.showSpecificProduct('${p.id}')">
                <div class="w-8 h-8 rounded-full bg-slate-100 text-gray-400 flex items-center justify-center text-[11px] font-black shrink-0 group-hover:bg-brand-black group-hover:text-white transition-colors">${index + 1}</div>
                <img src="${p.mainImage || p.image || 'https://placehold.co/50'}" class="w-14 h-14 rounded-lg object-contain bg-white border border-gray-100 shrink-0 p-1 shadow-sm">
                <div class="flex-grow min-w-0">
                    <p class="text-xs font-black text-brand-black uppercase truncate group-hover:text-brand-orange transition-colors">${p.name}</p>
                    <p class="text-[10px] font-bold text-gray-400 truncate mt-1">SKU: ${p.sku || 'N/A'} <span class="mx-1">•</span> <i class="fa-solid fa-tags text-gray-300"></i> ${item.periodQtySold} unid.</p>
                </div>
                <div class="text-right shrink-0 leading-tight">
                    ${valueDisplay}
                </div>
            </div>`;
        }).join('');
    };

    topSalesList.innerHTML = generateHtml(byRevenue, 'sales');
    topProfitList.innerHTML = generateHtml(byProfit, 'profit');
}

// ============================================================================
// 4. INTERACCIÓN UI (BUSCADOR Y VISTA ESPECÍFICA)
// ============================================================================
searchInput.addEventListener('input', (e) => {
    const term = normalizeText(e.target.value.trim());
    if (term.length < 2) {
        resultsContainer.classList.add('hidden');
        return;
    }

    const words = term.split(" ");
    const results = productIndex.filter(p => {
        const searchStr = normalizeText(`${p.name} ${p.sku || ''} ${p.brand || ''}`);
        return words.every(w => searchStr.includes(w));
    });

    resultsContainer.innerHTML = "";
    if (results.length === 0) {
        resultsContainer.innerHTML = `<div class="p-4 text-xs font-bold text-gray-400 text-center">No encontrado</div>`;
    } else {
        results.slice(0, 10).forEach(p => {
            const div = document.createElement('div');
            div.className = "p-3 hover:bg-brand-orange/10 cursor-pointer border-b border-gray-50 last:border-0 rounded-lg flex items-center gap-3 transition-colors";
            div.innerHTML = `
                <img src="${p.mainImage || p.image || ''}" class="w-8 h-8 rounded object-contain bg-gray-50 border border-gray-100">
                <div>
                    <p class="text-[11px] font-black uppercase text-brand-black">${p.name}</p>
                    <p class="text-[9px] font-bold text-gray-400">SKU: ${p.sku || 'N/A'}</p>
                </div>`;
            div.onclick = () => {
                searchInput.value = ""; 
                resultsContainer.classList.add('hidden');
                window.showSpecificProduct(p.id);
            };
            resultsContainer.appendChild(div);
        });
    }
    resultsContainer.classList.remove('hidden');
});

window.showGeneralDashboard = () => {
    currentProductIdOpen = null;
    specificDashboard.classList.add('hidden');
    btnBack.classList.add('hidden');
    generalDashboard.classList.remove('hidden');
};

window.showSpecificProduct = (productId) => {
    currentProductIdOpen = productId;
    const data = globalMetrics.find(m => m.product.id === productId);
    if (!data) return;

    generalDashboard.classList.add('hidden');
    specificDashboard.classList.remove('hidden');
    btnBack.classList.remove('hidden');
    btnBack.classList.add('flex');

    document.getElementById('dash-name').textContent = data.product.name;
    document.getElementById('dash-sku').textContent = `SKU: ${data.product.sku || 'N/A'}`;
    document.getElementById('dash-img').src = data.product.mainImage || data.product.image || '';

    document.getElementById('dash-qty-sold').textContent = data.periodQtySold;
    document.getElementById('dash-revenue').textContent = formatMoney(data.periodRevenue);
    document.getElementById('dash-cogs').textContent = `-${formatMoney(data.periodCOGS)}`;
    document.getElementById('dash-profit').textContent = formatMoney(data.periodProfit);
    document.getElementById('dash-margin').textContent = `Margen: ${data.periodMargin.toFixed(1)}%`;

    // Nuevas métricas de Inventario FIFO
    document.getElementById('dash-stock-qty').textContent = data.remainingStock;
    const nextCost = data.nextBatchCost;
    document.getElementById('dash-next-cost').textContent = data.remainingStock > 0 ? formatMoney(nextCost) : "Sin stock";
    document.getElementById('dash-next-qty').textContent = data.remainingStock > 0 ? data.nextBatchQty : 0;

    // Precio Web y Utilidad Esperada (Margen de la siguiente venta)
    const webPrice = data.product.price || 0;
    document.getElementById('dash-web-price').textContent = formatMoney(webPrice);
    
    if (data.remainingStock > 0) {
        const expectedProfit = webPrice - nextCost;
        const expectedMargin = webPrice > 0 ? (expectedProfit / webPrice) * 100 : 0;
        document.getElementById('dash-expected-profit').textContent = formatMoney(expectedProfit);
        document.getElementById('dash-expected-margin').textContent = `Margen: ${expectedMargin.toFixed(1)}%`;
    } else {
        document.getElementById('dash-expected-profit').textContent = "---";
        document.getElementById('dash-expected-margin').textContent = "Sin stock";
    }

    timelineBody.innerHTML = "";

    // Filtrar timeline para mostrar solo los movimientos del periodo seleccionado
    const filteredTimeline = data.timeline.filter(event => {
        if (currentPeriod === 'GLOBAL') return true;
        const eventPeriod = getMonthYearKey(event.date);
        return eventPeriod === currentPeriod;
    });

    // Ordenar los movimientos del más nuevo al más viejo para la visualización del usuario
    filteredTimeline.sort((a, b) => b.date - a.date);

    currentTimelineData = filteredTimeline;
    currentTimelinePage = 1;
    renderTimelinePage();
};

function renderTimelinePage() {
    timelineBody.innerHTML = "";
    const totalItems = currentTimelineData.length;
    const infoEl = document.getElementById('timeline-pagination-info');
    const pageNumEl = document.getElementById('timeline-page-num');
    const btnPrev = document.getElementById('btn-timeline-prev');
    const btnNext = document.getElementById('btn-timeline-next');

    if (totalItems === 0) {
        timelineBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-sm font-bold text-gray-400">No hay movimientos registrados para este periodo.</td></tr>`;
        if (infoEl) infoEl.textContent = "Mostrando 0 - 0 de 0 movimientos";
        if (pageNumEl) pageNumEl.textContent = "Página 1";
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const totalPages = Math.ceil(totalItems / TIMELINE_PAGE_SIZE) || 1;
    if (currentTimelinePage > totalPages) currentTimelinePage = totalPages;
    if (currentTimelinePage < 1) currentTimelinePage = 1;

    const startIdx = (currentTimelinePage - 1) * TIMELINE_PAGE_SIZE;
    const endIdx = Math.min(startIdx + TIMELINE_PAGE_SIZE, totalItems);
    const pageItems = currentTimelineData.slice(startIdx, endIdx);

    if (infoEl) infoEl.textContent = `Mostrando ${startIdx + 1} - ${endIdx} de ${totalItems} movimientos`;
    if (pageNumEl) pageNumEl.textContent = `Página ${currentTimelinePage} de ${totalPages}`;
    if (btnPrev) btnPrev.disabled = (currentTimelinePage <= 1);
    if (btnNext) btnNext.disabled = (currentTimelinePage >= totalPages);

    pageItems.forEach(event => {
        const dateStr = event.isAdjustment ? 'Actual' : event.date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

        if (event.type === 'IN') {
            const movementBadge = event.isAdjustment
                ? `<span class="bg-purple-100 text-purple-700 px-2 py-1 rounded text-[10px] font-black uppercase"><i class="fa-solid fa-sync mr-1"></i> Ajuste Sincro</span><br><span class="text-[9px] text-purple-500 mt-1 block">Ajuste de Stock Real</span>`
                : `<span class="bg-blue-100 text-blue-600 px-2 py-1 rounded text-[10px] font-black uppercase"><i class="fa-solid fa-arrow-down mr-1"></i> Compra</span><br><span class="text-[9px] text-gray-400 mt-1 block">Ref: ${event.refId.slice(0,6)}</span>`;

            timelineBody.innerHTML += `
                <tr class="bg-blue-50/30 border-b border-gray-50">
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-xs sm:text-sm font-bold text-gray-500">${dateStr}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5">${movementBadge}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-center font-black text-brand-black text-sm sm:text-base">+${event.qty}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-right text-xs sm:text-sm font-bold">${formatMoney(event.unitCost)}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-right font-black text-brand-black text-sm sm:text-base">${formatMoney(event.totalIn)}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-right text-gray-300">---</td>
                </tr>
            `;
        } else if (event.type === 'OUT') {
            const ghostBadge = event.isGhostInventory 
                ? `<span class="inline-block mt-1 text-[8px] bg-orange-100 text-orange-600 border border-orange-200 px-2 py-0.5 rounded uppercase font-bold" title="Costo estimado">Costo Estimado</span>` 
                : '';

            const movementBadge = event.isAdjustment
                ? `<span class="bg-amber-100 text-amber-700 px-2 py-1 rounded text-[10px] font-black uppercase"><i class="fa-solid fa-minus-circle mr-1"></i> Reducción Stock</span><br><span class="text-[9px] text-amber-500 mt-1 block">Ajuste de Stock Real</span>`
                : `<span class="bg-emerald-50 text-emerald-600 px-2 py-1 rounded text-[10px] font-black uppercase"><i class="fa-solid fa-arrow-up mr-1"></i> Venta</span><br><span class="text-[9px] text-gray-400 mt-1 block">Ord: #${event.refId.slice(0,6)}</span>`;

            timelineBody.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-gray-50 transition-colors">
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-xs sm:text-sm font-bold text-gray-500">${dateStr}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5">${movementBadge}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-center font-black text-brand-black text-sm sm:text-base">-${event.qty}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-right text-xs sm:text-sm font-bold">${formatMoney(event.unitPrice)}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-right font-black text-brand-black text-sm sm:text-base">${formatMoney(event.revenueForThisSale)}</td>
                    <td class="px-3 py-3.5 sm:px-6 sm:py-5 text-right">
                        <span class="font-black text-sm sm:text-base ${event.profitForThisSale >= 0 ? 'text-brand-orange' : 'text-red-500'}">
                            ${event.profitForThisSale >= 0 ? '+' : ''}${formatMoney(event.profitForThisSale)}
                        </span>
                        <br><span class="text-[10px] text-gray-400 font-bold tracking-widest block mt-1">Costo: -${formatMoney(event.costForThisSale)}</span>
                        ${ghostBadge}
                    </td>
                </tr>
            `;
        }
    });
}

window.syncRealStockWithFIFO = async () => {
    const confirmMessage = `⚠️ ¿Está seguro de que desea alinear la base de datos de TODAS las sedes a la vez?\n\n` + 
                           `Este proceso eliminara primero cualquier ajuste de sistema previo anterior para no duplicar datos, ` +
                           `y creará los nuevos registros de ajuste exactos para igualar el stock real con el historial de cada sede en Firestore.`;
    
    if (!confirm(confirmMessage)) return;

    const btnSync = document.getElementById('btn-sync-fifo');
    const originalText = btnSync.innerHTML;
    btnSync.disabled = true;
    btnSync.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Limpiando y Alineando...`;

    try {
        // PASO 1: Eliminar ajustes previos del sistema de la colección "purchases"
        const existingPurchasesSnap = await getDocs(collection(db, "purchases"));
        let deletedCount = 0;
        
        for (const pDoc of existingPurchasesSnap.docs) {
            const pData = pDoc.data();
            if (pData.supplierName === "Ajuste de Inventario (Sistema)" || pData.refId === 'INITIAL_STOCK_OR_ADJUSTMENT' || pData.refId === 'MANUAL_STOCK_REDUCTION') {
                await deleteDoc(doc(db, "purchases", pDoc.id));
                deletedCount++;
            }
        }
        console.log(`🗑️ Se eliminaron ${deletedCount} registros de ajuste anteriores.`);

        // PASO 2: Recargar la lista fresca de compras reales (sin los ajustes eliminados) y pedidos
        const [freshPurchasesSnap, freshOrdersSnap, branchesSnap] = await Promise.all([
            getDocs(query(collection(db, "purchases"), orderBy("createdAt", "asc"))),
            getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc"))),
            getDocs(collection(db, "branches"))
        ]);

        const freshPurchases = [];
        freshPurchasesSnap.forEach(d => freshPurchases.push({ id: d.id, ...d.data() }));

        const freshOrders = [];
        freshOrdersSnap.forEach(d => freshOrders.push({ id: d.id, ...d.data() }));

        const branchIds = [];
        branchesSnap.forEach(d => branchIds.push(d.id));
        if (!branchIds.includes('bodega')) branchIds.push('bodega'); // Asegurar bodega principal

        let createdCount = 0;

        // PASO 3: Recalcular discrepancias reales por sede y producto
        for (const product of productIndex) {
            
            for (const branchId of branchIds) {
                let branchPurchased = 0;
                let branchSold = 0;

                // Compras reales
                freshPurchases.forEach(p => {
                    const pBranch = p.branchId || 'bodega';
                    if (pBranch !== branchId) return;

                    if (p.items) {
                        p.items.forEach(item => {
                            if (item.id === product.id) {
                                branchPurchased += parseInt(item.quantity) || 0;
                            }
                        });
                    }
                });

                // Ventas reales
                freshOrders.forEach(o => {
                    if (['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) return;
                    const oBranch = o.branchId || 'bodega';
                    if (oBranch !== branchId) return;

                    if (o.items) {
                        o.items.forEach(item => {
                            if (item.id === product.id) {
                                branchSold += parseInt(item.quantity) || 0;
                            }
                        });
                    }
                });

                // Stock real en la sede
                let realStock = 0;
                if (product.combinations && product.combinations.length > 0) {
                    product.combinations.forEach(combo => {
                        const comboStock = (combo.branchStock && combo.branchStock[branchId] !== undefined)
                            ? (parseInt(combo.branchStock[branchId]) || 0)
                            : (branchId === 'bodega' ? (parseInt(combo.stock) || 0) : 0);
                        realStock += comboStock;
                    });
                } else {
                    realStock = (product.branchStock && product.branchStock[branchId] !== undefined)
                        ? (parseInt(product.branchStock[branchId]) || 0)
                        : (branchId === 'bodega' ? (parseInt(product.stock) || 0) : 0);
                }

                const discrepancy = realStock + branchSold - branchPurchased;

                if (discrepancy !== 0) {
                    const cost = parseFloat(product.lastPurchaseCost || product.cost || 0) || 0;

                    const purchaseDoc = {
                        supplierName: "Ajuste de Inventario (Sistema)",
                        createdBy: auth.currentUser?.email || sessionStorage.getItem('adminUserEmail') || "Sistema",
                        createdAt: new Date(0), // Epoch 0 (1970)
                        branchId: branchId,
                        hasIVA: false,
                        totalCost: discrepancy * cost,
                        items: [{
                            id: product.id,
                            name: product.name,
                            quantity: discrepancy,
                            unitCostBase: cost,
                            totalRow: discrepancy * cost
                        }]
                    };

                    await addDoc(collection(db, "purchases"), purchaseDoc);
                    createdCount++;
                }
            }
        }

        alert(`✅ Proceso finalizado con éxito.\n` + 
              `- Registros de ajuste anteriores eliminados: ${deletedCount}\n` + 
              `- Nuevos registros de ajuste creados en Firestore: ${createdCount}`);
        window.location.reload();
    } catch (err) {
        console.error("Error durante la depuración y alineación de stock:", err);
        alert(`❌ Error durante el proceso: ${err.message || err}`);
    } finally {
        btnSync.disabled = false;
        btnSync.innerHTML = originalText;
    }
};

initAnalysis();