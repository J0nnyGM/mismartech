require('dotenv').config();

const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

// --- 1. INICIALIZACIÓN GLOBAL (CRÍTICO) ---
// Esto debe ejecutarse primero para que todos los módulos compartan la instancia
if (!admin.apps.length) {
    admin.initializeApp();
}

// --- 2. IMPORTAR MÓDULOS ---
const mpModule = require('./mercadopago');
const schedulerModule = require('./scheduler');
const codModule = require('./cod');
const addiModule = require('./addi');
const sistecreditoModule = require('./sistecredito'); // <--- 1. NUEVO: Importar módulo SC
const emailModule = require('./emails'); 
const whatsappModule = require('./whatsapp');
const syncModule = require('./sync');
const merchantModule = require('./google-merchant'); // <--- 1. NUEVO: Importar módulo
const sitemapModule = require('./sitemap');
const productMetaModule = require('./productMeta');
const localInventory  = require("./local-inventory");
const orderCounterModule = require('./order-counter');
const mercadolibreModule = require('./mercadolibre');
const mercadolibre2Module = require('./mercadolibre2');
const mercadolibre3Module = require('./mercadolibre3');


// --- 3. EXPORTAR FUNCIONES ---

// MercadoPago
exports.createMercadoPagoPreference = functions.https.onCall(mpModule.createPreference);
exports.mercadoPagoWebhook = functions.https.onRequest(mpModule.webhook);

// Contra Entrega (COD)
exports.createCODOrder = functions.https.onCall(codModule.createCODOrder);

// ADDI
exports.createAddiCheckout = functions.https.onCall(addiModule.createAddiCheckout);
exports.addiWebhook = functions.https.onRequest(addiModule.webhook);

// Sistecrédito (NUEVO)
exports.createSistecreditoCheckout = functions.https.onCall(sistecreditoModule.createSistecreditoCheckout);
exports.sistecreditoWebhook = functions.https.onRequest(sistecreditoModule.webhook);

// Notificaciones por Correo
exports.sendOrderConfirmation = emailModule.sendOrderConfirmation;
exports.sendDispatchNotification = emailModule.sendDispatchNotification;

// Mantenimiento (Scheduler)
exports.cleanupOldOrders = onSchedule("every 24 hours", schedulerModule.cleanupOldOrders);
exports.processScheduledTransfers = schedulerModule.processScheduledTransfers;
exports.cancelAbandonedPayments = schedulerModule.cancelAbandonedPayments;
exports.checkExpiredPromotions = schedulerModule.checkExpiredPromotions;

// WhatsApp
exports.whatsappWebhook = whatsappModule.webhook;
exports.sendWhatsappMessage = whatsappModule.sendMessage;
exports.sendTestTemplate = whatsappModule.sendTestTemplate; // 🔥 NUEVO: Exportar la prueba de plantilla
exports.sendMassTemplate = whatsappModule.sendMassTemplate; // 🔥 NUEVO: Conectar la función de Campañas


// Sync
exports.touchProductTimestamp = syncModule.touchProductTimestamp;

// Google Merchant Center (Feed XML)
exports.generateProductFeed = merchantModule.generateProductFeed; // <--- 2. NUEVO: Exportar función

exports.sitemap = sitemapModule.sitemap;

exports.renderProductMeta = functions.https.onRequest(productMetaModule.renderProductMeta);

exports.generateLocalInventoryFeed = localInventory.generateLocalInventoryFeed;


// 🔥 NUEVO: Exportar el trigger asignador de consecutivos
exports.assignSequentialNumber = orderCounterModule.assignSequentialNumber; 


//HABILITACION SCRIPT NUMERO REMISIONES
//exports.backfillOrderNumbers = orderCounterModule.backfillOrderNumbers;

// Tienda 1
exports.mercadolibreWebhook = functions.https.onRequest(mercadolibreModule.webhook);
exports.renewMercadoLibreToken = onSchedule("every 5 hours", mercadolibreModule.renewTokenTask);

// Tienda 2
exports.mercadolibreStore2Webhook = functions.https.onRequest(mercadolibre2Module.webhook);
exports.renewMercadoLibreStore2Token = onSchedule("every 5 hours", mercadolibre2Module.renewTokenTask);

// Tienda 3
exports.mercadolibreStore3Webhook = functions.https.onRequest(mercadolibre3Module.webhook);
exports.renewMercadoLibreStore3Token = onSchedule("every 5 hours", mercadolibre3Module.renewTokenTask);