import { db, collection, getDocs, query, orderBy } from '../firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// --- DOM ---
const periodSelector = document.getElementById('period-selector');
const kpiTotalSales = document.getElementById('kpi-total-sales');
const kpiTotalCogs = document.getElementById('kpi-total-cogs');
const kpiTotalExpenses = document.getElementById('kpi-total-expenses');
const kpiTotalNetProfit = document.getElementById('kpi-total-net-profit');
const kpiNetMargin = document.getElementById('kpi-net-margin');
const kpiNetProfitCard = document.getElementById('kpi-net-profit-card');

const branchesCardsGrid = document.getElementById('branches-cards-grid');
const branchesTableBody = document.getElementById('branches-table-body');
const trendBranchSelector = document.getElementById('trend-branch-selector');
const trendTableTitle = document.getElementById('trend-table-title');
const trendTableBody = document.getElementById('trend-table-body');

const loadingView = document.getElementById('loading-view');
const dashboardContent = document.getElementById('dashboard-content');

// --- DATOS EN MEMORIA ---
let productIndex = [];
let allPurchases = [];
let allOrders = [];
let allExpenses = [];
let allBranches = [];

let salesBySedeMonth = {};   // { branchId: { monthKey: { sales, cogs }, GLOBAL: { sales, cogs } } }
let expensesBySedeMonth = {};// { branchId: { monthKey: val, GLOBAL: val } }
let uniqueMonths = new Set();

const STORAGE_KEY = 'mismartech_admin_master_inventory';
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
// 1. INICIALIZACIÓN
// ============================================================================
async function initAnalysis() {
    try {
        // Carga de productos (Intentar desde cache de localstorage)
        const cachedRaw = localStorage.getItem(STORAGE_KEY);
        if (cachedRaw) {
            try {
                const parsed = JSON.parse(cachedRaw);
                if (parsed.map) productIndex = Object.values(parsed.map);
            } catch (e) { console.warn("Cache de productos corrupto."); }
        }
        if (productIndex.length === 0) {
            const snap = await getDocs(collection(db, "products"));
            productIndex = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        // Descargas paralelas de compras, órdenes, gastos y sedes
        const [purchasesSnap, ordersSnap, expensesSnap, branchesSnap] = await Promise.all([
            getDocs(query(collection(db, "purchases"), orderBy("createdAt", "asc"))),
            getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc"))),
            getDocs(query(collection(db, "expenses"), orderBy("date", "asc"))),
            getDocs(collection(db, "branches"))
        ]);

        purchasesSnap.forEach(doc => allPurchases.push({ id: doc.id, ...doc.data() }));
        ordersSnap.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));
        expensesSnap.forEach(doc => allExpenses.push({ id: doc.id, ...doc.data() }));
        branchesSnap.forEach(doc => allBranches.push({ id: doc.id, ...doc.data() }));

        // Asegurar que exista la Sede Principal (bodega)
        const principalExists = allBranches.find(b => b.id === 'bodega');
        if (!principalExists) {
            allBranches.unshift({ id: 'bodega', name: 'Bodega Principal', location: 'Matriz' });
        }

        // Procesar FIFO y Gastos
        calculateGlobalFIFO();
        processExpenses();

        // Poblar Selector de Periodo con meses ordenados de forma descendente
        const sortedMonthKeys = Array.from(uniqueMonths).sort().reverse();
        sortedMonthKeys.forEach(key => {
            const [year, month] = key.split('-');
            const date = new Date(parseInt(year), parseInt(month) - 1, 1);
            const label = getMonthYearLabel(date);
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = label;
            periodSelector.appendChild(opt);
        });

        // Poblar Selector de Sede para Historial Histórico
        allBranches.forEach(br => {
            const opt = document.createElement('option');
            opt.value = br.id;
            opt.textContent = br.name;
            trendBranchSelector.appendChild(opt);
        });

        // Añadir opción de Gastos Corporativos Generales a Histórico
        const generalExpensesOpt = document.createElement('option');
        generalExpensesOpt.value = 'ALL';
        generalExpensesOpt.textContent = 'Gastos Generales / Corporativos';
        trendBranchSelector.appendChild(generalExpensesOpt);

        // Event Listeners
        periodSelector.addEventListener('change', (e) => {
            updateDashboard(e.target.value);
        });

        trendBranchSelector.addEventListener('change', (e) => {
            renderBranchTrend(e.target.value);
        });

        // Carga inicial de datos
        updateDashboard('GLOBAL');
        renderBranchTrend(allBranches[0].id);

        // Mostrar Dashboard
        loadingView.classList.add('hidden');
        dashboardContent.classList.remove('hidden');

    } catch (e) {
        console.error("Error en inicialización del dashboard:", e);
        loadingView.innerHTML = `<i class="fa-solid fa-circle-exclamation text-4xl text-red-500 mb-4"></i><p class="text-xs font-black uppercase text-red-500">Error al procesar rentabilidad. Revisa la consola.</p>`;
    }
}

// ============================================================================
// 2. ALGORITMO FIFO POR PUNTOS DE VENTA (SEDES)
// ============================================================================
function calculateGlobalFIFO() {
    productIndex.forEach(product => {
        let timeline = [];

        // Compras de lotes (IN)
        allPurchases.forEach(p => {
            if (p.items) {
                p.items.forEach(item => {
                    if (item.id === product.id) {
                        timeline.push({ 
                            type: 'IN', 
                            date: p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt), 
                            qty: parseInt(item.quantity) || 0, 
                            unitCost: parseFloat(item.unitCostBase) || 0
                        });
                    }
                });
            }
        });

        // Ventas (OUT)
        allOrders.forEach(o => {
            if (['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) return;
            if (o.items) {
                o.items.forEach(item => {
                    if (item.id === product.id) {
                        timeline.push({ 
                            type: 'OUT', 
                            date: o.createdAt?.toDate ? o.createdAt.toDate() : new Date(o.createdAt), 
                            qty: parseInt(item.quantity) || 0, 
                            unitPrice: parseFloat(item.price) || 0,
                            branchId: o.branchId || 'bodega'
                        });
                    }
                });
            }
        });

        // Calcular discrepancia entre stock real e historial transaccional de compras/ventas
        let totalQtyPurchased = 0;
        let totalQtySoldFromHistory = 0;
        timeline.forEach(event => {
            if (event.type === 'IN') {
                totalQtyPurchased += event.qty;
            } else if (event.type === 'OUT') {
                totalQtySoldFromHistory += event.qty;
            }
        });

        const realStock = parseInt(product.stock) || 0;
        const initialStockDiff = realStock + totalQtySoldFromHistory - totalQtyPurchased;

        if (initialStockDiff > 0) {
            // Inyectar stock inicial al principio
            timeline.unshift({
                type: 'IN',
                date: new Date(0),
                qty: initialStockDiff,
                unitCost: parseFloat(product.lastPurchaseCost) || 0,
                refId: 'INITIAL_STOCK_OR_ADJUSTMENT'
            });
        } else if (initialStockDiff < 0) {
            // Inyectar ajuste de reducción manual al principio
            timeline.unshift({
                type: 'OUT',
                date: new Date(0),
                qty: Math.abs(initialStockDiff),
                unitPrice: 0,
                refId: 'MANUAL_STOCK_REDUCTION',
                status: 'ADJUSTMENT'
            });
        }

        timeline.sort((a, b) => a.date - b.date);

        let inventoryQueue = []; 
        let lastKnownCost = product.lastPurchaseCost || 0;

        timeline.forEach(event => {
            if (event.type === 'IN') {
                inventoryQueue.push({ qty: event.qty, cost: event.unitCost });
                if (event.unitCost > 0) lastKnownCost = event.unitCost;
            } 
            else if (event.type === 'OUT') {
                let qtyToFulfill = event.qty;
                let costForThisSale = 0;

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
                    costForThisSale += (qtyToFulfill * lastKnownCost);
                }

                // Omitir agregación de métricas de ventas si es una reducción de ajuste de stock
                if (event.status === 'ADJUSTMENT') return;

                const monthKey = getMonthYearKey(event.date);
                const brId = event.branchId || 'bodega';
                const revenue = event.qty * event.unitPrice;

                // Agregación estructurada por Sede y Mes
                if (!salesBySedeMonth[brId]) {
                    salesBySedeMonth[brId] = {};
                }
                if (!salesBySedeMonth[brId][monthKey]) {
                    salesBySedeMonth[brId][monthKey] = { sales: 0, cogs: 0 };
                }
                salesBySedeMonth[brId][monthKey].sales += revenue;
                salesBySedeMonth[brId][monthKey].cogs += costForThisSale;

                // Acumulador Global de la Sede
                if (!salesBySedeMonth[brId]['GLOBAL']) {
                    salesBySedeMonth[brId]['GLOBAL'] = { sales: 0, cogs: 0 };
                }
                salesBySedeMonth[brId]['GLOBAL'].sales += revenue;
                salesBySedeMonth[brId]['GLOBAL'].cogs += costForThisSale;

                uniqueMonths.add(monthKey);
            }
        });
    });
}

// ============================================================================
// 3. PROCESAMIENTO DE GASTOS POR SEDE
// ============================================================================
function processExpenses() {
    allExpenses.forEach(exp => {
        const date = exp.date?.toDate ? exp.date.toDate() : (exp.createdAt?.toDate ? exp.createdAt.toDate() : new Date(exp.date || exp.createdAt));
        const monthKey = getMonthYearKey(date);
        const brId = exp.branchId || 'ALL';
        const amount = parseFloat(exp.amount) || 0;

        if (!expensesBySedeMonth[brId]) {
            expensesBySedeMonth[brId] = {};
        }
        if (!expensesBySedeMonth[brId][monthKey]) {
            expensesBySedeMonth[brId][monthKey] = 0;
        }
        expensesBySedeMonth[brId][monthKey] += amount;

        // Acumulador Global
        if (!expensesBySedeMonth[brId]['GLOBAL']) {
            expensesBySedeMonth[brId]['GLOBAL'] = 0;
        }
        expensesBySedeMonth[brId]['GLOBAL'] += amount;

        uniqueMonths.add(monthKey);
    });
}

// ============================================================================
// 4. ACTUALIZACIÓN DEL DASHBOARD SEGÚN PERIODO
// ============================================================================
function updateDashboard(period) {
    let grandTotalSales = 0;
    let grandTotalCogs = 0;
    let grandTotalExpenses = 0;

    let cardsHTML = "";
    let tableHTML = "";

    // Calcular métricas de cada sede
    const branchResults = allBranches.map(br => {
        const brId = br.id;
        let sales = 0;
        let cogs = 0;
        let expenses = 0;

        if (salesBySedeMonth[brId]) {
            if (period === 'GLOBAL') {
                sales = salesBySedeMonth[brId]['GLOBAL']?.sales || 0;
                cogs = salesBySedeMonth[brId]['GLOBAL']?.cogs || 0;
            } else if (salesBySedeMonth[brId][period]) {
                sales = salesBySedeMonth[brId][period].sales || 0;
                cogs = salesBySedeMonth[brId][period].cogs || 0;
            }
        }

        if (expensesBySedeMonth[brId]) {
            if (period === 'GLOBAL') {
                expenses = expensesBySedeMonth[brId]['GLOBAL'] || 0;
            } else if (expensesBySedeMonth[brId][period]) {
                expenses = expensesBySedeMonth[brId][period] || 0;
            }
        }

        const grossProfit = sales - cogs;
        const netProfit = grossProfit - expenses;
        const margin = sales > 0 ? (netProfit / sales) * 100 : 0;

        grandTotalSales += sales;
        grandTotalCogs += cogs;
        grandTotalExpenses += expenses;

        return { id: brId, name: br.name, sales, cogs, grossProfit, expenses, netProfit, margin };
    });

    // Agregar Gastos Generales (ALL) al consolidado
    let generalExpenses = 0;
    if (expensesBySedeMonth['ALL']) {
        if (period === 'GLOBAL') {
            generalExpenses = expensesBySedeMonth['ALL']['GLOBAL'] || 0;
        } else if (expensesBySedeMonth['ALL'][period]) {
            generalExpenses = expensesBySedeMonth['ALL'][period] || 0;
        }
    }
    grandTotalExpenses += generalExpenses;

    const grandTotalGrossProfit = grandTotalSales - grandTotalCogs;
    const grandTotalNetProfit = grandTotalGrossProfit - grandTotalExpenses;
    const grandTotalMargin = grandTotalSales > 0 ? (grandTotalNetProfit / grandTotalSales) * 100 : 0;

    // Renderizar KPIs Generales
    kpiTotalSales.textContent = formatMoney(grandTotalSales);
    kpiTotalCogs.textContent = formatMoney(grandTotalCogs);
    kpiTotalExpenses.textContent = formatMoney(grandTotalExpenses);
    kpiTotalNetProfit.textContent = formatMoney(grandTotalNetProfit);
    kpiNetMargin.textContent = `Margen: ${grandTotalMargin.toFixed(1)}%`;

    if (grandTotalNetProfit >= 0) {
        kpiNetProfitCard.className = "bg-gradient-to-br from-emerald-500 to-teal-600 p-6 rounded-3xl shadow-lg text-white flex items-center gap-4 transition-all duration-300";
    } else {
        kpiNetProfitCard.className = "bg-gradient-to-br from-red-500 to-rose-600 p-6 rounded-3xl shadow-lg text-white flex items-center gap-4 transition-all duration-300";
    }

    // Renderizar Cards de Sedes
    branchResults.forEach(br => {
        const profitColor = br.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500';
        const cardBgColor = br.netProfit >= 0 
            ? 'border-gray-100 hover:border-emerald-100 hover:shadow-emerald-500/5' 
            : 'border-red-100 bg-red-50/15 hover:border-red-200';

        cardsHTML += `
        <div class="bg-white p-6 rounded-3xl border ${cardBgColor} shadow-sm transition-all duration-300 hover:-translate-y-1">
            <h4 class="font-black text-brand-black text-sm uppercase mb-4 pb-2 border-b border-gray-50 flex justify-between items-center">
                <span>${br.name}</span>
                <span class="text-[9px] font-black uppercase bg-gray-100 px-2.5 py-0.5 rounded text-gray-500">${br.id === 'bodega' ? 'Matriz' : 'Sede'}</span>
            </h4>
            <div class="space-y-3">
                <div class="flex justify-between text-xs">
                    <span class="text-gray-400 font-bold uppercase tracking-wider">Ventas:</span>
                    <span class="font-black text-brand-black">${formatMoney(br.sales)}</span>
                </div>
                <div class="flex justify-between text-xs">
                    <span class="text-gray-400 font-bold uppercase tracking-wider">Gastos:</span>
                    <span class="font-bold text-brand-red">${formatMoney(br.expenses)}</span>
                </div>
                <div class="flex justify-between text-xs pt-2 border-t border-gray-50">
                    <span class="text-gray-400 font-black uppercase tracking-wider">Utilidad Neta:</span>
                    <span class="font-black ${profitColor}">${formatMoney(br.netProfit)}</span>
                </div>
                <div class="flex justify-between text-xs">
                    <span class="text-gray-400 font-bold uppercase tracking-wider">Margen Neto:</span>
                    <span class="font-black ${profitColor}">${br.margin.toFixed(1)}%</span>
                </div>
            </div>
        </div>
        `;
    });

    // Añadir Card de Gastos Generales si aplica
    if (generalExpenses > 0) {
        cardsHTML += `
        <div class="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-sm text-white transition-all duration-300 hover:-translate-y-1">
            <h4 class="font-black text-white text-sm uppercase mb-4 pb-2 border-b border-slate-800 flex justify-between items-center">
                <span>Gastos Generales</span>
                <span class="text-[9px] font-black uppercase bg-slate-800 px-2.5 py-0.5 rounded text-gray-400">Sin Sede</span>
            </h4>
            <div class="space-y-3">
                <div class="flex justify-between text-xs">
                    <span class="text-gray-400 font-bold uppercase tracking-wider">Ventas:</span>
                    <span class="font-bold text-gray-500">$0</span>
                </div>
                <div class="flex justify-between text-xs">
                    <span class="text-gray-400 font-bold uppercase tracking-wider">Gastos:</span>
                    <span class="font-black text-red-400">${formatMoney(generalExpenses)}</span>
                </div>
                <div class="flex justify-between text-xs pt-2 border-t border-slate-800">
                    <span class="text-gray-400 font-black uppercase tracking-wider">Utilidad Neta:</span>
                    <span class="font-black text-red-400">-${formatMoney(generalExpenses)}</span>
                </div>
            </div>
        </div>
        `;
    }

    branchesCardsGrid.innerHTML = cardsHTML;

    // Renderizar Filas de la Tabla Comparativa
    branchResults.forEach(br => {
        const profitColor = br.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500';
        tableHTML += `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-brand-black uppercase">${br.name}</td>
            <td class="px-6 py-4 text-right font-bold text-gray-600">${formatMoney(br.sales)}</td>
            <td class="px-6 py-4 text-right font-bold text-gray-400">${formatMoney(br.cogs)}</td>
            <td class="px-6 py-4 text-right font-black text-brand-orange">${formatMoney(br.grossProfit)}</td>
            <td class="px-6 py-4 text-right font-bold text-brand-red">${formatMoney(br.expenses)}</td>
            <td class="px-6 py-4 text-right font-black ${profitColor}">${formatMoney(br.netProfit)}</td>
            <td class="px-6 py-4 text-center font-black ${profitColor}">${br.margin.toFixed(1)}%</td>
        </tr>
        `;
    });

    if (generalExpenses > 0) {
        tableHTML += `
        <tr class="hover:bg-slate-50 transition-colors bg-slate-50/50">
            <td class="px-6 py-4 font-bold text-gray-500 uppercase italic">Gastos Generales / Corporativos</td>
            <td class="px-6 py-4 text-right font-bold text-gray-300">$0</td>
            <td class="px-6 py-4 text-right font-bold text-gray-300">$0</td>
            <td class="px-6 py-4 text-right font-black text-gray-300">$0</td>
            <td class="px-6 py-4 text-right font-bold text-brand-red">${formatMoney(generalExpenses)}</td>
            <td class="px-6 py-4 text-right font-black text-red-400">-${formatMoney(generalExpenses)}</td>
            <td class="px-6 py-4 text-center font-black text-red-400">0.0%</td>
        </tr>
        `;
    }

    // Fila del Consolidado Total
    const grandProfitColor = grandTotalNetProfit >= 0 ? 'text-emerald-500' : 'text-red-500';
    tableHTML += `
    <tr class="bg-slate-900 text-white font-black border-t-2 border-brand-orange">
        <td class="px-6 py-5 font-black uppercase text-brand-orange">Consolidado Total</td>
        <td class="px-6 py-5 text-right font-black text-white">${formatMoney(grandTotalSales)}</td>
        <td class="px-6 py-5 text-right font-black text-gray-400">${formatMoney(grandTotalCogs)}</td>
        <td class="px-6 py-5 text-right font-black text-brand-orange">${formatMoney(grandTotalGrossProfit)}</td>
        <td class="px-6 py-5 text-right font-black text-red-400">${formatMoney(grandTotalExpenses)}</td>
        <td class="px-6 py-5 text-right font-black ${grandProfitColor}">${formatMoney(grandTotalNetProfit)}</td>
        <td class="px-6 py-5 text-center font-black ${grandProfitColor}">${grandTotalMargin.toFixed(1)}%</td>
    </tr>
    `;

    branchesTableBody.innerHTML = tableHTML;
}

// ============================================================================
// 5. TENDENCIAS MENSUALES POR SEDE
// ============================================================================
function renderBranchTrend(branchId) {
    const selectedName = trendBranchSelector.options[trendBranchSelector.selectedIndex]?.text || "Sede";
    trendTableTitle.textContent = `Historial Mensual: ${selectedName}`;

    trendTableBody.innerHTML = "";
    const sortedMonths = Array.from(uniqueMonths).sort().reverse(); 

    let html = "";
    sortedMonths.forEach(monthKey => {
        let sales = 0;
        let cogs = 0;
        let expenses = 0;

        if (salesBySedeMonth[branchId] && salesBySedeMonth[branchId][monthKey]) {
            sales = salesBySedeMonth[branchId][monthKey].sales || 0;
            cogs = salesBySedeMonth[branchId][monthKey].cogs || 0;
        }

        if (expensesBySedeMonth[branchId] && expensesBySedeMonth[branchId][monthKey]) {
            expenses = expensesBySedeMonth[branchId][monthKey] || 0;
        }

        // Si no hay actividad en este mes, saltarlo
        if (sales === 0 && expenses === 0) return;

        const grossProfit = sales - cogs;
        const netProfit = grossProfit - expenses;
        const margin = sales > 0 ? (netProfit / sales) * 100 : 0;

        const profitColor = netProfit >= 0 ? 'text-emerald-500' : 'text-red-500';

        // Formatear fecha del mes
        const [year, m] = monthKey.split('-');
        const dateObj = new Date(parseInt(year), parseInt(m) - 1, 1);
        const readableMonth = getMonthYearLabel(dateObj);

        html += `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-gray-700">${readableMonth}</td>
            <td class="px-6 py-4 text-right font-bold text-gray-600">${formatMoney(sales)}</td>
            <td class="px-6 py-4 text-right font-bold text-brand-red">${formatMoney(expenses)}</td>
            <td class="px-6 py-4 text-right font-black ${profitColor}">${formatMoney(netProfit)}</td>
            <td class="px-6 py-4 text-center font-black ${profitColor}">${margin.toFixed(1)}%</td>
        </tr>
        `;
    });

    if (html === "") {
        trendTableBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-400 font-bold uppercase text-xs">Sin transacciones registradas en esta sede.</td></tr>`;
    } else {
        trendTableBody.innerHTML = html;
    }
}

// Iniciar análisis
initAnalysis();
